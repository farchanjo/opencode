import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import { RoutingHierarchy } from "../session/routing-hierarchy"
import { OrchestrationAggregate } from "../session/orchestration-aggregate"
import { emitOrchestrationWorker } from "@/routing/application/telemetry-emitters"
import { isTelemetryArmed } from "@/routing/telemetry-export"
import { TodoAuthority } from "@/routing/domain/todo-authority"
import { Todo } from "@/session/todo"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Exit, Option, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"

/**
 * Feature 042 / Phase 2 — the SINGLE orchestration-only tool-gating ALLOWLIST.
 *
 * Under `hierarchy.orchestration_only`, a non-Worker child (architect/manager) is
 * restricted to the INTERSECTION with this read-only / planning / delegation
 * allowlist (FR-C1). The gate FAILS CLOSED: rather than enumerating a denylist of
 * mutating builtins (which silently omits every MCP / plugin / custom / dynamic /
 * future tool — those default to "ask", i.e. execute under an auto-approve or
 * headless deployment), we deny the ENTIRE tool surface with a catch-all rule and
 * re-allow ONLY these ids. Every other tool — builtin mutating (`edit`/`write`/
 * `apply_patch`/`bash`/`execute`), MCP, plugin, custom, and any future tool — is
 * denied BY CONSTRUCTION, never by enumeration. Only a Worker leaf carries
 * execution authority. Canonical ids verified against the real tool registry
 * (`tool/registry.ts`): `bash` (the shell tool), `webfetch`, `websearch`,
 * `todowrite`; MCP resource reads resolve under the `read` permission.
 */
const ORCHESTRATION_ALLOWED_TOOLS: ReadonlyArray<string> = [
  "read",
  "grep",
  "glob",
  "lsp",
  "webfetch",
  "websearch",
  "question",
  "skill",
  "task",
  "todowrite",
]

/** True iff `toolId` is on the orchestration-only allowlist (read-only / planning /
 * delegation) that a non-Worker child may retain. Everything else fails closed. */
export function isOrchestrationAllowedTool(toolId: string): boolean {
  return ORCHESTRATION_ALLOWED_TOOLS.includes(toolId)
}

/**
 * The fail-closed permission rules for an orchestration-only non-Worker child: a
 * catch-all deny over the WHOLE tool surface followed by an allow for each
 * allowlisted id. `Permission.evaluate` is last-match-wins, so an allowlisted id
 * resolves to its trailing allow while every other id (MCP / plugin / custom /
 * future included) stops at the catch-all deny — covered by construction.
 */
export function orchestrationChildToolRules(): ReadonlyArray<{
  readonly permission: string
  readonly pattern: "*"
  readonly action: "deny" | "allow"
}> {
  return [
    { permission: "*", pattern: "*", action: "deny" },
    ...ORCHESTRATION_ALLOWED_TOOLS.map((permission) => ({ permission, pattern: "*" as const, action: "allow" as const })),
  ]
}

/** The legacy default subagent-delegation ceiling when `subagent_depth` is unset
 * and hierarchy routing is off (one nested subagent). */
export const LEGACY_DEPTH_CEILING = 1

/**
 * Feature 042 / Phase 2 (FR-E3, FR-B3) + Feature 048 (FR5) — the effective
 * delegation ceiling the `depth >= ceiling` guard enforces.
 *
 * `subagentDepth` is the OPERATOR-configured `subagent_depth` (or `undefined` when
 * unset — the distinction matters). `hierarchyMaxDepth` is present only when this
 * spawn was hierarchy-routed.
 *
 *   - Off the hierarchy path (`hierarchyMaxDepth === undefined`): the legacy
 *     ceiling — the configured value or the default `1`. Unchanged, byte-identical.
 *   - Heuristic hierarchy path (`forceManager === false`): the MIN of the legacy
 *     ceiling and `hierarchyMaxDepth`, so a config can never widen delegation
 *     beyond the engine invariant. With `subagent_depth` unset this is
 *     `min(1, max_depth) = 1` — the heuristic Manager -> Worker hop stays blocked,
 *     exactly as today.
 *   - Force-manager path (`forceManager === true`): when `subagent_depth` is UNSET
 *     the ceiling HONORS `hierarchyMaxDepth` (so Architect(0) -> Manager(1) ->
 *     Worker(2) passes); an explicitly configured `subagent_depth` still reconciles
 *     to the MIN of the two (explicit config keeps restricting).
 */
export function reconcileDepthCeiling(
  subagentDepth: number | undefined,
  hierarchyMaxDepth?: number,
  forceManager = false,
): number {
  if (hierarchyMaxDepth === undefined) return subagentDepth ?? LEGACY_DEPTH_CEILING
  if (forceManager && subagentDepth === undefined) return hierarchyMaxDepth
  return Math.min(subagentDepth ?? LEGACY_DEPTH_CEILING, hierarchyMaxDepth)
}

/**
 * Feature 048 (FR8) — the Manager persona prelude, prepended to a manager-role
 * spawn's task prompt under `force_manager`. It instructs the Manager tier to
 * decompose the Architect's task, delegate to Workers via `task`, critically
 * aggregate their results, and return a consolidated analysis to the Architect.
 * It is injected ONLY in force_manager mode; heuristic spawns are byte-identical.
 */
export const MANAGER_PERSONA_PRELUDE = [
  "You are the MANAGER tier of a three-tier Architect -> Manager -> Worker orchestration.",
  "Your job is to ORCHESTRATE, not to execute the work yourself:",
  "1. Decompose the Architect's task below into independent, well-scoped Worker subtasks.",
  "2. Dispatch each subtask by calling the `task` tool, delegating it to a Worker.",
  "3. Collect every Worker's result and critically aggregate them — reconcile conflicts,",
  "   drop unsupported claims, and note gaps; do not merely concatenate.",
  "4. Return ONE consolidated analysis to the Architect.",
  "Delegate execution to Workers; keep your own turn to planning, dispatch, and synthesis.",
  "",
  "--- Architect task ---",
].join("\n")

/** Prepend the Manager persona prelude to a manager-role spawn's prompt under
 * force_manager; return the prompt unchanged for every other role/mode. Pure and
 * unit-testable so the injection boundary is verifiable in isolation. */
export function applyManagerPersona(prompt: string, childRole: string, forceManager: boolean): string {
  if (!forceManager || childRole !== "manager") return prompt
  return `${MANAGER_PERSONA_PRELUDE}\n${prompt}`
}
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      // A precomputed dispatch (the mention/slash `handleSubtask` path) is used as
      // is. Otherwise, Feature 049: when the LIVE LLM `task`-tool path injected a
      // per-invocation resolver (`session/tools.ts`), consult it with THIS spawn's
      // prompt to route the child — the seam the mention path already wired, but
      // that a real LLM/@mention delegation was missing. A `undefined` result falls
      // through to the exact parent-inheritance path (byte-identical when off).
      let hierarchyDispatch = ctx.extra?.hierarchyDispatch as RoutingHierarchy.HierarchyDispatchExtra | undefined
      const liveResolve = ctx.extra?.hierarchyResolve as RoutingHierarchy.LiveHierarchyResolve | undefined
      let routedModel: RoutingHierarchy.ResolvedRoutingModel | undefined
      // Resolve the child agent early ONLY on the live path (its pinned model must
      // win over routing); the default path resolves it in place below, unchanged.
      let resolvedAgent: Agent.Info | undefined
      if (!hierarchyDispatch && liveResolve) {
        resolvedAgent = yield* agent.get(params.subagent_type)
        const decision = yield* liveResolve({
          taskText: params.prompt,
          spawnKey: ctx.callID ?? `${ctx.sessionID}:${ctx.messageID}`,
          hasAgentPinnedModel: !!resolvedAgent?.model,
        })
        if (decision?.kind === "blocked") {
          // A `{kind:"blocked"}` (illegal edge / depth exceeded / denied admission)
          // surfaces as a REAL blocked spawn, never silent inheritance (mirrors the
          // handleSubtask path).
          return yield* Effect.fail(
            new Error(
              `Subagent spawn blocked by hierarchy routing (${decision.rejection.reason}): ${decision.rejection.detail}`,
            ),
          )
        }
        if (decision?.kind === "degraded") {
          // Feature 048 (FR7) — a force_manager tier whose pool model failed to
          // resolve is SURFACED (a visible warning), then the spawn proceeds on the
          // parent model; never a silent inheritance, never a hard block.
          yield* Effect.logWarning("hierarchy tier degraded to parent model", {
            childRole: decision.childRole,
            reason: decision.reason,
          })
        }
        if (decision?.kind === "route") {
          routedModel = decision.model
          hierarchyDispatch = decision.dispatch
        }
      }

      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      // A visited set bounds the walk so a corrupted A→B→A parentID can never hang.
      const visited = new Set<string>([current.id])
      while (current.parentID && !visited.has(current.parentID)) {
        depth++
        visited.add(current.parentID)
        current = yield* sessions.get(current.parentID)
      }
      const depthCeiling = reconcileDepthCeiling(
        cfg.subagent_depth,
        hierarchyDispatch?.maxDepth,
        hierarchyDispatch?.forceManager ?? false,
      )
      if (depth >= depthCeiling) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${depthCeiling}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = resolvedAgent ?? (yield* agent.get(params.subagent_type))
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
        // Feature 042 / Phase 2 (FR-C1) — under `orchestration_only` a non-Worker
        // child is restricted to the read-only / planning / delegation allowlist:
        // a catch-all deny over the WHOLE tool surface plus an allow for each
        // allowlisted id, so every mutating / MCP / plugin / custom / future tool
        // is denied BY CONSTRUCTION (fail-closed), not by a leaky enumeration. The
        // `executionAllowed` flag is engine-derived (never recomputed here).
        ...(hierarchyDispatch?.denyExecutionTools ? orchestrationChildToolRules() : []),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      // Feature 042 / Phase 2 (FR-D1, Decision #4) — record the dispatch lineage
      // now that the child session id is known. The record validates the PARENT
      // edge against the child's ACTUAL parent (catching a resumed-session mismatch)
      // and never throws into the spawn path; a mismatch is skipped and logged.
      if (hierarchyDispatch) {
        const recorded = RoutingHierarchy.recordHierarchyDispatch(
          hierarchyDispatch.store,
          nextSession.id,
          hierarchyDispatch.lineageStub,
          nextSession.parentID ?? ctx.sessionID,
        )
        if (!recorded.ok) yield* Effect.logWarning("hierarchy dispatch lineage not recorded", { reason: recorded.reason })
        // Feature 044 / Phase 3 (FR-A1) — record the delegated Worker as `pending`
        // on the MANAGER's aggregate (keyed by child session id). The Todo roll-up
        // is refreshed from the child's own snapshot on its terminal transition
        // (`foldWorkerTerminal`); at spawn the child has not run, so the roll-up is
        // the deferred `UNKNOWN_ROLLUP` placeholder. A `background` launch is
        // fire-and-continue by the experimental background-subagent contract, so it
        // is recorded as INFORMATIONAL delivery (the completion gate never blocks the
        // launching turn on it, ADR-0044 Decision #3); a foreground launch is
        // gate-enforced. The whole contract is INERT unless `hierarchyDispatch` is
        // present, which the spawn resolver produces ONLY when Smart Routing is
        // enabled in `auto` mode (FR-E1) — so a disabled session is byte-identical.
        hierarchyDispatch.store.recordDelegatedWorker(ctx.sessionID, {
          childSessionId: nextSession.id,
          lifecycle: "pending",
          delivery: runInBackground ? "background" : "foreground",
          todo: OrchestrationAggregate.UNKNOWN_ROLLUP,
        })
      }

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      // Precedence (Feature 049): an agent-pinned model wins, then the hierarchy-
      // routed model, then parent inheritance. `routedModel` is set only when the
      // resolver positively routed a tier (never when off / no-route), so the
      // `next.model ?? { parent }` behavior is byte-identical whenever it is unset.
      const model = next.model ??
        routedModel ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        // Feature 048 (FR8) — under force_manager, prepend the Manager persona to a
        // manager-role spawn's prompt so it decomposes -> dispatches Workers ->
        // aggregates. Inert (identity) for every other role/mode (byte-identical).
        const promptText = applyManagerPersona(
          params.prompt,
          hierarchyDispatch?.lineageStub.child_role ?? "",
          hierarchyDispatch?.forceManager ?? false,
        )
        const parts = yield* ops.resolvePromptParts(promptText)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      // Feature 044 / Phase 3 (FR-A2, FR-C, FR-D1) — the WAKE: on a child's terminal
      // signal, refresh its Todo roll-up (read-only), run the ordered SHAPE -> POLICY
      // -> DOMAIN validation chain for a completed result, and fold the terminal
      // `WorkerOutcome` into the Manager aggregate. Coalesced/idempotent per child
      // (`updateWorkerOutcome` no-ops an already-terminal child, FR-D2). INERT unless
      // `hierarchyDispatch` is present (auto-mode gate, FR-E1). Wrapped so ANY defect
      // degrades to today's ungated behavior — a snapshot read failure degrades the
      // entry to `UNKNOWN_ROLLUP` (the lifecycle still tracks terminal state, FR-F1) —
      // but a genuine fiber interrupt (user-abort) is re-raised, never swallowed.
      const foldWorkerTerminal = Effect.fn("TaskTool.foldWorkerTerminal")(function* (
        status: OrchestrationAggregate.BackgroundStatus,
        output?: string,
        failureText?: string,
      ) {
        if (!hierarchyDispatch) return
        const dispatch = hierarchyDispatch
        yield* Effect.gen(function* () {
          // Read the child's OWN Todo snapshot (read-only — never mutate a child's
          // Todo, FR-A4) via an OPTIONAL service so TaskTool never hard-depends on
          // Todo.Service (a test/build layer without it degrades to UNKNOWN_ROLLUP).
          const todosOpt = yield* Effect.serviceOption(Todo.Service)
          const snapshot = Option.isNone(todosOpt)
            ? undefined
            : yield* todosOpt.value
                .snapshot(nextSession.id)
                // Narrow the fallback so a genuine user-abort DURING the snapshot read
                // still propagates (only a real read defect degrades to UNKNOWN_ROLLUP).
                .pipe(Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), () => Effect.succeed(undefined)))
          const rollup = snapshot
            ? OrchestrationAggregate.rollupFromSummary(TodoAuthority.summarize(snapshot))
            : OrchestrationAggregate.UNKNOWN_ROLLUP
          // POLICY stage (FR-C1): the tool-escape check is a typed defense-in-depth
          // hook whose LIVE evidence (`toolsUsed`) is empty BY CONSTRUCTION — the F042
          // fail-closed permission layer (`orchestrationChildToolRules`) already DENIES
          // any non-Worker tool escape at the permission boundary, so no escaped-tool
          // signal can reach acceptance. Live child tool-usage tracking is deferred to
          // Phase 4; the pure `evaluatePolicy` branch is exercised by unit tests and is
          // ready to enforce the moment a real `toolsUsed` signal is threaded.
          const chain =
            status === "completed" && snapshot
              ? OrchestrationAggregate.workerValidationChain({
                  childSessionId: nextSession.id,
                  shape: { hasEnvelope: output !== undefined },
                  policy: {
                    executionAllowed: !dispatch.denyExecutionTools,
                    toolsUsed: [],
                    allowedTools: ORCHESTRATION_ALLOWED_TOOLS,
                  },
                  domain: { snapshot, validationPerformed: true },
                })
              : undefined
          const outcome = OrchestrationAggregate.foldTerminalOutcome({
            childSessionId: nextSession.id,
            // Preserve whether this Worker was recorded foreground (gate-enforced) or
            // background/promoted (informational) so the fold does not misclassify it.
            delivery: OrchestrationAggregate.deliveryOf(dispatch.store.get(ctx.sessionID).aggregate, nextSession.id),
            status,
            todo: rollup,
            chain,
            failureText,
          })
          dispatch.store.updateWorkerOutcome(ctx.sessionID, outcome)
          // Feature 047 (FR5) — emit the worker terminal outcome (lifecycle,
          // delivery, validation verdict + fail-action). Fire-and-forget:
          // non-blocking, error-swallowed. The seam-level armed guard runs FIRST so
          // a telemetry-OFF session allocates nothing here (byte-identical, FR8).
          if (isTelemetryArmed() && outcome.lifecycle !== "pending") {
            emitOrchestrationWorker({
              lifecycle: outcome.lifecycle,
              delivery: outcome.delivery,
              validation: chain ? chain.acceptance : "none",
              failAction: outcome.failAction,
            })
          }
        }).pipe(Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), () => Effect.void))
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        // A background child has finished — release its routing state (see the
        // foreground finalizer for the same bounded-retention rationale).
        if (hierarchyDispatch) hierarchyDispatch.store.clear(nextSession.id)
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        // Feature 044 (FR-D3) — an auto-mode Manager bounds each BACKGROUND Worker by
        // WORKER_MAX_WAIT_MS so a hung Worker is force-aborted and the completion gate
        // settles; a plain spawn (no `hierarchyDispatch`) awaits unbounded — the
        // wrap collapses to `Option.some(result)`, byte-identical to pre-F044.
        const awaited = background.wait({ id: jobID })
        const bounded = hierarchyDispatch
          ? awaited.pipe(Effect.timeoutOption(OrchestrationAggregate.WORKER_MAX_WAIT_MS))
          : awaited.pipe(Effect.map(Option.some))
        yield* bounded.pipe(
          Effect.flatMap((maybe) =>
            Effect.gen(function* () {
              if (Option.isNone(maybe)) {
                yield* foldWorkerTerminal("timeout")
                yield* background.cancel(jobID).pipe(Effect.ignore)
                return yield* inject("error", "Worker exceeded max-wait and was aborted.")
              }
              const result = maybe.value
              if (result.info?.status === "completed") {
                yield* foldWorkerTerminal("completed", result.info.output ?? "")
                return yield* inject("completed", result.info.output ?? "")
              }
              if (result.info?.status === "error") {
                yield* foldWorkerTerminal("error", undefined, result.info.error ?? undefined)
                return yield* inject("error", result.info.error ?? "")
              }
              // FR-D1 — EVERY terminal transition wakes the Manager. A cancelled/other
              // terminal folds the aggregate AND re-prompts the Manager (previously it
              // folded but never injected, starving the wake).
              yield* foldWorkerTerminal("cancelled")
              return yield* inject("error", "Background task was cancelled.")
            }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: nextSession.id, run: runTask() })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        run: runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const awaited = Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            // Feature 044 (FR-D3) — an auto-mode Manager bounds each FOREGROUND Worker
            // by WORKER_MAX_WAIT_MS: on expiry the hung Worker is force-aborted so the
            // aggregate advances and the turn never deadlocks. A plain spawn (no
            // `hierarchyDispatch`) awaits unbounded — byte-identical to pre-F044.
            const settled = hierarchyDispatch
              ? yield* awaited.pipe(Effect.timeoutOption(OrchestrationAggregate.WORKER_MAX_WAIT_MS))
              : Option.some(yield* awaited)
            if (Option.isNone(settled)) {
              yield* foldWorkerTerminal("timeout")
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true }).pipe(Effect.ignore)
              return {
                title: params.description,
                metadata,
                output: renderOutput({
                  sessionID: nextSession.id,
                  state: "error",
                  summary: `Task timed out: ${params.description}`,
                  text: "Worker exceeded max-wait and was aborted.",
                }),
              }
            }
            const result = settled.value
            if (result?.metadata?.background === true) {
              // FR-B1 (ADR-0044 Decision #3) — a foreground Worker PROMOTED to the
              // background is now fire-and-continue: re-record it as INFORMATIONAL
              // delivery (still pending) so the completion gate does NOT block the
              // launching turn on it, and its `onPromote` `notify` wakes the Manager
              // when it settles. Guarded so a defect never breaks the return path.
              if (hierarchyDispatch) {
                yield* Effect.sync(() =>
                  hierarchyDispatch.store.recordDelegatedWorker(ctx.sessionID, {
                    childSessionId: nextSession.id,
                    lifecycle: "pending",
                    delivery: "background",
                    todo: OrchestrationAggregate.UNKNOWN_ROLLUP,
                  }),
                ).pipe(Effect.ignore)
              }
              return backgroundResult()
            }
            if (result?.status === "error") {
              yield* foldWorkerTerminal("error", undefined, result.error ?? undefined)
              return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            }
            if (result?.status === "cancelled") {
              yield* foldWorkerTerminal("cancelled")
              return yield* Effect.fail(new Error("Task cancelled"))
            }
            yield* foldWorkerTerminal("completed", result?.output ?? "")
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
                // The child session has finished — release its routing state so a
                // long-lived `opencode serve` never accumulates one entry per spawn.
                if (hierarchyDispatch) hierarchyDispatch.store.clear(nextSession.id)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
