// DDD role: ValueObject
// Package: routing.events
// Routing and dispatch event members of the RoutingEvent union.

package routing.events

import (
	"routing/ids"
	"routing/enums"
	"routing/budget"
)

#RoutingDecisionEvent: {
	type:            "routing.decision"
	correlation:     #DecisionCorrelation
	classification:  #EventClassification
	selection:       #EventSelection
	hierarchy_role:  enums.#HierarchyRole
	budget_snapshot: budget.#BudgetPolicySnapshot
}

#RoutingFallbackEvent: {
	type:               "routing.fallback"
	decision_id:        ids.#DecisionId
	reason:             ids.#Reason
	execution_boundary: enums.#ExecutionBoundary
	candidate_selected: ids.#ModelId
}

#HierarchyDispatchEvent: {
	type:    "hierarchy.dispatch"
	lineage: #DispatchLineage
	fanout:  #DispatchFanout
	todo:    #TodoPointer
}

#HierarchyValidationEvent: {
	type:              "hierarchy.validation"
	session_id:        ids.#SessionId
	role:              enums.#HierarchyRole
	outcome:           #ValidationOutcome
	validation_reason: ids.#Reason
}
