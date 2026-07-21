/**
 * Feature 042 / Phase 2 — session-local hierarchy dispatch resolver.
 *
 * Wires the pure `HierarchyDispatcher` engine (Feature 001) and the
 * `RoutingSessionState` store into the Task subagent spawn seam
 * (`session/prompt.ts` `handleSubtask`). Where Feature 037 Phase 1 chose the
 * TOP-LEVEL implicit-default model of a live session, Phase 2 gives a subagent
 * SPAWN a FRESH per-spawn hierarchy decision (a role + a delegation depth/path +
 * a role-appropriate model) instead of inheriting the parent session's model
 * verbatim — enforcing the Architect -> Manager -> Worker legality, the
 * delegation-depth limit, and the `orchestration_only` execution boundary that
 * already live in the pure engine and the persisted `global:routing` config.
 *
 * Composition decision (ADR-0042, mirroring ADR-0037): the resolver composes the
 * engine over the session-layer Config / Provider / Auth INTERFACES, and every
 * outbound async seam runs on the context CAPTURED inside the caller's Effect
 * (`Effect.context()` + `Effect.runPromiseWith`). That context carries the
 * request `InstanceRef` binding, so catalog/config resolution is bound BY
 * CONSTRUCTION — side-stepping the `operator/stack-live.ts` "InstanceRef not
 * provided" defect. It deliberately never reaches into `createLiveOperatorStack`.
 *
 * Safety contract (identical to Phase 1): this module can NEVER crash OR block
 * the spawn path. Every failure mode — Smart Routing disabled, gated closed, an
 * empty role pool, an unresolved or unauthenticated provider, or any
 * evaluation/engine defect — degrades to `undefined`, which the seam treats as
 * "inherit the parent model" (today's behavior). The whole attempt is wrapped so
 * any defect resolves to `undefined`, AND it is raced against `RESOLVE_TIMEOUT_MS`
 * (1.5s) so a slow/locked filesystem hangs nothing. Retention is bounded (LRU).
 * The ONE non-`undefined` non-model outcome is a deliberate legality BLOCK
 * (illegal edge / depth exceeded / non-orchestrator parent): a typed value the
 * seam surfaces as an explicit blocked spawn — never a crash, and it leaks no
 * secret.
 */
export * as RoutingHierarchy from "./routing-hierarchy"

import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { Events } from "@opencode-ai/schema/routing/events"
import { RoutingConfig, orchestrationModeOf } from "@opencode-ai/schema/routing/config"
import { createConfigAdapter } from "@/routing/adapters/outbound/config-adapter"
import { createTaskAnalyzer } from "@/routing/application/task-analyzer"
import { HierarchyDispatcher } from "@/routing/domain/hierarchy-dispatcher"
import {
  createBoundedLru,
  resolveProviderForModel,
  sessionConfigReadPort,
  RESOLVE_TIMEOUT_MS,
  type BoundedLru,
  type ResolvedRoutingModel,
  type RoutingResolveConfigLike,
  type RoutingResolveProviderLike,
  type RoutingResolveAuthLike,
} from "./routing-resolve"
import type { RoutingSessionStateStore } from "./routing-state"
import { ZERO_CONSUMPTION, headroomFor, perWorkerReserve } from "./budget-consume"
import { emitFanoutAdmission } from "@/routing/application/telemetry-emitters"
import { isTelemetryArmed } from "@/routing/telemetry-export"
import type { SessionID } from "./schema"

// =============================================================================
// Classifier thresholds (Clarifications C1 — tunable plan constants).
//
// The Architect edge dispatches a DIRECT Worker by default (fewer delegation
// edges, less orchestration overhead; with `orchestration_only` a direct Worker
// is still fully execution-capable). It escalates to a Manager path ONLY when a
// coordinating tier genuinely earns its edge: >= 2 independent work-units across
// >= 2 distinct domains, OR a requested parallel fan-out > 1. A Manager parent
// may only ever dispatch a Worker (engine legality), so the classifier governs
// the Architect edge alone. Zero-LLM: purely the deterministic analyzer signals
// (Clarifications C2 — the decision-model consult is a default-off Phase 3
// tunable).
// =============================================================================

export const WORK_UNIT_THRESHOLD = 2
export const DOMAIN_THRESHOLD = 2
export const FANOUT_FLOOR = 1
/** Analyzer `parallelism` signal (0..1) at/above which a spawn is treated as
 * fan-out-friendly, so its independent work-units become a requested fan-out. */
export const PARALLEL_THRESHOLD = 0.5

// =============================================================================
// Public surface
// =============================================================================

export interface HierarchyResolveDeps {
  readonly config: RoutingResolveConfigLike
  readonly provider: RoutingResolveProviderLike
  readonly auth: RoutingResolveAuthLike
  /** The shared `RoutingSessionState` store (Feature 043). When present, fan-out
   * admission is bound by the parent session's REAL remaining cost/token headroom
   * (budget − recorded consumption) plus a non-zero per-worker estimate. When
   * absent, admission degrades to the Feature 042 behavior (full-budget headroom,
   * `max_workers`-only) — the hang/crash-safety back-compat path (FR-F1). */
  readonly store?: RoutingSessionStateStore
  /** Per-spawn LRU capacity override (tests). Defaults to `SPAWN_CACHE_CAP`. */
  readonly spawnCacheCap?: number
}

export interface ResolveHierarchyDispatchInput {
  readonly parentSessionId: string
  readonly parentRole: Enums.HierarchyRole
  /** Delegation edges consumed to reach the parent (Architect root = 0). */
  readonly parentDepth: number
  readonly taskText: string
  readonly scope: Budget.Scope
  /** A stable per-spawn key so bounded retention never reuses one spawn's
   * decision for another (each spawn is a FRESH decision — FR-A3). */
  readonly spawnKey: string
  /** The main-context selected model — the model the primary/parent session is
   * running as (`input.model ?? agent.model ?? currentModel/default`). It is the
   * Architect's model by definition: any architect-tier model resolution PREFERS
   * it over the role pool (Feature 042 refinement, ADR-0042). Absent → the pool
   * fallback governs. Threaded but inert for Manager/Worker resolution. */
  readonly mainContextModel?: ResolvedRoutingModel
}

/** Partial dispatch lineage — the child session id is unknown at the seam (the
 * child session is created inside `tool/task.ts`) and is folded in at record
 * time (`recordHierarchyDispatch`). */
export interface DispatchLineageStub {
  readonly parent_session_id: string
  readonly parent_role: Enums.HierarchyRole
  readonly child_role: Enums.HierarchyRole
}

export interface HierarchyRouteDecision {
  readonly kind: "route"
  readonly model: ResolvedRoutingModel
  readonly childRole: Enums.HierarchyRole
  readonly childDepth: number
  /** True only for a Worker child (from the `planDispatch` envelope, never
   * recomputed) — Architect/Manager children stay orchestration-only. */
  readonly executionAllowed: boolean
  /** Effective delegation ceiling `min(MAX_DELEGATION_DEPTH, hierarchy.max_depth)`
   * — threaded to `tool/task.ts` so its legacy `subagent_depth` guard reconciles
   * to the MIN of the two when hierarchy routing is active (FR-E3, FR-B3). */
  readonly maxDepth: number
  /** Feature 043 — the admission-controlled granted worker count from the pure
   * engine envelope (`min(requested, max_workers, cost headroom, token headroom)`),
   * never recomputed at the seam (FR-C1, FR-C3). Drops below `max_workers` as the
   * parent session's recorded consumption spends the cost/token headroom. */
  readonly fanoutGranted: number
  /** Feature 048 — true only under the opt-in `force_manager` orchestration mode.
   * Threaded to `tool/task.ts` so (a) the depth ceiling honors `hierarchy.max_depth`
   * when `subagent_depth` is unset (so the Manager -> Worker hop passes) and (b) the
   * Manager persona prelude is injected on a manager-role spawn. Always `false` in
   * heuristic mode, keeping that path byte-identical. */
  readonly forceManager: boolean
  readonly lineageStub: DispatchLineageStub
}

export interface HierarchyBlockedDecision {
  readonly kind: "blocked"
  readonly rejection: HierarchyDispatcher.DispatchRejection
}

/** Feature 048 (FR7) — the force_manager-only SURFACED degrade: an engine-admitted
 * tier whose role-pool model failed to resolve. The seam surfaces a visible warning
 * (and telemetry is already emitted) then falls back to parent inheritance — never a
 * silent inheritance, never a hard block. Heuristic mode never produces this (it
 * returns `undefined` and inherits silently, byte-identical). */
export interface HierarchyDegradedDecision {
  readonly kind: "degraded"
  readonly reason: "model_unresolved"
  readonly childRole: Enums.HierarchyRole
}

export type HierarchyDispatchDecision = HierarchyRouteDecision | HierarchyBlockedDecision | HierarchyDegradedDecision

export type ResolveHierarchyDispatch = (
  input: ResolveHierarchyDispatchInput,
) => Effect.Effect<HierarchyDispatchDecision | undefined>

// =============================================================================
// Feature 049 — the LIVE LLM `task`-tool spawn seam.
//
// `session/tools.ts` builds the tool set ONCE per turn, but a hierarchy decision
// is PER-SPAWN (it depends on the specific `task.prompt`). So the resolver is
// injected into `ctx.extra` as a per-invocation closure that `tool/task.ts` calls
// with the actual spawn text at execution time — reusing the SAME seeding + engine
// path `handleSubtask` uses, never a divergent second resolver.
// =============================================================================

/** The `hierarchyDispatch` payload `tool/task.ts` consumes to activate the F042/
 * F048 branches (lineage record, `orchestration_only` tool-gating, depth-ceiling
 * reconciliation, Manager persona). Shared by BOTH spawn paths so the mapping from
 * a route decision lives in ONE place. */
export interface HierarchyDispatchExtra {
  readonly store: RoutingSessionStateStore
  readonly lineageStub: DispatchLineageStub
  readonly denyExecutionTools: boolean
  readonly maxDepth: number
  /** Feature 048 — true only under the opt-in `force_manager` mode: it lets the
   * depth ceiling honor `hierarchy.max_depth` (so the Manager -> Worker hop passes)
   * and gates the Manager persona injection. `false` in heuristic mode. */
  readonly forceManager: boolean
}

/** The per-spawn inputs the live seam supplies at `tool/task.ts` execution time. */
export interface LiveHierarchySpawnInput {
  readonly taskText: string
  /** A stable per-spawn key (the tool call id) so the resolver's bounded retention
   * never reuses one spawn's decision for another. */
  readonly spawnKey: string
  /** `!!agent.model` for the resolved child subagent — an agent-pinned model wins
   * over routing (the consult short-circuit), mirroring `handleSubtask`. */
  readonly hasAgentPinnedModel: boolean
}

/** The live seam's decision: a route (a routed model + a ready `hierarchyDispatch`
 * payload), a legality block, or a force_manager degrade — the same three outcomes
 * `handleSubtask` handles, reshaped so `tool/task.ts` consumes them uniformly. */
export type LiveHierarchyResolution =
  | { readonly kind: "route"; readonly model: ResolvedRoutingModel; readonly dispatch: HierarchyDispatchExtra }
  | { readonly kind: "blocked"; readonly rejection: HierarchyDispatcher.DispatchRejection }
  | { readonly kind: "degraded"; readonly reason: "model_unresolved"; readonly childRole: Enums.HierarchyRole }

export type LiveHierarchyResolve = (
  input: LiveHierarchySpawnInput,
) => Effect.Effect<LiveHierarchyResolution | undefined>

/** The SINGLE route→`hierarchyDispatch` mapping, shared by BOTH spawn paths (the
 * live LLM seam and `handleSubtask`) so the F042/F048 payload is built one way. */
export function toHierarchyDispatchExtra(
  routed: HierarchyRouteDecision,
  store: RoutingSessionStateStore,
): HierarchyDispatchExtra {
  return {
    store,
    lineageStub: routed.lineageStub,
    denyExecutionTools: !routed.executionAllowed,
    maxDepth: routed.maxDepth,
    forceManager: routed.forceManager,
  }
}

/** Per-turn seeds for the live seam. The parent role/depth and the main-context
 * model are stable for the whole turn (the parent session is fixed); only the
 * spawn text + key vary per `task` call, so they are supplied per invocation. */
export interface LiveHierarchyResolveDeps {
  readonly resolve: ResolveHierarchyDispatch
  readonly store: RoutingSessionStateStore
  readonly parentSessionId: string
  readonly parentRole: Enums.HierarchyRole
  readonly parentDepth: number
  readonly mainContextModel: ResolvedRoutingModel
}

/**
 * Build the per-invocation live-spawn resolver injected into `ctx.extra`. It
 * applies the SAME consult guard + seeding + engine call as `handleSubtask`, then
 * reshapes the decision so `tool/task.ts` consumes it without re-implementing the
 * route→dispatch mapping. `undefined` means "no route" — the seam falls through to
 * the exact current parent-inheritance path (HARD INVARIANT: byte-identical off).
 */
export function createLiveHierarchyResolve(deps: LiveHierarchyResolveDeps): LiveHierarchyResolve {
  return (spawn) =>
    Effect.gen(function* () {
      // The LLM `task` tool carries no explicit `task.model`, so only an
      // agent-pinned model can short-circuit the resolver here (explicit wins).
      if (!shouldConsultHierarchy(false, spawn.hasAgentPinnedModel)) return undefined
      const decision = yield* deps.resolve({
        parentSessionId: deps.parentSessionId,
        parentRole: deps.parentRole,
        parentDepth: deps.parentDepth,
        taskText: spawn.taskText,
        scope: "session",
        spawnKey: spawn.spawnKey,
        mainContextModel: deps.mainContextModel,
      })
      if (!decision) return undefined
      if (decision.kind === "route") {
        return { kind: "route", model: decision.model, dispatch: toHierarchyDispatchExtra(decision, deps.store) }
      }
      return decision
    })
}

/**
 * The spawn-seam consult guard (FR-E1): the hierarchy resolver fills only the
 * IMPLICIT default, so it is consulted ONLY when neither an explicit `task.model`
 * nor an agent-pinned model is set. An explicit/agent model is NEVER overridden.
 */
export function shouldConsultHierarchy(hasExplicitModel: boolean, hasAgentPinnedModel: boolean): boolean {
  return !hasExplicitModel && !hasAgentPinnedModel
}

/**
 * Parent-role seeding for a spawn (Decision #2 fix). Only the GENUINE primary/root
 * session (no parent) is the Architect; a spawned child whose role was never
 * recorded on the store (e.g. a pinned-model or explicit-`task.model` spawn that
 * skipped the resolver) must NEVER be inferred as an Architect root — that would
 * re-open the whole delegation tree and mis-seed grandchildren. An unknown role on
 * a NON-root session degrades to the SAFE LEAF role `"worker"`, so a nested
 * intermediate session is gated as a worker-descendant, never a fresh tree.
 */
export function parentRoleForSpawn(recordedRole: Enums.HierarchyRole | null, isRootSession: boolean): Enums.HierarchyRole {
  if (recordedRole) return recordedRole
  return isRootSession ? "architect" : "worker"
}

// =============================================================================
// Classifier — direct Worker by default; Manager on genuine fan-out (C1/C2).
// =============================================================================

interface Classification {
  readonly childRole: Enums.HierarchyRole
  readonly requestedFanout: number
}

/** Deterministic, zero-LLM classification of a spawn's CHILD role from the
 * Feature 001 analyzer signals. A Manager parent forces a Worker child (engine
 * legality); the thresholds govern only the Architect edge. Exported as a small
 * pure function so the boundary is unit-testable and tunable in one place.
 *
 * Feature 048 — under `force_manager` the Architect edge ALWAYS yields a Manager,
 * regardless of the analyzer signals; the analyzer-derived `requestedFanout` is
 * preserved for F043 budget admission (the mode changes the ROLE, never the budget
 * math). Non-architect edges stay Worker leaves in both modes. `heuristic`
 * (default) skips the force branch entirely, so it is byte-identical to today. */
export function classifyChildRole(
  parentRole: Enums.HierarchyRole,
  taskText: string,
  scope: Budget.Scope,
  mode: RoutingConfig.OrchestrationMode = "heuristic",
): Classification {
  const analysis = createTaskAnalyzer().analyze({ taskDescription: taskText, scope })
  const workUnits = analysis.inputs.structure.independent_units
  const domains = analysis.inputs.structure.domain_count
  const parallel = analysis.inputs.concurrency.parallelism >= PARALLEL_THRESHOLD
  const requestedFanout = parallel ? Math.max(workUnits, WORK_UNIT_THRESHOLD) : 1

  // A Manager parent may only ever create a Worker (LEGAL_CHILDREN); only the
  // Architect edge consults the fan-out heuristic / force-manager rule.
  if (parentRole !== "architect") return { childRole: "worker", requestedFanout: 1 }

  // Feature 048 — force_manager makes the Architect edge unconditionally a Manager.
  if (mode === "force_manager") return { childRole: "manager", requestedFanout: Math.max(requestedFanout, 1) }

  const managerWarranted = (workUnits >= WORK_UNIT_THRESHOLD && domains >= DOMAIN_THRESHOLD) || requestedFanout > FANOUT_FLOOR
  return { childRole: managerWarranted ? "manager" : "worker", requestedFanout: managerWarranted ? requestedFanout : 1 }
}

// =============================================================================
// Role -> pool mapping (Decision #2). The child role selects its candidate pool:
// Worker -> role_pools.worker, Manager -> role_pools.manager.
//
// The Architect pool is the CONFIGURABLE FALLBACK ONLY (Feature 042 refinement,
// ADR-0042): the Architect's model is the main-context selected model FIRST (see
// `resolveRoleModel`); the routing engine NEVER overrides it. This function is
// consulted for the Architect ONLY when no main-context model resolves, and it
// then draws from role_pools[decision_model.pool[0]] (the role named by the
// decision model), falling back to role_pools.architect then
// role_pools[fallback.floor_role]. `role_pools` is a GENERIC
// `Record<roleName, ModelId[]>` — `architect` is a first-class configurable role,
// resolved here exactly like any other (never special-cased in pools.set / schema).
// This supersedes the earlier "Architect straight from the pool" choice.
// =============================================================================

export function poolModelsForRole(config: RoutingConfig.Info, role: Enums.HierarchyRole): ReadonlyArray<string> {
  const pools = config.models.role_pools as Record<string, ReadonlyArray<string>>
  const floor = config.models.fallback.floor_role
  if (role === "architect") {
    const named = config.models.decision_model.pool[0]
    return pools[named ?? "architect"] ?? pools["architect"] ?? pools[floor] ?? []
  }
  return pools[role] ?? pools[floor] ?? []
}

// =============================================================================
// Escalation reuse (FR-D2) — a Worker that must escalate to the Manager path
// reuses `planEscalation`, carrying its lineage / evidence / OutputRefs forward
// unchanged (`reclassified_to: "manager"`). The runtime TRIGGER that fires an
// escalation is Phase 3; this wrapper is the engine export's production call
// site so the reuse contract is honored the moment a trigger is wired.
// =============================================================================

export interface WorkerEscalationInput {
  readonly workerSessionId: string
  readonly reason: string
  readonly evidenceRefs: ReadonlyArray<string>
  readonly outputRefs: ReadonlyArray<string>
  readonly lineage: Events.DispatchLineage
}

export function escalateWorkerToManager(input: WorkerEscalationInput): HierarchyDispatcher.EscalationPlan {
  return HierarchyDispatcher.planEscalation({
    workerSessionId: input.workerSessionId as Events.DispatchLineage["parent_session_id"],
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    outputRefs: input.outputRefs,
    lineage: input.lineage,
  })
}

// =============================================================================
// Lineage record (FR-D1 / Decision #4). SELECT happens at the seam; RECORD
// happens in `tool/task.ts` AFTER the child session is created (its id is only
// known there). This helper folds the child session id into the lineage stub and
// records the dispatch on the shared `RoutingSessionState`.
//
// Correlation is REAL, not illusory: the store's `recordDispatch` only proves the
// child edge (`child_session_id == key`, which the caller always makes true), so
// on its own it validates nothing. Here we additionally validate the PARENT edge —
// the lineage's `parent_session_id` must equal the child session's ACTUAL parent
// (`expectedParentSessionId`). That catches a real mismatch: a RESUMED subagent
// session (`task_id`) whose stored parent differs from the spawning session. On a
// mismatch the record is skipped and a typed failure is returned (the caller logs
// it) — it never throws into the spawn path.
// =============================================================================

export interface RecordHierarchyDispatchResult {
  readonly ok: boolean
  readonly reason: string | null
}

export function recordHierarchyDispatch(
  store: RoutingSessionStateStore,
  childSessionId: string,
  stub: DispatchLineageStub,
  expectedParentSessionId?: string,
): RecordHierarchyDispatchResult {
  if (expectedParentSessionId !== undefined && stub.parent_session_id !== expectedParentSessionId) {
    return {
      ok: false,
      reason: `dispatch lineage parent '${stub.parent_session_id}' does not match child's actual parent '${expectedParentSessionId}'`,
    }
  }
  const lineage: Events.DispatchLineage = {
    parent_session_id: stub.parent_session_id as Events.DispatchLineage["parent_session_id"],
    child_session_id: childSessionId as Events.DispatchLineage["child_session_id"],
    parent_role: stub.parent_role,
    child_role: stub.child_role,
  }
  const { correlation } = store.recordDispatch(childSessionId as SessionID, lineage)
  return { ok: correlation.ok, reason: correlation.reason }
}

// =============================================================================
// Resolver factory — one instance per session-layer construction. Retention is
// bounded (LRU) so a long-lived `opencode serve` process cannot leak per-spawn
// state; each spawn is keyed distinctly so its FRESH decision is never reused
// for another spawn.
// =============================================================================

/** Bounded retention for per-spawn decisions. Generous headroom over any
 * realistic concurrent spawn load while capping worst-case memory. */
const SPAWN_CACHE_CAP = 1024

function buildDispatchRequest(
  input: ResolveHierarchyDispatchInput,
  childRole: Enums.HierarchyRole,
  requestedFanout: number,
  budget: Budget.Policy,
  consumed: Budget.Consumption,
): HierarchyDispatcher.DispatchRequest {
  const todo: Events.TodoPointer = {
    todo_ref: input.parentSessionId as Events.TodoPointer["todo_ref"],
    todo_version: "1" as Events.TodoPointer["todo_version"],
  }
  return {
    parent: {
      sessionId: input.parentSessionId as Events.DispatchLineage["parent_session_id"],
      role: input.parentRole,
      depth: input.parentDepth,
    },
    // The child session id is not yet known at the seam; the lineage the seam
    // returns is a stub, and `planDispatch` only uses this id to build its event.
    child: { sessionId: "" as Events.DispatchLineage["child_session_id"], role: childRole },
    todo,
    requestedFanout,
    policy: budget,
    // Feature 043 — REAL remaining headroom (budget minus the parent session's
    // recorded consumption) plus a conservative non-zero per-worker estimate, so
    // `admitDispatchFanout` grants min(requested, max_workers, cost headroom, token
    // headroom): fewer workers as the budget is spent, not `max_workers` alone.
    // With zero recorded consumption this is the full-budget headroom Feature 042
    // passed, so a fresh session is byte-identical.
    headroom: headroomFor(budget, consumed),
    perWorker: perWorkerReserve(budget),
  }
}

export function createHierarchyDispatchResolver(deps: HierarchyResolveDeps): ResolveHierarchyDispatch {
  const spawnCache = createBoundedLru<HierarchyDispatchDecision | null>(deps.spawnCacheCap ?? SPAWN_CACHE_CAP, () => {})

  async function resolveOnce(
    input: ResolveHierarchyDispatchInput,
    run: <A>(effect: Effect.Effect<A>) => Promise<A>,
  ): Promise<HierarchyDispatchDecision | undefined> {
    // 0) Leaf-delegation policy (model-pinning INDEPENDENT). A Worker is a leaf:
    // when it drives a spawn we treat the child as a PEER Worker via ordinary
    // parent-model inheritance — never a re-opened orchestration tree, and NEVER a
    // hard block. Returning `undefined` here makes the outcome IDENTICAL whether or
    // not a model is pinned (a pinned spawn skips this resolver entirely and lands
    // on the same parent-inheritance path), so leaf legality no longer depends on
    // whether a model happens to be named.
    if (input.parentRole === "worker") return undefined

    // 1) Gate — Smart Routing must be explicitly enabled in a routing mode (`auto`
    // OR `always`; Feature 045). `always` is a superset of `auto`'s aggressiveness:
    // hierarchy delegation + fan-out admission engage on every qualifying spawn, not
    // just the first. A disabled engine or `never` mode is the no-op path (each Task
    // spawn is keyed by its unique `spawnKey`, so there is no per-turn memoization to
    // bypass here — every spawn re-decides).
    const port = createConfigAdapter({ config: sessionConfigReadPort(deps.config, run) })
    const effective = await port.resolveEffective()
    const cfg = effective.config
    if (!(cfg.activation.enabled && cfg.activation.mode !== "never")) return undefined

    const hierarchy = cfg.enforcement.hierarchy
    const budget = cfg.enforcement.budget
    // Feature 048 — the opt-in orchestration mode (absent → `heuristic`). Gated by
    // the same activation check above, so `force_manager` engages ONLY when Smart
    // Routing is enabled AND the operator selected it; otherwise `heuristic`.
    const forceManager = orchestrationModeOf(hierarchy) === "force_manager"

    // 2) Classify the child role (zero-LLM, deterministic analyzer signals). Under
    // `force_manager` the Architect edge is unconditionally a Manager.
    const { childRole, requestedFanout } = classifyChildRole(
      input.parentRole,
      input.taskText,
      input.scope,
      forceManager ? "force_manager" : "heuristic",
    )

    // 3) Legality + depth + fan-out admission via the pure engine (never
    // recomputed at the seam). The parent session's recorded consumption drives
    // the REAL cost/token headroom; an absent store degrades to zero-consumption
    // (full-budget) headroom — the Feature 042 back-compat path.
    const consumed = deps.store?.get(input.parentSessionId as SessionID).consumption ?? ZERO_CONSUMPTION
    const outcome = HierarchyDispatcher.planDispatch(
      buildDispatchRequest(input, childRole, requestedFanout, budget, consumed),
    )
    if (!outcome.ok) {
      // Feature 047 (FR4) — a denied admission emits a `hierarchy.fanout` span with
      // admitted=false and the engine's typed rejection reason (never user text).
      // Armed guard first so a telemetry-OFF session allocates nothing (FR8).
      if (isTelemetryArmed()) {
        emitFanoutAdmission({
          parentRole: input.parentRole,
          childRole,
          fanoutRequested: requestedFanout,
          fanoutGranted: 0,
          admitted: false,
          deniedReason: outcome.rejection.reason,
        })
      }
      return { kind: "blocked", rejection: outcome.rejection }
    }

    // FR-B3 — the config may be STRICTER than the engine invariant; enforce the
    // MIN of the two so a config can never widen delegation beyond the engine.
    const effectiveMaxDepth = Math.min(HierarchyDispatcher.MAX_DELEGATION_DEPTH, hierarchy.max_depth)
    if (outcome.envelope.childDepth > effectiveMaxDepth) {
      if (isTelemetryArmed()) {
        emitFanoutAdmission({
          parentRole: input.parentRole,
          childRole,
          fanoutRequested: requestedFanout,
          fanoutGranted: 0,
          admitted: false,
          deniedReason: "depth_exceeded",
        })
      }
      return {
        kind: "blocked",
        rejection: {
          reason: "depth_exceeded",
          detail: `delegation depth ${outcome.envelope.childDepth} exceeds effective max ${effectiveMaxDepth}`,
        },
      }
    }

    // 4) Resolve + verify a concrete model for the child role (reuse Phase 1
    // provider re-resolution + auth-presence). The Architect tier prefers the
    // main-context model (never overridden by the pool); Manager/Worker resolve
    // from their own pools. Any unresolved / unauthenticated model degrades to
    // `undefined` (parent inheritance) — never a block.
    const model = await resolveRoleModel(cfg, childRole, input.mainContextModel, deps, run)
    if (!model) {
      // An engine-ADMITTED dispatch that cannot resolve a role model degrades to
      // parent inheritance; still emit a `hierarchy.fanout` observation
      // (admitted=false, `model_unresolved`) so every admission decision is visible.
      if (isTelemetryArmed()) {
        emitFanoutAdmission({
          parentRole: input.parentRole,
          childRole,
          fanoutRequested: requestedFanout,
          fanoutGranted: 0,
          admitted: false,
          deniedReason: "model_unresolved",
        })
      }
      // Feature 048 (FR7) — under `force_manager` SURFACE the unresolved tier as a
      // typed `degraded` decision the seam warns on before inheriting the parent
      // model. Heuristic keeps the silent `undefined` fallback (byte-identical).
      if (forceManager) return { kind: "degraded", reason: "model_unresolved", childRole }
      return undefined
    }

    // Feature 047 (FR4) — an admitted dispatch emits a `hierarchy.fanout` span with
    // the granted worker count from the engine envelope (fire-and-forget). Armed
    // guard first so a telemetry-OFF session allocates nothing (FR8).
    if (isTelemetryArmed()) {
      emitFanoutAdmission({
        parentRole: input.parentRole,
        childRole,
        fanoutRequested: requestedFanout,
        fanoutGranted: outcome.envelope.fanout.fanout_granted,
        admitted: true,
      })
    }

    return {
      kind: "route",
      model,
      childRole,
      childDepth: outcome.envelope.childDepth,
      executionAllowed: hierarchy.orchestration_only ? outcome.envelope.executionAllowed : true,
      maxDepth: effectiveMaxDepth,
      fanoutGranted: outcome.envelope.fanout.fanout_granted,
      forceManager,
      lineageStub: {
        parent_session_id: outcome.envelope.lineage.parent_session_id,
        parent_role: outcome.envelope.lineage.parent_role,
        child_role: outcome.envelope.lineage.child_role,
      },
    }
  }

  return (input) =>
    Effect.gen(function* () {
      if (spawnCache.has(input.spawnKey)) return spawnCache.get(input.spawnKey) ?? undefined

      // Capture the caller's context — it carries the request `InstanceRef`
      // binding — so every outbound seam runs bound by construction.
      const context = yield* Effect.context<never>()
      const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromiseWith(context)(effect)
      // Hang-proofing: bound the ENTIRE attempt (config/provider/auth reads) so a
      // stuck FS cannot block the spawn path. `.catch` handles crashes/rejections;
      // `timeoutOrElse` handles a HANG — both degrade to `undefined` (→ parent
      // inheritance). A `{ kind: "blocked" }` value is a normal return that
      // survives the wrap (it is a decision, not a failure).
      const resolved = yield* Effect.promise(() => resolveOnce(input, run).catch(() => undefined)).pipe(
        Effect.timeoutOrElse({ duration: RESOLVE_TIMEOUT_MS, orElse: () => Effect.succeed(undefined) }),
      )
      spawnCache.set(input.spawnKey, resolved ?? null)
      return resolved
    }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
}

/**
 * Resolve a concrete, authenticated model for a hierarchy role.
 *
 * ARCHITECT precedence (Feature 042 refinement, ADR-0042):
 *   main-context selected model  ▶  role_pools.architect  ▶  role_pools[floor_role]
 * The `mainContextModel` (the model the primary/parent session is running as) is
 * the Architect's model by definition and ALWAYS wins — the routing engine never
 * overrides it. It is the LIVE running model, so it is returned directly (no
 * re-verification); the pool tiers below are consulted ONLY when it is absent.
 *
 * MANAGER / WORKER resolve from their own role pools (`role_pools.manager` /
 * `role_pools.worker`), verified via the Phase 1 provider re-resolution +
 * auth-presence machinery; `mainContextModel` is ignored for these tiers.
 *
 * Any unresolved / unauthenticated pool model degrades to `undefined` (→ parent
 * inheritance), never a throw.
 */
export async function resolveRoleModel(
  cfg: RoutingConfig.Info,
  role: Enums.HierarchyRole,
  mainContextModel: ResolvedRoutingModel | undefined,
  deps: Pick<HierarchyResolveDeps, "provider" | "auth">,
  run: <A>(effect: Effect.Effect<A>) => Promise<A>,
): Promise<ResolvedRoutingModel | undefined> {
  if (role === "architect" && mainContextModel) return mainContextModel
  const pool = poolModelsForRole(cfg, role)
  for (const modelId of pool) {
    const providerID = await resolveProviderForModel(deps.provider, run, modelId)
    if (!providerID) continue
    const authInfo = await run(
      deps.auth.get(providerID).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (a) => a })),
    )
    if (!authInfo) continue
    return { providerID: ProviderV2.ID.make(providerID), modelID: ModelV2.ID.make(modelId) }
  }
  return undefined
}

// Re-export the LRU handle type so the resolver's bounded-retention contract is
// visible to callers that inspect it in tests.
export type { BoundedLru }
// Re-export the resolved-model shape so the live seam (`tool/task.ts`) can type a
// routed child model without reaching into `routing-resolve` directly.
export type { ResolvedRoutingModel }
