// DDD role: ValueObject
// Package: routing.events
// Escalation, capability and todo event members of the RoutingEvent union.

package routing.events

import "routing/ids"

#HierarchyEscalationEvent: {
	type:              "hierarchy.escalation"
	worker_session_id: ids.#SessionId
	reason:            ids.#Reason
	evidence_refs:     #EvidenceRefs
	reclassified_to:   "manager"
}

#CapabilityMismatchEvent: {
	type:        "capability.mismatch"
	provider:    ids.#ProviderName
	model:       ids.#ModelId
	dimension:   ids.#CapabilityDimension
	requirement: ids.#Requirement
	outcome:     ids.#Reason
}

#TodoInitializedEvent: {
	type:         "todo.initialized"
	session_id:   ids.#SessionId
	todo_ref:     ids.#TodoRef
	todo_version: ids.#TodoVersion
	item_count:   uint & >=0
}

#TodoCompletionBlockedEvent: {
	type:          "todo.completion_blocked"
	session_id:    ids.#SessionId
	reason:        ids.#Reason
	pending_items: uint & >=0
}
