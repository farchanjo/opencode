import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Deferred, Effect, Exit, Layer, Context, Scope, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { Usage, type LLMEvent } from "@opencode-ai/llm"
import { RoutingSessionStore } from "./routing-session-store"
import { recordTurn, evaluateRecorded, deltaFromUsage, exceedsTurnLimit } from "./budget-consume"
import { emitBudgetConsumption, emitCompletionGate } from "@/routing/application/telemetry-emitters"
import { isTelemetryArmed } from "@/routing/telemetry-export"
import { OrchestrationAggregate } from "./orchestration-aggregate"
import { createConfigAdapter, AUTHORITY } from "@/routing/adapters/outbound/config-adapter"
import { sessionConfigReadPort, createBoundedLru } from "./routing-resolve"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

const DOOM_LOOP_THRESHOLD = 3
export type Result = "compact" | "stop" | "continue"

// Feature 043 — the effective routing enforcement inputs the budget seam needs:
// the activation gate and the (default-or-operator) budget policy.
interface EffectiveEnforcement {
  readonly activation: RoutingConfig.Info["activation"]
  readonly budget: RoutingConfig.Enforcement["budget"]
}

/**
 * Budget enforcement is ACTIVE only when Smart Routing is effectively on (enabled
 * and not `never`) — the SAME gate F037/F042 use for the routing/spawn paths. The
 * out-of-box default (`enabled:false`/`mode:"never"`) is byte-identical to pre-F043:
 * no recording, no re-evaluation, no block. The sensible default budget applies only
 * once an operator turns Smart Routing on without configuring every numeric limit.
 */
function enforcementActive(activation: RoutingConfig.Info["activation"]): boolean {
  return activation.enabled && activation.mode !== "never"
}

export interface Handle {
  readonly message: SessionV1.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
  ) => Effect.Effect<SessionV1.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: SessionV1.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: SessionV1.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: SessionV1.ToolPart["id"]
  messageID: SessionV1.ToolPart["messageID"]
  sessionID: SessionV1.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: SessionV1.TextPart | undefined
  reasoningMap: Record<string, SessionV1.ReasoningPart>
}

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service
    // Feature 043 / Phase 2b — the shared `RoutingSessionState` store (one instance
    // across the processor + prompt layers) and the effective routing budget the
    // live response loop records consumption onto and enforces mid-session.
    const routingStore = yield* RoutingSessionStore.Service

    // Resolve the effective routing ACTIVATION + budget (project ▶ global ▶ the
    // sensible default). Bound by the caller's captured context so config reads run
    // on the request `InstanceRef`. MEMOIZED by the routing authorities' CAS VERSIONS
    // (stable strings), NOT config-object identity: `Config.getGlobal()` returns a
    // FRESH merged object on every call whenever a global PROFILE exists (the deployed
    // two-level config model), so an identity guard would never hit and the
    // schema-decode + contentHash of `resolveEffective` would run on every
    // step-finish / pre-turn call. The version key is read WITHOUT a schema decode and
    // changes iff the config changes, so the memo hits under a profile yet is
    // invalidated by a real config change. Capacity-1 LRU. Any failure degrades to a
    // no-op (FR-F1).
    const enforcementMemo = createBoundedLru<EffectiveEnforcement>(1, () => {})
    const resolveRoutingEnforcement = Effect.fn("SessionProcessor.routingEnforcement")(function* () {
      const context = yield* Effect.context<never>()
      const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromiseWith(context)(effect)
      const readPort = sessionConfigReadPort({ get: () => config.get(), getGlobal: () => config.getGlobal() }, run)
      // Cheap, decode-free stable key: the CAS versions of the two routing authorities.
      const project = yield* Effect.promise(() => readPort.get(AUTHORITY.project))
      const global = yield* Effect.promise(() => readPort.get(AUTHORITY.global))
      const key = `${project?.version ?? ""}|${global?.version ?? ""}`
      const cached = enforcementMemo.get(key)
      if (cached) return cached
      const effective = yield* Effect.promise(() => createConfigAdapter({ config: readPort }).resolveEffective())
      const value: EffectiveEnforcement = {
        activation: effective.config.activation,
        budget: effective.config.enforcement.budget,
      }
      enforcementMemo.set(key, value)
      return value
    })

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        currentText: undefined,
        reasoningMap: {},
      }
      let aborted = false

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return undefined
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return undefined
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: SessionV1.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            // Keep metadata streamed while running so failures retain progress detail (e.g. execute's child calls).
            metadata: match.part.state.metadata,
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      })

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (input: {
        id: string
        name: string
        providerExecuted?: boolean
      }) {
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: { ...existing.part.metadata, providerExecuted: true },
          })
          ctx.toolcalls[input.id] = {
            ...existing.call,
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return { call: ctx.toolcalls[input.id], part }
        }
        const part = yield* session.updatePart({
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted ? { providerExecuted: true } : undefined,
        } satisfies SessionV1.ToolPart)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: SessionV1.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (value.providerMetadata && value.id in ctx.reasoningMap) {
              ctx.reasoningMap[value.id].metadata = value.providerMetadata
            }
            yield* finishReasoning(value.id)
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            yield* ensureToolCall(value)
            return

          case "tool-input-end": {
            yield* ensureToolCall(value)
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            const input = isRecord(value.input) ? value.input : { value: value.input }
            yield* updateToolCall(value.id, (match) => ({
              ...match,
              tool: value.name,
              state:
                match.state.status === "running"
                  ? { ...match.state, input }
                  : {
                      status: "running",
                      input,
                      time: { start: Date.now() },
                    },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
              Effect.provideService(Database.Service, database),
            )
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.name],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.name, input },
              always: [value.name],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            const toolCall = yield* readToolCall(value.id)
            if (!toolCall && value.result.type === "error") return
            if (value.result.type === "error") {
              yield* failToolCall(value.id, value.result.value)
              return
            }
            const rawOutput = toolResultOutput(value)
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<SessionV1.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            yield* completeToolCall(value.id, output)
            return
          }

          case "tool-error": {
            yield* failToolCall(value.id, value.error ?? new Error(value.message))
            return
          }

          case "provider-error":
            throw new Error(value.message)

          case "step-start":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
            const completedSnapshot = yield* snapshot.track()
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.reason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            // Feature 043 / Phase 2b — when Smart Routing is effectively ON, record
            // the completed response's REAL turn/token/cost spend onto the shared
            // store (accumulated running total), then re-evaluate the budget against
            // it. A genuine hard-maximum breach is the engine's explicit `blocked` /
            // `error` outcome — surfaced honestly as a stopped turn (mirroring the
            // permission-rejection `ctx.blocked` path), never a silent truncation and
            // never relaxable by any model/nested instruction. When routing is OFF
            // (the out-of-box default) this is a NO-OP — byte-identical to pre-F043.
            // Recording happens BEFORE evaluation (FR-A3). This runs BETWEEN turns (at
            // step-finish), not inside the LLM stream. The whole path degrades to a
            // no-op on any defect/failure so the turn never crashes or blocks
            // (FR-A/B, FR-F1) — but a genuine fiber INTERRUPTION is re-raised so a
            // user-abort while awaiting config I/O is never swallowed.
            yield* Effect.gen(function* () {
              const enforcement = yield* resolveRoutingEnforcement()
              if (!enforcementActive(enforcement.activation)) return
              const delta = deltaFromUsage(usage)
              const consumption = recordTurn(routingStore, ctx.sessionID, delta)
              const result = evaluateRecorded(enforcement.budget, consumption, delta)
              // Feature 047 (FR3) — emit the per-turn consumption span and, on a
              // hard-stop breach, the breach counter. Fire-and-forget: non-blocking,
              // error-swallowed. The seam-level armed guard runs FIRST so a
              // telemetry-OFF session allocates NOTHING here (byte-identical, FR8).
              if (isTelemetryArmed()) {
                emitBudgetConsumption(
                  {
                    turnsUsed: consumption.throughput.turns_used,
                    contextTokensUsed: consumption.throughput.context_tokens_used,
                    outputTokensUsed: consumption.throughput.output_tokens_used,
                    costUsdUsed: consumption.cost.cost_usd_used,
                    scope: "session",
                  },
                  result.breached
                    ? {
                        outcome: result.decision.outcome,
                        // A breach with no per-dimension violation falls back to a
                        // sentinel INSIDE the bounded dimension domain, never the
                        // raw outcome string (bounded-label safety, FIX 5).
                        dimension: result.decision.violations[0]?.dimension ?? "unspecified",
                        scope: "session",
                      }
                    : undefined,
                )
              }
              if (!result.breached) return
              const violation = result.decision.violations[0]
              const detail = violation
                ? `${violation.reason} (observed ${violation.observed} exceeds ${violation.dimension} ${violation.limit})`
                : result.decision.outcome
              const error = parse(new Error(`Session budget ${result.decision.outcome}: ${detail}`))
              ctx.assistantMessage.error = error
              ctx.assistantMessage.finish = "error"
              ctx.blocked = true
              yield* session.updateMessage(ctx.assistantMessage)
              yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            }).pipe(Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), () => Effect.void))
            // Feature 044 / Phase 3 (FR-B1, FR-B2, FR-B3) — the COMPLETION gate. A
            // Manager turn MUST NOT be reported complete while a FOREGROUND (awaited)
            // delegated Worker is still `pending`; the gate settles when every
            // foreground Worker is terminal (a `failed`/`aborted` Worker is terminal and
            // SURFACES, FR-B2). BACKGROUND / promoted Workers are fire-and-continue by
            // the experimental background-subagent contract and are DELIBERATELY not
            // gate-blocked here (ADR-0044 Decision #3) — blocking a launching turn on a
            // by-design background launch would regress fire-and-continue; they are
            // tracked informationally and woken via `inject` on every terminal signal
            // (FR-D1), never starving the wake. The aggregate is populated ONLY under
            // routing-mode hierarchy dispatch (FR-E1; `auto` OR `always` per Feature
            // 045), so a plain/disabled session has NO aggregate and this is a NO-OP
            // — the null short-circuit runs BEFORE any
            // config read, byte-identical to pre-F044. Composed AFTER the budget gate (a
            // budget-blocked turn stays blocked; this only ADDS the foreground-pending
            // reason). Hang/crash-safe (any defect degrades to a no-op; a genuine
            // interrupt is re-raised). The one deliberate non-degrading outcome is this
            // typed `blocked` hold — not a crash, not a silent finish.
            yield* Effect.gen(function* () {
              if (ctx.blocked) return
              const aggregate = routingStore.get(ctx.sessionID).aggregate
              if (!aggregate) return
              const enforcement = yield* resolveRoutingEnforcement()
              // Feature 045 — the completion gate engages in any routing mode
              // (`auto` OR `always`, i.e. `mode !== "never"`), reconciled with the
              // F042 hierarchy gate: `always` populates the orchestration aggregate
              // (hierarchy dispatch now fires on every spawn), so the Manager
              // completion gate must fire under `always` too, or a Manager could
              // report complete with foreground Workers still pending. A disabled
              // session has no aggregate and this remains a no-op (byte-identical).
              if (!(enforcement.activation.enabled && enforcement.activation.mode !== "never")) return
              const gate = OrchestrationAggregate.managerCompletionGate(aggregate)
              if (gate.outcome !== "blocked") return
              // Feature 047 (FR5) — emit the blocked completion-gate metric with the
              // pending-worker count (fire-and-forget, non-blocking). Armed guard
              // first so a telemetry-OFF session allocates nothing (FR8).
              if (isTelemetryArmed()) emitCompletionGate({ pendingWorkers: gate.pendingWorkers })
              const error = parse(
                new Error(`Orchestration completion blocked: ${gate.pendingWorkers} delegated worker(s) still pending`),
              )
              ctx.assistantMessage.error = error
              ctx.assistantMessage.finish = "error"
              ctx.blocked = true
              yield* session.updateMessage(ctx.assistantMessage)
              yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            }).pipe(Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), () => Effect.void))
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            // Console chat budget is soft (system prompt); model self-sizes — no stream filter.
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
        })
        const error = parse(e)
        if (SessionV1.ContextOverflowError.isInstance(error)) {
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          ctx.needsCompaction = true
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        ctx.assistantMessage.error = error
        yield* events.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      // Feature 043 — PRE-turn gate for the one COUNTABLE dimension, `max_turns`.
      // Token/cost lateness is inherent to post-execution accounting (the spend is
      // only known at step-finish), but a countable turn can be gated EXACTLY: block
      // BEFORE starting a turn that would push `turns_used` over `max_turns`, so the
      // limit is honored precisely rather than one turn late. Gated on activation and
      // hang/crash-safe like the step-finish path; an interruption is re-raised.
      const preTurnBudgetGate = Effect.fn("SessionProcessor.preTurnBudgetGate")(function* () {
        yield* Effect.gen(function* () {
          const enforcement = yield* resolveRoutingEnforcement()
          if (!enforcementActive(enforcement.activation)) return
          if (!exceedsTurnLimit(enforcement.budget, routingStore.get(ctx.sessionID).consumption)) return
          const error = parse(
            new Error(`Session budget blocked: next turn would exceed max_turns ${enforcement.budget.limits.max_turns}`),
          )
          ctx.assistantMessage.error = error
          ctx.assistantMessage.finish = "error"
          ctx.blocked = true
          yield* session.updateMessage(ctx.assistantMessage)
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
        }).pipe(Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), () => Effect.void))
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            yield* status.set(ctx.sessionID, { type: "busy" })
            // Feature 043 — gate the countable turn BEFORE the LLM stream starts, so
            // a `max_turns` breach blocks the over-limit turn rather than detecting it
            // one turn late. A no-op when routing is off (byte-identical to pre-F043).
            yield* preTurnBudgetGate()
            if (!ctx.blocked) {
              const stream = llm.stream(streamInput)

              yield* stream.pipe(
                Stream.tap((event) => handleEvent(event)),
                Stream.takeUntil(() => ctx.needsCompaction || ctx.blocked),
                Stream.runDrain,
              )
            }
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                set: (info) => {
                  return status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    action: info.action,
                    next: info.next,
                  })
                },
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Session.node,
    Config.node,
    Snapshot.node,
    Agent.node,
    LLM.node,
    Permission.node,
    Plugin.node,
    SessionSummary.node,
    SessionStatus.node,
    Image.node,
    EventV2Bridge.node,
    Database.node,
    RoutingSessionStore.node,
  ],
})

export * as SessionProcessor from "./processor"
