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
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
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
  readonly lineageStub: DispatchLineageStub
}

export interface HierarchyBlockedDecision {
  readonly kind: "blocked"
  readonly rejection: HierarchyDispatcher.DispatchRejection
}

export type HierarchyDispatchDecision = HierarchyRouteDecision | HierarchyBlockedDecision

export type ResolveHierarchyDispatch = (
  input: ResolveHierarchyDispatchInput,
) => Effect.Effect<HierarchyDispatchDecision | undefined>

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
 * pure function so the boundary is unit-testable and tunable in one place. */
export function classifyChildRole(parentRole: Enums.HierarchyRole, taskText: string, scope: Budget.Scope): Classification {
  const analysis = createTaskAnalyzer().analyze({ taskDescription: taskText, scope })
  const workUnits = analysis.inputs.structure.independent_units
  const domains = analysis.inputs.structure.domain_count
  const parallel = analysis.inputs.concurrency.parallelism >= PARALLEL_THRESHOLD
  const requestedFanout = parallel ? Math.max(workUnits, WORK_UNIT_THRESHOLD) : 1

  // A Manager parent may only ever create a Worker (LEGAL_CHILDREN); only the
  // Architect edge consults the fan-out heuristic.
  if (parentRole !== "architect") return { childRole: "worker", requestedFanout: 1 }

  const managerWarranted = (workUnits >= WORK_UNIT_THRESHOLD && domains >= DOMAIN_THRESHOLD) || requestedFanout > FANOUT_FLOOR
  return { childRole: managerWarranted ? "manager" : "worker", requestedFanout: managerWarranted ? requestedFanout : 1 }
}

// =============================================================================
// Role -> pool mapping (Decision #2). The child role selects its candidate pool:
// Worker -> role_pools.worker, Manager -> role_pools.manager. The Architect (the
// root) draws from role_pools[decision_model.pool[0]] (the role named by the
// decision model). Fallbacks: decision_model.pool empty -> role_pools.architect
// -> role_pools[fallback.floor_role].
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
    headroom: { costUsd: budget.cost.cost_budget_usd, tokens: budget.cost.token_budget },
    // A non-positive per-worker estimate means "unbounded by that factor": Phase 2
    // does not price a spawn, so admission is governed by max_workers alone.
    perWorker: { costUsd: 0, tokens: 0 },
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

    // 1) Gate — Smart Routing must be explicitly enabled in `auto` mode.
    const port = createConfigAdapter({ config: sessionConfigReadPort(deps.config, run) })
    const effective = await port.resolveEffective()
    const cfg = effective.config
    if (!(cfg.activation.enabled && cfg.activation.mode === "auto")) return undefined

    const hierarchy = cfg.enforcement.hierarchy
    const budget = cfg.enforcement.budget

    // 2) Classify the child role (zero-LLM, deterministic analyzer signals).
    const { childRole, requestedFanout } = classifyChildRole(input.parentRole, input.taskText, input.scope)

    // 3) Legality + depth via the pure engine (never recomputed at the seam).
    const outcome = HierarchyDispatcher.planDispatch(
      buildDispatchRequest(input, childRole, requestedFanout, budget),
    )
    if (!outcome.ok) return { kind: "blocked", rejection: outcome.rejection }

    // FR-B3 — the config may be STRICTER than the engine invariant; enforce the
    // MIN of the two so a config can never widen delegation beyond the engine.
    const effectiveMaxDepth = Math.min(HierarchyDispatcher.MAX_DELEGATION_DEPTH, hierarchy.max_depth)
    if (outcome.envelope.childDepth > effectiveMaxDepth) {
      return {
        kind: "blocked",
        rejection: {
          reason: "depth_exceeded",
          detail: `delegation depth ${outcome.envelope.childDepth} exceeds effective max ${effectiveMaxDepth}`,
        },
      }
    }

    // 4) Resolve + verify a concrete model for the child role (reuse Phase 1
    // provider re-resolution + auth-presence). Any unresolved / unauthenticated
    // model degrades to `undefined` (parent inheritance) — never a block.
    const model = await resolveChildModel(cfg, childRole, deps, run)
    if (!model) return undefined

    return {
      kind: "route",
      model,
      childRole,
      childDepth: outcome.envelope.childDepth,
      executionAllowed: hierarchy.orchestration_only ? outcome.envelope.executionAllowed : true,
      maxDepth: effectiveMaxDepth,
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

async function resolveChildModel(
  cfg: RoutingConfig.Info,
  childRole: Enums.HierarchyRole,
  deps: HierarchyResolveDeps,
  run: <A>(effect: Effect.Effect<A>) => Promise<A>,
): Promise<ResolvedRoutingModel | undefined> {
  const pool = poolModelsForRole(cfg, childRole)
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
