export * as Events from "./events"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"
import { Budget } from "./budget"
import { Enums } from "./enums"
import { Ids } from "./ids"

// Mirrors doc/arch/schemas/routing/events.cue, events-routing.cue and
// events-hierarchy.cue — the EventV2 tagged union for all Feature 001
// hierarchy events.

// HierarchyRole is canonically defined in ./enums (mirrors enums.cue) and
// re-exported here unchanged for direct access as Events.HierarchyRole.
export { HierarchyRole } from "./enums"

export const ValidationOutcome = Schema.Literals(["passed", "failed", "low_confidence", "escalated"]).annotate({
  identifier: "RoutingEvent.ValidationOutcome",
})
export type ValidationOutcome = typeof ValidationOutcome.Type

// DecisionCorrelation carries the routing-decision correlation identifiers.
export interface DecisionCorrelation extends Schema.Schema.Type<typeof DecisionCorrelation> {}
export const DecisionCorrelation = Schema.Struct({
  session_id: Ids.SessionId,
  turn_id: Ids.TurnId,
  decision_id: Ids.DecisionId,
}).annotate({ identifier: "RoutingEvent.DecisionCorrelation" })

// EventClassification carries the task classification outcome on an event.
export interface EventClassification extends Schema.Schema.Type<typeof EventClassification> {}
export const EventClassification = Schema.Struct({
  task_class: Enums.TaskClass,
  routing_profile: Enums.RoutingProfile,
}).annotate({ identifier: "RoutingEvent.EventClassification" })

// EventSelection carries the two-stage pipeline result on an event.
export interface EventSelection extends Schema.Schema.Type<typeof EventSelection> {}
export const EventSelection = Schema.Struct({
  specialist_agent: Ids.AgentId,
  executor_model: Ids.ModelId,
}).annotate({ identifier: "RoutingEvent.EventSelection" })

// DispatchLineage carries parent/child session and role on a dispatch event.
export interface DispatchLineage extends Schema.Schema.Type<typeof DispatchLineage> {}
export const DispatchLineage = Schema.Struct({
  parent_session_id: Ids.SessionId,
  child_session_id: Ids.SessionId,
  parent_role: Enums.HierarchyRole,
  child_role: Enums.HierarchyRole,
}).annotate({ identifier: "RoutingEvent.DispatchLineage" })

// DispatchFanout carries delegation depth and fanout counters.
export interface DispatchFanout extends Schema.Schema.Type<typeof DispatchFanout> {}
export const DispatchFanout = Schema.Struct({
  delegation_depth: NonNegativeInt,
  fanout_requested: NonNegativeInt,
  fanout_granted: NonNegativeInt,
}).annotate({ identifier: "RoutingEvent.DispatchFanout" })

// TodoPointer references a Todo aggregate at a specific revision.
export interface TodoPointer extends Schema.Schema.Type<typeof TodoPointer> {}
export const TodoPointer = Schema.Struct({
  todo_ref: Ids.TodoRef,
  todo_version: Ids.TodoVersion,
}).annotate({ identifier: "RoutingEvent.TodoPointer" })

// EvidenceRefs is the first-class collection of evidence references.
export const EvidenceRefs = Schema.Array(Ids.Reason).annotate({ identifier: "RoutingEvent.EvidenceRefs" })
export type EvidenceRefs = typeof EvidenceRefs.Type

// --- events-routing.cue: routing and dispatch event members ---

export interface RoutingDecisionEvent extends Schema.Schema.Type<typeof RoutingDecisionEvent> {}
export const RoutingDecisionEvent = Schema.Struct({
  type: Schema.Literal("routing.decision"),
  correlation: DecisionCorrelation,
  classification: EventClassification,
  selection: EventSelection,
  hierarchy_role: Enums.HierarchyRole,
  budget_snapshot: Budget.PolicySnapshot,
}).annotate({ identifier: "RoutingEvent.RoutingDecisionEvent" })

export interface RoutingFallbackEvent extends Schema.Schema.Type<typeof RoutingFallbackEvent> {}
export const RoutingFallbackEvent = Schema.Struct({
  type: Schema.Literal("routing.fallback"),
  decision_id: Ids.DecisionId,
  reason: Ids.Reason,
  execution_boundary: Enums.ExecutionBoundary,
  candidate_selected: Ids.ModelId,
}).annotate({ identifier: "RoutingEvent.RoutingFallbackEvent" })

export interface HierarchyDispatchEvent extends Schema.Schema.Type<typeof HierarchyDispatchEvent> {}
export const HierarchyDispatchEvent = Schema.Struct({
  type: Schema.Literal("hierarchy.dispatch"),
  lineage: DispatchLineage,
  fanout: DispatchFanout,
  todo: TodoPointer,
}).annotate({ identifier: "RoutingEvent.HierarchyDispatchEvent" })

export interface HierarchyValidationEvent extends Schema.Schema.Type<typeof HierarchyValidationEvent> {}
export const HierarchyValidationEvent = Schema.Struct({
  type: Schema.Literal("hierarchy.validation"),
  session_id: Ids.SessionId,
  role: Enums.HierarchyRole,
  outcome: ValidationOutcome,
  validation_reason: Ids.Reason,
}).annotate({ identifier: "RoutingEvent.HierarchyValidationEvent" })

// --- events-hierarchy.cue: escalation, capability and todo event members ---

export interface HierarchyEscalationEvent extends Schema.Schema.Type<typeof HierarchyEscalationEvent> {}
export const HierarchyEscalationEvent = Schema.Struct({
  type: Schema.Literal("hierarchy.escalation"),
  worker_session_id: Ids.SessionId,
  reason: Ids.Reason,
  evidence_refs: EvidenceRefs,
  reclassified_to: Schema.Literal("manager"),
}).annotate({ identifier: "RoutingEvent.HierarchyEscalationEvent" })

export interface CapabilityMismatchEvent extends Schema.Schema.Type<typeof CapabilityMismatchEvent> {}
export const CapabilityMismatchEvent = Schema.Struct({
  type: Schema.Literal("capability.mismatch"),
  provider: Ids.ProviderName,
  model: Ids.ModelId,
  dimension: Ids.CapabilityDimension,
  requirement: Ids.Requirement,
  outcome: Ids.Reason,
}).annotate({ identifier: "RoutingEvent.CapabilityMismatchEvent" })

export interface TodoInitializedEvent extends Schema.Schema.Type<typeof TodoInitializedEvent> {}
export const TodoInitializedEvent = Schema.Struct({
  type: Schema.Literal("todo.initialized"),
  session_id: Ids.SessionId,
  todo_ref: Ids.TodoRef,
  todo_version: Ids.TodoVersion,
  item_count: NonNegativeInt,
}).annotate({ identifier: "RoutingEvent.TodoInitializedEvent" })

export interface TodoCompletionBlockedEvent extends Schema.Schema.Type<typeof TodoCompletionBlockedEvent> {}
export const TodoCompletionBlockedEvent = Schema.Struct({
  type: Schema.Literal("todo.completion_blocked"),
  session_id: Ids.SessionId,
  reason: Ids.Reason,
  pending_items: NonNegativeInt,
}).annotate({ identifier: "RoutingEvent.TodoCompletionBlockedEvent" })

// --- #RoutingEvent: the closed tagged union of all Feature 001 events ---

export const RoutingEvent = Schema.Union([
  RoutingDecisionEvent,
  RoutingFallbackEvent,
  HierarchyDispatchEvent,
  HierarchyValidationEvent,
  HierarchyEscalationEvent,
  CapabilityMismatchEvent,
  TodoInitializedEvent,
  TodoCompletionBlockedEvent,
]).annotate({ identifier: "RoutingEvent.RoutingEvent" })
export type RoutingEvent = typeof RoutingEvent.Type
