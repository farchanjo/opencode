/**
 * Feature 037 / Phase 1 — session-local Smart Routing model resolution.
 *
 * Wires the operator Smart Routing engine (`createRoutingService`) into the live
 * session runtime so that, when Smart Routing is explicitly enabled in `auto`
 * mode with a populated role pool, an implicit default model is chosen by the
 * routing engine instead of the static `currentModel()` fallback. An explicit
 * `--model` (`input.model`) and an agent-pinned model (`agent.model`) always win
 * — this resolver is consulted ONLY in the implicit-default branch of the
 * session model selection seam (`session/prompt.ts`).
 *
 * Composition decision (ADR-0037): the routing service is composed here over the
 * session-layer service INTERFACES (Config / Provider / Agent / Auth), and every
 * outbound async seam runs on the runtime CAPTURED inside the caller's Effect
 * (`Effect.runtime()`). That runtime already carries the request `InstanceRef`
 * binding, so the catalog/agent candidate resolution is bound BY CONSTRUCTION —
 * side-stepping the `operator/stack-live.ts` "InstanceRef not provided" defect
 * (its catalog/agent seams call `AppRuntime.runPromise` without binding the ref).
 * Phase 1 deliberately does NOT reach into `createLiveOperatorStack`.
 *
 * Safety contract: this module can NEVER crash OR block the prompt path. Every
 * failure mode — Smart Routing disabled, empty role pool, no authorized
 * candidate, an unresolved provider, an unauthenticated routed provider, or any
 * evaluation/engine error — degrades to `undefined`, which the seam treats as
 * "fall back to the static default". The whole attempt is wrapped so any defect
 * or rejection resolves to `undefined`, AND it is raced against a hard
 * `RESOLVE_TIMEOUT_MS` (1.5s) bound so a slow/locked filesystem hangs nothing —
 * a timeout degrades to `undefined` exactly like every other failure. Retention
 * is bounded too: the per-session drift cache and decision-ref store are LRU-
 * capped (`DRIFT_CACHE_CAP`), so a long-lived server process cannot leak.
 */
export * as RoutingResolve from "./routing-resolve"

import { mkdir } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { ConfigEntry, ConfigPort } from "@/operator/application/ports/config-port"
import { contentHash } from "@/operator/adapters/outbound/config-service"
import { createConfigAdapter, toRoutingConfigSource } from "@/routing/adapters/outbound/config-adapter"
import { createCatalogAdapter, createCandidateSource, type CatalogCandidateService } from "@/routing/adapters/outbound/catalog-adapter"
import { createTaskAnalyzer } from "@/routing/application/task-analyzer"
import { createDomainDecisionStore } from "@/routing/application/decision-store"
import { createFsDecisionStorePort } from "@/routing/adapters/outbound/decision-store-fs"
import { createRoutingService } from "@/routing/application/routing-service"
import { emitRoutingDecision } from "@/routing/application/telemetry-emitters"
import { isTelemetryArmed } from "@/routing/telemetry-export"
import type { DecisionStore } from "@/routing/application/ports"
import {
  createRoutingSessionStateStore,
  type RoutingDecisionRef,
  type RoutingSessionStateStore,
} from "./routing-state"
import type { SessionID } from "./schema"

// =============================================================================
// Structural service seams — the minimal read surface this resolver needs from
// the session-layer service interfaces (assignable from the real Config /
// Provider / Agent / Auth interfaces without importing their full graph).
// =============================================================================

export interface RoutingResolveConfigLike {
  readonly get: () => Effect.Effect<unknown>
  readonly getGlobal: () => Effect.Effect<unknown>
}

export interface RoutingResolveModelLike {
  readonly id: string
  readonly providerID: string
  readonly status: string
  readonly capabilities: { readonly toolcall: boolean }
  /** Provider-declared availability. Absent on the live provider interface (all
   * models are implicitly enabled there) → treated as `true`; a `false` value
   * (tests / future gating) makes the provider ineligible, mirroring the catalog
   * adapter's `classify` "disabled" rejection (`catalog-adapter.ts`). */
  readonly enabled?: boolean
}

export interface RoutingResolveProviderInfoLike {
  readonly models: Record<string, RoutingResolveModelLike>
}

export interface RoutingResolveProviderLike {
  readonly list: () => Effect.Effect<Record<string, RoutingResolveProviderInfoLike>>
}

export interface RoutingResolveAgentLike {
  readonly name: string
}

export interface RoutingResolveAgentsLike {
  readonly listSpecialists: () => Effect.Effect<ReadonlyArray<RoutingResolveAgentLike>>
}

export interface RoutingResolveAuthLike {
  readonly get: (providerID: string) => Effect.Effect<unknown, unknown>
}

export interface RoutingResolveDeps {
  readonly config: RoutingResolveConfigLike
  readonly provider: RoutingResolveProviderLike
  readonly agents: RoutingResolveAgentsLike
  readonly auth: RoutingResolveAuthLike
  /** Decision persistence override (tests). Defaults to the durable fs store. */
  readonly decisions?: DecisionStore
  /** Drift-cache LRU capacity override (tests). Defaults to `DRIFT_CACHE_CAP`. */
  readonly driftCacheCap?: number
  /** Feature 043 — the shared `RoutingSessionState` store. When present, the
   * committed decision's `accounting.budget_consumed` reflects the session's
   * recorded running-total consumption (FR-D1) instead of `ZERO_CONSUMPTION`. */
  readonly consumptionStore?: RoutingSessionStateStore
}

export interface ResolveRoutingModelInput {
  readonly sessionID: string
  readonly turnID: string
  readonly taskText: string
  readonly scope: Budget.Scope
}

export interface ResolvedRoutingModel {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

export type ResolveRoutingModel = (
  input: ResolveRoutingModelInput,
) => Effect.Effect<ResolvedRoutingModel | undefined>

// =============================================================================
// ConfigPort (read-only) over the session Config interface. Mirrors the operator
// durable store's authority read: the routing document lives under
// `config.operator.authorities["routing"]` (project) and
// `configGlobal.operator.authorities["global:routing"]` (global). Only `get` is
// exercised (via `resolveEffective`); writes are never issued from the prompt path.
// =============================================================================

const OPERATOR_NAMESPACE = "operator"

function isGlobalAuthority(authority: string): boolean {
  return authority === "global" || authority.startsWith("global:")
}

function readAuthorityEntry(root: unknown, authority: string): ConfigEntry | null {
  if (!root || typeof root !== "object") return null
  const ns = (root as Record<string, unknown>)[OPERATOR_NAMESPACE]
  if (!ns || typeof ns !== "object") return null
  const authorities = (ns as Record<string, unknown>)["authorities"]
  if (!authorities || typeof authorities !== "object") return null
  const rec = (authorities as Record<string, unknown>)[authority]
  if (!rec || typeof rec !== "object") return null
  const row = rec as Record<string, unknown>
  if (typeof row["version"] !== "string") return null
  const updatedAtMs = typeof row["updatedAtMs"] === "number" ? (row["updatedAtMs"] as number) : 0
  return { version: row["version"] as string, payload: row["payload"], updatedAtMs }
}

function readOnlyPortError(): never {
  throw new Error("routing-resolve config port is read-only")
}

export function sessionConfigReadPort(config: RoutingResolveConfigLike, run: <A>(effect: Effect.Effect<A>) => Promise<A>): ConfigPort {
  return {
    async get(authority) {
      const root = isGlobalAuthority(authority) ? await run(config.getGlobal()) : await run(config.get())
      return readAuthorityEntry(root, authority)
    },
    compareAndSet: async () => readOnlyPortError(),
    snapshot: async () => readOnlyPortError(),
    listSnapshots: async () => readOnlyPortError(),
    pruneSnapshots: async () => readOnlyPortError(),
    restoreSnapshot: async () => readOnlyPortError(),
  }
}

// =============================================================================
// Catalog + agent candidate seams over the session Provider / Agent interfaces —
// the same projection the live operator stack uses, but running on the captured,
// InstanceRef-bound runtime.
// =============================================================================

function sessionCatalog(provider: RoutingResolveProviderLike, run: <A>(effect: Effect.Effect<A>) => Promise<A>): CatalogCandidateService {
  return {
    listModels: async () => {
      const providers = await run(provider.list())
      return Object.values(providers).flatMap((p) =>
        Object.values(p.models).map((m) => ({
          modelId: m.id,
          providerId: m.providerID,
          status: m.status as "alpha" | "beta" | "deprecated" | "active",
          enabled: m.enabled ?? true,
          tools: m.capabilities.toolcall,
        })),
      )
    },
  }
}

function sessionAgents(agents: RoutingResolveAgentsLike, run: <A>(effect: Effect.Effect<A>) => Promise<A>) {
  return {
    resolveAgents: async () => {
      const specialists = await run(agents.listSpecialists())
      return specialists.map((a) => ({
        agentId: a.name,
        skills: [] as ReadonlyArray<string>,
        effort: "medium" as const,
        reasoningEffort: "medium" as const,
      }))
    },
  }
}

// =============================================================================
// Provider re-resolution — the routing decision yields a bare, provider-less
// model id (`decision.selection.executor_model`). Map it back to a concrete
// provider that ACTUALLY BACKS an authorized candidate, not merely any provider
// that lists the id. The authorized candidate was resolved from a HEALTHY
// catalog snapshot (enabled + non-deprecated) and gated on the catalog's only
// known capability dimension — `tool_call_present` (`catalog-adapter.ts`
// `toCapabilityCatalogRecord`). A bare model id can exist under several
// providers whose capability facts DIFFER; picking the lexicographically-first
// (the previous behaviour) could return a provider that is disabled, deprecated,
// or tool-incapable — i.e. one the capability gate would have rejected.
//
// Eligibility rule (mirrors the catalog `classify` + capability filter): a
// provider qualifies iff it (a) serves the model id, (b) is enabled, and (c) is
// non-deprecated. Among the qualifying providers we PREFER the tool-capable set
// (`capabilities.toolcall === true`) — the capability the authorized decision
// was made on — and only fall back to tool-incapable providers when no
// tool-capable provider serves the model (a decision that did not require
// tools). Within the chosen set the tie-break is deterministic: the
// lexicographically-smallest providerID. No eligible provider → `undefined`
// (fall back to the static default), like every other failure path.
// =============================================================================

export async function resolveProviderForModel(
  provider: RoutingResolveProviderLike,
  run: <A>(effect: Effect.Effect<A>) => Promise<A>,
  modelId: string,
): Promise<string | undefined> {
  const providers = await run(provider.list())
  const toolCapable: string[] = []
  const toolIncapable: string[] = []
  for (const [providerId, info] of Object.entries(providers)) {
    const model = info.models[modelId] ?? Object.values(info.models).find((m) => m.id === modelId)
    if (!model) continue
    if (model.enabled === false) continue // (b) enabled — mirrors classify "disabled"
    if (model.status === "deprecated") continue // (c) non-deprecated
    if (model.capabilities.toolcall) toolCapable.push(providerId)
    else toolIncapable.push(providerId)
  }
  const eligible = toolCapable.length > 0 ? toolCapable : toolIncapable
  eligible.sort()
  return eligible[0]
}

// =============================================================================
// Bounded LRU — the resolver is constructed ONCE per session-layer construction
// (process lifetime under `opencode serve`), so the per-session drift cache and
// the RoutingSessionState store would otherwise gain one entry per unique
// sessionID FOREVER (a monotonic leak). This caps retention at a fixed number of
// most-recently-used sessions, evicting the least-recently-used on overflow. The
// drift SEMANTICS are unchanged — the first decision for a LIVE, still-cached
// session is still reused; only unbounded retention is fixed. `get` bumps
// recency so an active long conversation is never evicted out from under itself.
// =============================================================================

/** Sessions retained in the drift cache before LRU eviction begins. ~1k live
 * sessions is far beyond any realistic concurrent `opencode serve` load while
 * bounding worst-case memory at a few KB of tiny model refs. */
const DRIFT_CACHE_CAP = 1024

export interface BoundedLru<V> {
  readonly has: (key: string) => boolean
  readonly get: (key: string) => V | undefined
  readonly set: (key: string, value: V) => void
}

export function createBoundedLru<V>(capacity: number, onEvict: (key: string) => void): BoundedLru<V> {
  const map = new Map<string, V>()
  return {
    has: (key) => map.has(key),
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key) as V
      map.delete(key)
      map.set(key, value) // re-insert at the MRU end
      return value
    },
    set(key, value) {
      if (map.has(key)) map.delete(key)
      map.set(key, value)
      while (map.size > capacity) {
        const oldest = map.keys().next().value as string
        map.delete(oldest)
        onEvict(oldest) // keep the RoutingSessionState store in lockstep
      }
    },
  }
}

// =============================================================================
// Resolver factory — one instance per session-layer construction. It owns the
// per-session drift cache (the FIRST resolution is reused for every later
// message in the session, so a long conversation never flips models mid-stream)
// and the RoutingSessionState decision-reference store, both bounded (LRU) so a
// long-lived server process cannot leak per-session state.
// =============================================================================

/** Hard upper bound on the whole resolver attempt (fs decision-store
 * mkdir/commit + config/provider/auth reads). The routing seam runs on the
 * prompt HOT PATH; a stuck, slow, or locked `Global.Path.state` filesystem must
 * NEVER block `createUserMessage`/`shellImpl`. 1.5s is generous headroom for a
 * cold decision-store commit on a healthy disk (tens of ms) yet tight enough
 * that a wedged FS degrades to the static default fast — and it is paid at most
 * ONCE per session (the first implicit-default message; later ones hit the
 * drift cache). On timeout the attempt resolves to `undefined`, exactly like
 * every other failure. */
export const RESOLVE_TIMEOUT_MS = 1500

function hierarchyRoleOf(profile: Enums.RoutingProfile): Enums.HierarchyRole {
  return profile === "manager" ? "manager" : "worker"
}

// =============================================================================
// Feature 045 — activation mode. `never`/disabled is the no-op path; `auto`
// resolves once per session (drift-cache memoized); `always` re-evaluates every
// turn so a role/pool/config change takes effect next turn without a new session.
// The mode read collapses a disabled engine to `never`, so a single value drives
// both the routing gate and the caller-seam short-circuit bypass.
// =============================================================================

/** Read the effective activation mode from the routing authorities, collapsing a
 * disabled engine to `"never"`. Throwing/hanging is handled by `boundMode`. */
async function readActivationMode(
  config: RoutingResolveConfigLike,
  run: <A>(effect: Effect.Effect<A>) => Promise<A>,
): Promise<RoutingConfig.RoutingMode> {
  const source = toRoutingConfigSource(createConfigAdapter({ config: sessionConfigReadPort(config, run) }))
  const effective = await source.resolve()
  const activation = effective.config.activation
  return activation.enabled ? activation.mode : "never"
}

/** Bound the mode read on the prompt hot path: a crash/rejection or a wedged FS
 * degrades to `"never"` (the no-op path) instead of blocking, inheriting the F037
 * hang-safety contract. */
function boundMode(read: () => Promise<RoutingConfig.RoutingMode>): Effect.Effect<RoutingConfig.RoutingMode> {
  return Effect.promise(() => read().catch(() => "never" as RoutingConfig.RoutingMode)).pipe(
    Effect.timeoutOrElse({
      duration: RESOLVE_TIMEOUT_MS,
      orElse: () => Effect.succeed("never" as RoutingConfig.RoutingMode),
    }),
  )
}

export interface RoutingActivationDeps {
  readonly config: RoutingResolveConfigLike
}

export type ReadRoutingMode = () => Effect.Effect<RoutingConfig.RoutingMode>

/** Feature 045 — a hang-safe reader of the effective activation mode for the
 * session model-selection seam. The seam consults it (only when a persisted model
 * would otherwise short-circuit routing) to decide whether `always` mode must
 * re-evaluate this turn. Degrades to `"never"` on any failure/timeout, so it can
 * never block or crash the prompt path. */
export function createRoutingActivationReader(deps: RoutingActivationDeps): ReadRoutingMode {
  return () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>()
      const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromiseWith(context)(effect)
      return yield* boundMode(() => readActivationMode(deps.config, run))
    }).pipe(Effect.catchCause(() => Effect.succeed("never" as RoutingConfig.RoutingMode)))
}

export interface RoutingConsultInput {
  readonly explicitModel: boolean
  readonly hasPersistedModel: boolean
  readonly mode: RoutingConfig.RoutingMode
}

/** Feature 045 — the pure session-seam decision: consult the routing resolver this
 * turn? An explicit `--model` / agent-pinned model ALWAYS wins (never consulted).
 * Otherwise routing is consulted when there is no persisted session model (the
 * msg1 boundary) OR the mode is `always` (re-evaluate every turn, bypassing the
 * persisted-model short-circuit). `auto` / `never` keep the persisted-model
 * short-circuit — byte-identical to pre-045. */
export function shouldConsultRouting(input: RoutingConsultInput): boolean {
  if (input.explicitModel) return false
  return !input.hasPersistedModel || input.mode === "always"
}

export function createRoutingResolver(deps: RoutingResolveDeps): ResolveRoutingModel {
  const decisionRefs = createRoutingSessionStateStore()
  // Evict the paired RoutingSessionState entry whenever the drift cache drops a
  // session, so the two never diverge and neither grows without bound.
  const driftCache = createBoundedLru<ResolvedRoutingModel | null>(deps.driftCacheCap ?? DRIFT_CACHE_CAP, (sessionID) =>
    decisionRefs.clear(sessionID as never),
  )

  let decisionStorePromise: Promise<DecisionStore> | undefined
  function decisionStore(): Promise<DecisionStore> {
    if (deps.decisions) return Promise.resolve(deps.decisions)
    if (!decisionStorePromise) {
      decisionStorePromise = (async () => {
        const baseDir = path.join(Global.Path.state, "routing-decisions")
        await mkdir(baseDir, { recursive: true })
        return createDomainDecisionStore(createFsDecisionStorePort(), baseDir)
      })()
    }
    return decisionStorePromise
  }

  function recordDecision(input: ResolveRoutingModelInput, decision: Decision.RoutingDecision): void {
    const ref: RoutingDecisionRef = {
      decisionId: decision.id,
      catalogVersion: decision.accounting.catalog_version,
      policyVersion: decision.accounting.policy_version,
    }
    const role = hierarchyRoleOf(decision.classification.routing_profile)
    decisionRefs.recordDecision(input.sessionID as never, ref, role)
    // Feature 047 (FR2) — emit a content-free `routing.decision` span for the live
    // top-level selection. Fire-and-forget: non-blocking, error-swallowed — the
    // turn's latency is unaffected and a down collector can never break it. The
    // seam-level armed guard runs FIRST so a telemetry-OFF session allocates
    // NOTHING on the hot path (byte-identical, FR8).
    if (isTelemetryArmed()) {
      emitRoutingDecision({
        taskClass: decision.classification.task_class,
        routingProfile: decision.classification.routing_profile,
        hierarchyRole: role,
        selectedModel: decision.selection.executor_model,
        scope: input.scope,
        authorizedCount: decision.evaluation.candidates.length,
        decisionModelCalled: decision.evaluation.decision_model_id !== null,
        offline: decision.lifecycle.offline,
        latencyMs: decision.lifecycle.decision_latency_ms,
      })
    }
  }

  async function resolveOnce(
    input: ResolveRoutingModelInput,
    run: <A>(effect: Effect.Effect<A>) => Promise<A>,
  ): Promise<ResolvedRoutingModel | undefined> {
    // 1) Gate — Smart Routing must be explicitly enabled in a routing mode
    // (`auto` OR `always`; Feature 045). A disabled engine or `never` mode is the
    // no-op path. Per-turn re-evaluation vs. drift-cache memoization is decided by
    // the caller closure from the same mode; this gate only admits routing.
    const routingConfigSource = toRoutingConfigSource(
      createConfigAdapter({ config: sessionConfigReadPort(deps.config, run) }),
    )
    const effective = await routingConfigSource.resolve()
    const activation = effective.config.activation
    if (!(activation.enabled && activation.mode !== "never")) return undefined

    // 2) Evaluate — compose the routing service over the session-layer seams.
    const candidates = createCandidateSource({
      catalog: createCatalogAdapter({ catalog: sessionCatalog(deps.provider, run) }),
      agents: sessionAgents(deps.agents, run),
    })
    const service = createRoutingService({
      config: routingConfigSource,
      candidates,
      analyzer: createTaskAnalyzer(),
      decisions: await decisionStore(),
      // FR-D1 — persist the session's recorded running-total consumption in the
      // decision accounting; absent store → `ZERO_CONSUMPTION` (back-compat).
      consumptionFor: deps.consumptionStore
        ? (id) => deps.consumptionStore?.get(id as SessionID).consumption ?? undefined
        : undefined,
    })
    const decision = await run(
      service
        .evaluate({
          sessionId: input.sessionID as never,
          turnId: input.turnID as never,
          taskDescription: input.taskText,
          taskFingerprint: contentHash(input.taskText) as never,
          scope: input.scope,
        })
        .pipe(Effect.match({ onFailure: () => null, onSuccess: (d) => d })),
    )
    if (!decision) return undefined

    // 3) Provider re-resolution + auth verification.
    const bareModel = decision.selection.executor_model
    const providerID = await resolveProviderForModel(deps.provider, run, bareModel)
    if (!providerID) return undefined
    const authInfo = await run(
      deps.auth.get(providerID).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (a) => a })),
    )
    if (!authInfo) return undefined

    // 4) Record the decision reference and return the concrete model ref.
    recordDecision(input, decision)
    return { providerID: ProviderV2.ID.make(providerID), modelID: ModelV2.ID.make(bareModel) }
  }

  return (input) =>
    Effect.gen(function* () {
      // Capture the caller's context — it carries the request `InstanceRef`
      // binding — so every outbound seam runs bound by construction.
      const context = yield* Effect.context<never>()
      const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromiseWith(context)(effect)

      // Feature 045 — the activation MODE governs memoization. `never`/disabled →
      // no routing (byte-identical to the no-op path). `auto` → resolve ONCE per
      // session and reuse the first decision for every later turn (the drift
      // guard, so a long conversation never flips models mid-stream). `always` →
      // RE-EVALUATE every turn so a role/pool/config change takes effect next turn
      // without a new session; the drift cache is neither read nor written.
      // Reading the mode first (rather than after `resolveOnce`) closes the
      // auto→always mid-session flip: an entry can only ever be memoized in `auto`.
      const mode = yield* boundMode(() => readActivationMode(deps.config, run))
      if (mode === "never") return undefined
      const memoize = mode === "auto"
      if (memoize && driftCache.has(input.sessionID)) return driftCache.get(input.sessionID) ?? undefined

      // Hang-proofing: bound the ENTIRE attempt (fs mkdir/commit + evaluate +
      // provider + auth) so a stuck FS cannot block the prompt path. `.catch`
      // handles crashes/rejections; `timeoutOrElse` handles a HANG — both degrade
      // to `undefined` (→ static default). In `auto` the result is cached so a
      // transient stall is not re-attempted every message in the session; `always`
      // deliberately re-attempts each turn.
      const resolved = yield* Effect.promise(() => resolveOnce(input, run).catch(() => undefined)).pipe(
        Effect.timeoutOrElse({ duration: RESOLVE_TIMEOUT_MS, orElse: () => Effect.succeed(undefined) }),
      )
      if (memoize) driftCache.set(input.sessionID, resolved ?? null)
      return resolved
    }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
}
