/**
 * Feature 001 / T023 — Hierarchy dispatcher (Feature 056 collapse).
 *
 * Produces main (Architect = Architect+Manager) -> Worker dispatch envelopes
 * (ADR-0056 supersedes ADR-0002 three-tier depth). Pure domain: no I/O, no
 * Effect runtime, no model call. Composes the real budget-policy admission
 * export (`admitFanout`) with cost/token headroom, and emits the
 * `Events.RoutingEvent` hierarchy members (hierarchy.dispatch, hierarchy.escalation,
 * hierarchy.validation) as plain typed values.
 *
 * Invariants enforced here (a model, plugin or nested instruction can never
 * relax them):
 *   - Max delegation depth 1: Architect(edge0) -> Worker(edge1). No Manager child.
 *   - Orchestration-only main (architect): only a Worker child carries
 *     execution authority; main dispatches are orchestration.
 *   - Legal edges only: architect->worker. Manager parent has no children
 *     (obsolete middle tier). Worker MUST NOT create anything.
 *   - Admission-controlled fanout: granted =
 *     min(requested, max_workers, cost_budget headroom, token_budget headroom).
 *   - Reused evidence / OutputRefs / lineage on escalation (no re-derivation).
 */
export * as HierarchyDispatcher from "./hierarchy-dispatcher"

import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { Events } from "@opencode-ai/schema/routing/events"
import { admitFanout, type Outcome } from "./budget-policy"

// =============================================================================
// Roles, depth and legal transitions
// =============================================================================

/** Main (architect) -> Worker: one delegation edge maximum (ADR-0056 / Feature 056). */
export const MAX_DELEGATION_DEPTH = 1

const ORCHESTRATOR_ROLES: ReadonlySet<Enums.HierarchyRole> = new Set(["architect", "manager"])

// Legal child roles per parent role (Feature 056): architect -> worker only.
// Manager parent has no children (middle tier collapsed into main). Worker is a leaf.
// Nobody dispatches an Architect.
const LEGAL_CHILDREN: Readonly<Record<Enums.HierarchyRole, ReadonlyArray<Enums.HierarchyRole>>> = {
  architect: ["worker"],
  manager: [],
  worker: [],
}

/** A Worker child carries execution authority; Architect/Manager are orchestration-only. */
export function isOrchestrationOnly(role: Enums.HierarchyRole): boolean {
  return ORCHESTRATOR_ROLES.has(role)
}

function isLegalEdge(parent: Enums.HierarchyRole, child: Enums.HierarchyRole): boolean {
  return LEGAL_CHILDREN[parent].includes(child)
}

// =============================================================================
// Admission-controlled fanout: min(requested, max_workers, cost, tokens)
// =============================================================================

/** Per-worker cost/token estimates used to convert remaining budget into a worker count. */
export interface WorkerCost {
  readonly costUsd: number
  readonly tokens: number
}

/** Remaining budget headroom at dispatch time (budget - consumption). */
export interface BudgetHeadroom {
  readonly costUsd: number
  readonly tokens: number
}

export interface FanoutFactors {
  readonly requested: number
  readonly byMaxWorkers: number
  readonly byCostBudget: number
  readonly byTokenBudget: number
}

export interface FanoutAdmissionResult {
  readonly granted: number
  readonly factors: FanoutFactors
  readonly outcome: Outcome
  /** Non-null when the request could not proceed (granted 0 for a positive request). */
  readonly reason: string | null
}

// A non-positive per-worker estimate means "unbounded by that factor" — the
// request is not throttled by a cost/token dimension we cannot price.
function headroomWorkers(headroom: number, perWorker: number, requested: number): number {
  if (!Number.isFinite(headroom) || !Number.isFinite(perWorker)) return 0
  if (perWorker <= 0) return requested
  return Math.max(0, Math.floor(headroom / perWorker))
}

/**
 * Admission controller: grants min(requested, max_workers, cost headroom,
 * token headroom). The `max_workers` factor is delegated to the real
 * budget-policy `admitFanout` export (single source of truth for that cap);
 * cost and token headroom are folded in on top.
 */
export function admitDispatchFanout(
  policy: Budget.Policy,
  requestedWorkers: number,
  headroom: BudgetHeadroom,
  perWorker: WorkerCost,
): FanoutAdmissionResult {
  const requested = Number.isFinite(requestedWorkers) ? Math.max(0, requestedWorkers) : 0
  const byMaxWorkers = admitFanout(policy, requested).granted
  const byCostBudget = headroomWorkers(headroom.costUsd, perWorker.costUsd, requested)
  const byTokenBudget = headroomWorkers(headroom.tokens, perWorker.tokens, requested)
  const granted = Math.max(0, Math.min(requested, byMaxWorkers, byCostBudget, byTokenBudget))

  const factors: FanoutFactors = { requested, byMaxWorkers, byCostBudget, byTokenBudget }
  if (requested > 0 && granted === 0) {
    return { granted, factors, outcome: "blocked", reason: limitingFactor(factors) }
  }
  return { granted, factors, outcome: "ok", reason: null }
}

function limitingFactor(factors: FanoutFactors): string {
  if (factors.byMaxWorkers === 0) return "admission denied: max_workers budget is 0"
  if (factors.byCostBudget === 0) return "admission denied: insufficient cost_budget headroom for one worker"
  if (factors.byTokenBudget === 0) return "admission denied: insufficient token_budget headroom for one worker"
  return "admission denied"
}

// =============================================================================
// Dispatch envelope
// =============================================================================

/** Parent context: its session, role and the delegation edges already used to reach it. */
export interface DispatchParent {
  readonly sessionId: Events.DispatchLineage["parent_session_id"]
  readonly role: Enums.HierarchyRole
  /** Edges consumed to reach the parent (Architect root = 0). */
  readonly depth: number
}

export interface DispatchChild {
  readonly sessionId: Events.DispatchLineage["child_session_id"]
  readonly role: Enums.HierarchyRole
}

export interface DispatchRequest {
  readonly parent: DispatchParent
  readonly child: DispatchChild
  readonly todo: Events.TodoPointer
  readonly requestedFanout: number
  readonly policy: Budget.Policy
  readonly headroom: BudgetHeadroom
  readonly perWorker: WorkerCost
}

export interface DispatchEnvelope {
  readonly event: Events.HierarchyDispatchEvent
  readonly lineage: Events.DispatchLineage
  readonly fanout: Events.DispatchFanout
  /** Edges used to reach the child = parent.depth + 1. */
  readonly childDepth: number
  /** True only for a Worker child — Architect/Manager children stay orchestration-only. */
  readonly executionAllowed: boolean
  readonly admission: FanoutAdmissionResult
}

export type DispatchRejectionReason =
  | "illegal_transition"
  | "depth_exceeded"
  | "parent_not_orchestrator"
  | "admission_denied"

export interface DispatchRejection {
  readonly reason: DispatchRejectionReason
  readonly detail: string
}

export type DispatchOutcome =
  | { readonly ok: true; readonly envelope: DispatchEnvelope }
  | { readonly ok: false; readonly rejection: DispatchRejection }

function reject(reason: DispatchRejectionReason, detail: string): DispatchOutcome {
  return { ok: false, rejection: { reason, detail } }
}

/**
 * Plan one dispatch edge. Rejects (never throws) when a hard invariant is
 * violated — illegal role transition, delegation depth over 1, an
 * orchestration-only violation, or a fully-denied fanout admission — otherwise
 * returns the envelope with the `hierarchy.dispatch` event, lineage, fanout
 * counters and the child's execution authority flag.
 */
export function planDispatch(request: DispatchRequest): DispatchOutcome {
  const { parent, child } = request

  if (!isOrchestrationOnly(parent.role)) {
    return reject("parent_not_orchestrator", `role '${parent.role}' cannot dispatch; only orchestrators may delegate`)
  }
  if (!isLegalEdge(parent.role, child.role)) {
    return reject("illegal_transition", `illegal delegation edge '${parent.role}' -> '${child.role}'`)
  }

  const childDepth = parent.depth + 1
  if (childDepth > MAX_DELEGATION_DEPTH) {
    return reject("depth_exceeded", `delegation depth ${childDepth} exceeds max ${MAX_DELEGATION_DEPTH}`)
  }

  const admission = admitDispatchFanout(request.policy, request.requestedFanout, request.headroom, request.perWorker)
  if (admission.outcome === "blocked") {
    return reject("admission_denied", admission.reason ?? "fanout admission denied")
  }

  const lineage: Events.DispatchLineage = {
    parent_session_id: parent.sessionId,
    child_session_id: child.sessionId,
    parent_role: parent.role,
    child_role: child.role,
  }
  const fanout: Events.DispatchFanout = {
    delegation_depth: childDepth,
    fanout_requested: admission.factors.requested,
    fanout_granted: admission.granted,
  }
  const event: Events.HierarchyDispatchEvent = { type: "hierarchy.dispatch", lineage, fanout, todo: request.todo }

  return {
    ok: true,
    envelope: {
      event,
      lineage,
      fanout,
      childDepth,
      executionAllowed: child.role === "worker",
      admission,
    },
  }
}

// =============================================================================
// Escalation — reuse evidence / OutputRefs / lineage
// =============================================================================

export interface EscalationRequest {
  readonly workerSessionId: Events.HierarchyEscalationEvent["worker_session_id"]
  readonly reason: string
  /** Evidence gathered by the Worker — reused verbatim, never re-derived. */
  readonly evidenceRefs: ReadonlyArray<string>
  /** OutputSpool references produced by the Worker — reused on the reclassified Manager path. */
  readonly outputRefs: ReadonlyArray<string>
  /** Original dispatch lineage — reused so the escalation stays correlated to its edge. */
  readonly lineage: Events.DispatchLineage
}

export interface EscalationPlan {
  readonly event: Events.HierarchyEscalationEvent
  /** The reused evidence references (same instances as the request). */
  readonly reusedEvidence: ReadonlyArray<string>
  /** The reused OutputSpool references (same instances as the request). */
  readonly reusedOutputRefs: ReadonlyArray<string>
  /** The reused originating lineage. */
  readonly lineage: Events.DispatchLineage
}

/**
 * Plan an escalation from a Worker back to main's orchestrator duties
 * (Feature 056: main absorbs Manager; no Manager child session).
 * Wire field `reclassified_to: "manager"` is protocol-frozen and means
 * "replan / more Workers under main's manager responsibilities", not a
 * middle-tier Manager spawn. Evidence, OutputRefs and lineage are reused.
 */
export function planEscalation(request: EscalationRequest): EscalationPlan {
  const event: Events.HierarchyEscalationEvent = {
    type: "hierarchy.escalation",
    worker_session_id: request.workerSessionId,
    reason: request.reason,
    evidence_refs: request.evidenceRefs,
    reclassified_to: "manager",
  }
  return {
    event,
    reusedEvidence: request.evidenceRefs,
    reusedOutputRefs: request.outputRefs,
    lineage: request.lineage,
  }
}

// =============================================================================
// Validation event helper (Worker -> main Architect/Manager validation chain)
// =============================================================================

export interface ValidationInput {
  readonly sessionId: Events.HierarchyValidationEvent["session_id"]
  readonly role: Enums.HierarchyRole
  readonly outcome: Events.ValidationOutcome
  readonly reason: string
}

/** Build a `hierarchy.validation` event for one link of the validation chain. */
export function validationEvent(input: ValidationInput): Events.HierarchyValidationEvent {
  return {
    type: "hierarchy.validation",
    session_id: input.sessionId,
    role: input.role,
    outcome: input.outcome,
    validation_reason: input.reason,
  }
}
