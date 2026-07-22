// DDD role: ValueObject
// Package: schemas
// Feature 056 — Collapse three-tier Architect→Manager→Worker into
// main (architect = Architect+Manager) → worker leaves only.
// Bounds and invariants for hierarchy enforcement after collapse (ADR-0056).

package schemas

// HierarchyMaxDepthCollapsed is the only legal hierarchy.max_depth after F056.
// Legacy persisted value 2 MUST clamp to 1 at read/reconcile time.
// DDD role: ValueObject
#HierarchyMaxDepthCollapsed: 1

// HierarchyChildRoleCollapsed enumerates roles a hierarchy child may receive.
// Manager is intentionally absent as a child role.
// DDD role: ValueObject
#HierarchyChildRoleCollapsed: "worker"

// HierarchyParentRoleMain is the main-session hierarchy identity (Architect +
// Manager responsibilities; product language may say Architect/Manager).
// DDD role: ValueObject
#HierarchyParentRoleMain: "architect"

// CollapsedHierarchyEdge is the only legal parent→child edge under F056.
// DDD role: ValueObject
#CollapsedHierarchyEdge: {
	parent: #HierarchyParentRoleMain
	child:  #HierarchyChildRoleCollapsed
}

// OrchestrationModeCompat documents Feature 048's enum after supersession:
// both values MUST resolve to the collapsed two-tier path (no Manager child).
// Prefer keeping the literals for persisted-config dual-read; three-tier
// semantics are abandoned (ADR-0056).
// DDD role: ValueObject
#OrchestrationModeCompat: "heuristic" | "force_manager"

// CollapsedDispatchInvariants are pure-engine invariants (mirrors code).
// DDD role: ValueObject
#CollapsedDispatchInvariants: {
	max_delegation_depth:          #HierarchyMaxDepthCollapsed
	manager_child_allowed:         false
	worker_is_leaf:                true
	main_role:                     #HierarchyParentRoleMain
	validation_chain:              "worker_to_main"
	force_manager_creates_manager: false
}
