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

// =============================================================================
// State shape
// =============================================================================

export interface RoutingDecisionRef {
  readonly decisionId: string
  readonly catalogVersion: string
  readonly policyVersion: string
}

export interface RoutingSessionState {
  readonly sessionId: SessionID
  readonly decision: RoutingDecisionRef | null
  readonly hierarchyRole: Enums.HierarchyRole | null
  /** Set only after a `hierarchy.dispatch` lineage naming this Session as the
   * child has been correlated (see `correlateDirectChild`). */
  readonly parentSessionId: SessionID | null
  readonly consumption: Budget.Consumption | null
}

function empty(sessionId: SessionID): RoutingSessionState {
  return { sessionId, decision: null, hierarchyRole: null, parentSessionId: null, consumption: null }
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

    clear(sessionId) {
      states.delete(sessionId)
    },
  }
}
