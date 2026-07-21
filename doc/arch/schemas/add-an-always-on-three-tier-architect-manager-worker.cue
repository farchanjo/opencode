// DDD role: ValueObject
// Package: schemas
// Feature 048 — Add An Always On Three Tier Architect Manager Worker.
// The opt-in force-manager orchestration mode's decision value-objects: the mode
// toggle, the forced architect-edge classification, the depth-ceiling
// reconciliation, the per-tier model outcome, and the Manager persona injection.
// Every force_manager branch is inert under heuristic, so heuristic stays the
// byte-identical default.

package schemas

// OrchestrationMode selects the hierarchy orchestration behavior. `heuristic` is
// the byte-identical shipped default; `force_manager` is the opt-in always-on
// three-tier flow. An absent field resolves to `heuristic`.
// DDD role: ValueObject
#OrchestrationMode: "heuristic" | "force_manager"

// TierRole names one hierarchy tier. Architect is the root, Manager the
// orchestrating middle tier, Worker the executing leaf.
// DDD role: ValueObject
#TierRole: "architect" | "manager" | "worker"

// SmartRoutingActive wraps the "Smart Routing enabled and running" predicate as a
// named ValueObject rather than a bare bool (Object Calisthenics, wrap-primitives).
// DDD role: ValueObject
#SmartRoutingActive: bool

// ForceManagerSelected wraps the "operator chose force_manager" flag as a named
// ValueObject rather than a bare bool (Object Calisthenics, wrap-primitives).
// DDD role: ValueObject
#ForceManagerSelected: bool

// ForceManagerGate is the composite activation predicate for the always-on flow:
// Smart Routing must be enabled and running (mode != never) AND the operator must
// have selected force_manager. Both closed → heuristic behavior.
// DDD role: ValueObject
#ForceManagerGate: {
	smart_routing_active: #SmartRoutingActive
	mode:                 #OrchestrationMode
	active:               #ForceManagerSelected & (smart_routing_active && mode == "force_manager")
}

// ForcedClassification is the architect-edge child role under force_manager: the
// Architect edge ALWAYS yields a Manager, regardless of analyzer fan-out; a
// non-architect parent stays a Worker leaf. `requested_fanout` is preserved from
// the analyzer for F043 budget admission and is never widened by this mode.
// DDD role: ValueObject
#ForcedClassification: {
	parent_role:      #TierRole
	child_role:       #TierRole
	requested_fanout: int & >=1
	if parent_role == "architect" {
		child_role: "manager"
	}
	if parent_role != "architect" {
		child_role:       "worker"
		requested_fanout: 1
	}
}

// DepthCeilingReconciliation is the effective delegation-depth ceiling the
// tool/task depth guard enforces. Under force_manager with an UNSET subagent_depth
// the ceiling honors hierarchy.max_depth so Architect(0)->Manager(1)->Worker(2)
// passes; an explicit subagent_depth reconciles to the min. Off the hierarchy path
// (or in heuristic mode) the legacy default of 1 holds.
// DDD role: ValueObject
#DepthCeilingReconciliation: {
	legacy_default:      int & 1
	subagent_depth?:     int & >=0
	hierarchy_max_depth: int & >=1 & <=2
	force_manager:       #ForceManagerSelected
	effective_ceiling:   int & >=1 & <=2
	if force_manager && subagent_depth == _|_ {
		effective_ceiling: hierarchy_max_depth
	}
}

// TierModelOutcome is the resolved per-tier model decision. `routed` runs on the
// tier's own pool model; `degraded_model_unresolved` is the force_manager-only
// SURFACED outcome (a visible warning + telemetry, then parent inheritance);
// `blocked` is a hard legality/depth rejection.
// DDD role: ValueObject
#TierModelOutcome: "routed" | "degraded_model_unresolved" | "blocked"

// ManagerPersonaInjection records whether the Manager persona prelude is prepended
// to a manager-role spawn's prompt. Injected only under force_manager; never in
// heuristic mode (byte-identical).
// DDD role: ValueObject
#ManagerPersonaInjection: {
	child_role:    #TierRole
	force_manager: #ForceManagerSelected
	injected:      #ForceManagerSelected & (force_manager && child_role == "manager")
}
</content>
