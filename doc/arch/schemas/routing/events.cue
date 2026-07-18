// DDD role: ValueObject
// Package: routing.events
// RoutingEvent — EventV2 tagged union for all Feature 001 hierarchy events.

package routing.events

import (
	"routing/ids"
	"routing/enums"
)

#ValidationOutcome: "passed" | "failed" | "low_confidence" | "escalated"
#RoutingEventType:  "routing.decision" | "routing.fallback" | "hierarchy.dispatch" | "hierarchy.validation" | "hierarchy.escalation" | "capability.mismatch" | "todo.initialized" | "todo.completion_blocked"

// DecisionCorrelation carries the routing-decision correlation identifiers.
#DecisionCorrelation: {
	session_id:  ids.#SessionId
	turn_id:     ids.#TurnId
	decision_id: ids.#DecisionId
}

// EventClassification carries the task classification outcome on an event.
#EventClassification: {
	task_class:      enums.#TaskClass
	routing_profile: enums.#RoutingProfile
}

// EventSelection carries the two-stage pipeline result on an event.
#EventSelection: {
	specialist_agent: ids.#AgentId
	executor_model:   ids.#ModelId
}

// DispatchLineage carries parent/child session and role on a dispatch event.
#DispatchLineage: {
	parent_session_id: ids.#SessionId
	child_session_id:  ids.#SessionId
	parent_role:       enums.#HierarchyRole
	child_role:        enums.#HierarchyRole
}

// DispatchFanout carries delegation depth and fanout counters.
#DispatchFanout: {
	delegation_depth: uint & >=0
	fanout_requested: uint & >=0
	fanout_granted:   uint & >=0
}

// TodoPointer references a Todo aggregate at a specific revision.
#TodoPointer: {
	todo_ref:     ids.#TodoRef
	todo_version: ids.#TodoVersion
}

// EvidenceRefs is the first-class collection of evidence references.
#EvidenceRefs: [...ids.#Reason]

// RoutingEvent is the closed tagged union of all Feature 001 events.
#RoutingEvent: (
	#RoutingDecisionEvent |
	#RoutingFallbackEvent |
	#HierarchyDispatchEvent |
	#HierarchyValidationEvent |
	#HierarchyEscalationEvent |
	#CapabilityMismatchEvent |
	#TodoInitializedEvent |
	#TodoCompletionBlockedEvent
) @if(type != #RoutingEvent.type)
