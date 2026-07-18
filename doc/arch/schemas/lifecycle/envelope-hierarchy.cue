// DDD role: ValueObject
// Package: lifecycle.envelope
// Hierarchy context reused verbatim from Feature 001 routing/hierarchy events (C15).
// Present on the envelope only when Smart hierarchical routing is active.

package lifecycle.envelope

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// DelegationPath is the first-class collection of ancestor session ids.
#DelegationPath: [...ids.#SessionId]

// Delegation carries delegation depth and the delegation path.
#Delegation: {
	depth: ids.#DelegationDepth
	path:  #DelegationPath
}

// HierarchyCorrelation carries the routing decision and turn correlation ids.
#HierarchyCorrelation: {
	decision_id: ids.#DecisionId
	turn_id:     ids.#TurnId
}

// HierarchyContext projects role, delegation, fanout and validation for a node.
#HierarchyContext: {
	role:               enums.#HierarchyRole
	delegation:         #Delegation
	fanout:             ids.#Fanout
	validation_outcome: enums.#ValidationOutcome | null
	correlation:        #HierarchyCorrelation
}
