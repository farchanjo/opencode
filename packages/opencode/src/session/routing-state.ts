/**
 * Feature 001 / T029 — Session-scoped routing state.
 *
 * Carries the routing decision reference, hierarchy role, and budget
 * consumption for a Session (hierarchy-flow.md's per-Session routing
 * extension), and validates hierarchy dispatch lineage against the FR:
 * "`parent_session_id == current_session_id`" direct-child correlation
 * (plan.md S15 — Feature 002 direct-child Session UI).
 *
 * Deliberately a plain, in-memory, dependency-free keyed store (no Effect
 * runtime, no I/O, no directory-scoped InstanceState) — the routing decision
 * itself is durably persisted by `routing/domain/routing-decision.ts` (T020)
 * and the Todo aggregate by `routing/domain/todo-authority.ts` (T024) /
 * `session/todo.ts` (T030); this module only correlates a LIVE Session with
 * that decision while the process is up, and is directly unit-testable
 * without standing up the Effect Layer graph.
 */
export * as RoutingState from "./routing-state"

import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { Events } from "@opencode-ai/schema/routing/events"
import type { SessionID } from "./schema"
import { OrchestrationAggregate } from "./orchestration-aggregate"

// =============================================================================
// State shape
// =============================================================================

export interface RoutingDecisionRef {
  readonly decisionId: string
  readonly catalogVersion: string
  readonly policyVersion: string
}

/**
 * Feature 051 (FR1, FR3) — the per-turn narrowed ranked-id sets. Every field is an
 * OPTIONAL ranked id list: absent means passthrough for that surface (the full
 * permission-visible catalog, unchanged); present-and-non-empty means "narrow to
 * exactly this ranked subset." A present-but-empty list is never a valid state —
 * `live-narrowing.ts` normalizes every degenerate/empty retrieval outcome to absent
 * before this memo is written (FR3).
 */
/**
 * Feature 052 (FR1) — a resolved reference to one auto-primeable skill chunk carried on the
 * `chunks` narrowing surface: the chunk id, its parent skill name (the dedup key, FR6), the
 * `[0,1]` confidence (score-floor filtered, FR2), and the Feature 005 `body_ref` the render
 * pass resolves through `OutputSpoolStore.resolve` (FR3). Never chunk content — an id/name/
 * score/ref only, same content-free classification as the other three surfaces' ranked ids.
 */
export interface AutoSkillBodyRef {
  readonly outputRef: string
  readonly offset: number
  readonly limit: number
}
export interface AutoSkillChunkRef {
  readonly chunkId: string
  readonly skillName: string
  readonly score: number
  readonly bodyRef: AutoSkillBodyRef
}

export interface NarrowedSets {
  readonly agents?: readonly string[]
  readonly skills?: readonly string[]
  readonly tools?: readonly string[]
  /** Feature 052 (FR1) — the turn's ranked auto-skill chunk refs. Absent means passthrough
   * (no `<auto_skills>` block); a present-but-empty list is never a valid state —
   * `live-narrowing.ts` normalizes every degenerate/below-floor/provenance-excluded outcome
   * to absent before this memo is written (FR2, FR3). */
  readonly chunks?: readonly AutoSkillChunkRef[]
}

/**
 * Feature 051 (FR1) — the session-scoped narrowing memo, keyed by the turn's
 * `lastUser.id`. Every runLoop round trip of the same turn reads this SAME memo so the
 * narrowed tool/skill/agent set never mutates mid-turn (tool-call continuity).
 */
export interface NarrowedSetsMemo {
  readonly key: string
  readonly sets: NarrowedSets
}

export interface RoutingSessionState {
  readonly sessionId: SessionID
  readonly decision: RoutingDecisionRef | null
  readonly hierarchyRole: Enums.HierarchyRole | null
  /** Set only after a `hierarchy.dispatch` lineage naming this Session as the
   * child has been correlated (see `correlateDirectChild`). */
  readonly parentSessionId: SessionID | null
  readonly consumption: Budget.Consumption | null
  /** Feature 044 / Phase 3 — the Manager's roll-up of every delegated Worker
   * (FR-A1). Present only for a Manager that dispatched under `auto`-mode
   * hierarchy routing; `null` for a plain/disabled session (byte-identical to
   * pre-F044). Released with the session (see `clear`). */
  readonly aggregate: OrchestrationAggregate.ManagerWorkerAggregate | null
  /** Feature 051 (FR1) — the memoized per-turn narrowing decision, keyed by
   * `lastUser.id`; `null` until the turn's `narrowForTurn` completes a non-degenerate
   * pass. Released with the session (see `clear`). */
  readonly narrowedSets: NarrowedSetsMemo | null
  /** Feature 052 (FR6) — the session-scoped set of skill names already rendered into an
   * `<auto_skills>` block; a skill in this set is never auto-injected again this session
   * (Tier-1 listing and `skill`-tool loading are unaffected). `null` until the first
   * injection. Released with the session (see `clear`). */
  readonly autoSkillInjected: ReadonlySet<string> | null
  /** Feature 053 (FR5) — true iff this session is a Data or Composer sub-session created
   * by the orchestration-handoff interception. Stamped at creation, BEFORE the sub-session's
   * own turn runs, so a synthetic sub-session can never itself re-trigger the interception
   * (zero nested interceptions is a structural invariant). Default `false`; released with the
   * session (see `clear`), mirroring the `autoSkillInjected` extension pattern. */
  readonly synthetic: boolean
}

function empty(sessionId: SessionID): RoutingSessionState {
  return {
    sessionId,
    decision: null,
    hierarchyRole: null,
    parentSessionId: null,
    consumption: null,
    aggregate: null,
    narrowedSets: null,
    autoSkillInjected: null,
    synthetic: false,
  }
}

// =============================================================================
// Direct-child correlation — FR: parent_session_id == current_session_id
// =============================================================================

/**
 * True iff `lineage` names `currentSessionId` as the PARENT edge — i.e.
 * `currentSessionId` is looking at one of its own direct children.
 * Pure string equality: `routing/ids.SessionId` is a provider-agnostic plain
 * string and opencode's `SessionID` is a branded `"ses_..."` string; the two
 * domains correlate over the literal id value, never structurally.
 */
export function isDirectChildOf(lineage: Events.DispatchLineage, currentSessionId: SessionID): boolean {
  return lineage.parent_session_id === (currentSessionId as string)
}

export interface DispatchCorrelation {
  readonly ok: boolean
  readonly reason: string | null
}

/** Integrity guard for `recordDispatch`: is `lineage` really about `sessionId` as the CHILD edge? */
function correlateAsChild(lineage: Events.DispatchLineage, sessionId: SessionID): DispatchCorrelation {
  if (lineage.child_session_id !== (sessionId as string)) {
    return { ok: false, reason: "dispatch lineage.child_session_id does not match this session" }
  }
  return { ok: true, reason: null }
}

// =============================================================================
// Store
// =============================================================================

export interface RecordDispatchResult {
  readonly state: RoutingSessionState
  readonly correlation: DispatchCorrelation
}

export interface RoutingSessionStateStore {
  readonly get: (sessionId: SessionID) => RoutingSessionState
  /** Attach the routing decision that selected this Session's specialist agent / model. */
  readonly recordDecision: (
    sessionId: SessionID,
    decision: RoutingDecisionRef,
    hierarchyRole: Enums.HierarchyRole,
  ) => RoutingSessionState
  /** Attach lineage from a `hierarchy.dispatch` event naming this Session as the child.
   * Rejected (state unchanged) when the lineage does not correlate to `sessionId`. */
  readonly recordDispatch: (sessionId: SessionID, lineage: Events.DispatchLineage) => RecordDispatchResult
  readonly recordConsumption: (sessionId: SessionID, consumption: Budget.Consumption) => RoutingSessionState
  /** Feature 044 (FR-A1) — record a newly delegated Worker as `pending` on the
   * MANAGER's aggregate (the aggregate root, keyed by manager session id; each
   * roster entry keyed by child session id). Lazily creates the aggregate. */
  readonly recordDelegatedWorker: (
    managerSessionId: SessionID,
    outcome: OrchestrationAggregate.WorkerOutcome,
  ) => RoutingSessionState
  /** Feature 044 (FR-A2, FR-D2) — apply a Worker terminal transition (the wake).
   * Coalesced/idempotent: a child already terminal is a no-op. A manager with no
   * aggregate (never delegated) is left untouched. */
  readonly updateWorkerOutcome: (
    managerSessionId: SessionID,
    outcome: OrchestrationAggregate.WorkerOutcome,
  ) => RoutingSessionState
  /** Feature 051 (FR1) — memoize the turn's narrowed ranked-id sets keyed by
   * `lastUser.id`. Read back via `get(sessionId).narrowedSets`; cleared with the rest
   * of the state at `clear`. */
  readonly recordNarrowedSets: (sessionId: SessionID, key: string, sets: NarrowedSets) => RoutingSessionState
  /** Feature 052 (FR6) — record every skill name actually rendered into an `<auto_skills>`
   * block this turn, merging into the session-scoped dedup set (lazily created); cleared with
   * the rest of the state at `clear`. Idempotent — re-recording a name is a no-op. */
  readonly recordAutoSkillInjected: (sessionId: SessionID, skillNames: readonly string[]) => RoutingSessionState
  /** Feature 053 (FR5) — stamp a session as a synthetic Data/Composer sub-session, BEFORE its
   * own turn runs, so it can never re-trigger the orchestration-handoff interception. Cleared
   * with the rest of the state at `clear`. Idempotent — re-marking a synthetic session is a no-op. */
  readonly markSynthetic: (sessionId: SessionID) => RoutingSessionState
  readonly clear: (sessionId: SessionID) => void
}

export function createRoutingSessionStateStore(): RoutingSessionStateStore {
  const states = new Map<SessionID, RoutingSessionState>()

  function current(sessionId: SessionID): RoutingSessionState {
    return states.get(sessionId) ?? empty(sessionId)
  }

  function put(next: RoutingSessionState): RoutingSessionState {
    states.set(next.sessionId, next)
    return next
  }

  return {
    get: current,

    recordDecision(sessionId, decision, hierarchyRole) {
      return put({ ...current(sessionId), decision, hierarchyRole })
    },

    recordDispatch(sessionId, lineage) {
      const correlation = correlateAsChild(lineage, sessionId)
      if (!correlation.ok) return { state: current(sessionId), correlation }
      const next = put({
        ...current(sessionId),
        hierarchyRole: lineage.child_role,
        parentSessionId: lineage.parent_session_id as SessionID,
      })
      return { state: next, correlation }
    },

    recordConsumption(sessionId, consumption) {
      return put({ ...current(sessionId), consumption })
    },

    recordDelegatedWorker(managerSessionId, outcome) {
      const state = current(managerSessionId)
      const aggregate = state.aggregate ?? OrchestrationAggregate.emptyAggregate(managerSessionId)
      return put({ ...state, aggregate: OrchestrationAggregate.recordWorker(aggregate, outcome) })
    },

    updateWorkerOutcome(managerSessionId, outcome) {
      const state = current(managerSessionId)
      if (!state.aggregate) return state
      return put({ ...state, aggregate: OrchestrationAggregate.applyWorkerTransition(state.aggregate, outcome) })
    },

    recordNarrowedSets(sessionId, key, sets) {
      return put({ ...current(sessionId), narrowedSets: { key, sets } })
    },

    recordAutoSkillInjected(sessionId, skillNames) {
      const state = current(sessionId)
      const merged = new Set(state.autoSkillInjected ?? [])
      for (const name of skillNames) merged.add(name)
      return put({ ...state, autoSkillInjected: merged })
    },

    markSynthetic(sessionId) {
      return put({ ...current(sessionId), synthetic: true })
    },

    clear(sessionId) {
      states.delete(sessionId)
    },
  }
}
