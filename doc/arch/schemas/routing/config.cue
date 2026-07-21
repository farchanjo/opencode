// DDD role: ValueObject
// Package: routing.config
// RoutingConfig — core routing policy for Feature 001 Phase 2.

package routing.config

import "routing/ids"

// RolePoolID identifies a named role pool (e.g. "architect", "manager",
// "worker-fast-large"). Resolved from Catalog.Service at routing time.
#RolePoolID: string & !~"^$"

// Mode controls when Smart Routing is active.
#RoutingMode: "always" | "auto" | "never"

// MetadataSource controls where capability metadata is sourced.
#MetadataSource: "catalog" | "override" | "observed"

// UnknownPolicy controls router behaviour when capability is unknown.
#UnknownPolicy: "deny" | "allow"

// SmartRoutingEnabled is the master enable flag for Smart Routing.
#SmartRoutingEnabled: bool

// StrictGates, when true, makes hard gates authoritative over the decision model.
#StrictGates: bool

// RoutingActivation governs whether and when Smart Routing runs.
#RoutingActivation: {
	// Master enable for Smart Routing.
	enabled: #SmartRoutingEnabled

	// When Smart Routing activates relative to brain mode.
	mode: #RoutingMode

	// If true, hard gates are authoritative; decision model may not bypass them.
	strict_gates: #StrictGates
}

// RoutingModels configures decision-model and role-pool candidates.
#RoutingModels: {
	// Role pool used for the decision model (Architect role).
	decision_model: {
		// Ordered list of RolePoolIDs consulted as decision model candidates.
		pool: [...#RolePoolID] & len(#RolePoolID) > 0
	}

	// User-configured role pools — maps RolePoolID to ordered ModelID candidates.
	// Model names are tier examples only; no hardcoded model/provider IDs.
	role_pools: {[string]: [...ids.#ModelId]}

	// Fallback floor — lowest RolePoolID the router may fall to without explicit auth.
	fallback: {
		floor_role: #RolePoolID
	}
}

// RoutingEnforcement configures capability, budget and hierarchy limits.
#RoutingEnforcement: {
	// Tool capability resolution and enforcement policy.
	capability: {
		// Source of truth for declared tool capabilities.
		metadata_source: #MetadataSource

		// Behaviour when a tool capability dimension is unknown.
		unknown_policy: #UnknownPolicy

		// Whether the router may actively probe for missing capability data.
		probing_enabled: bool
	}

	// Context, Turn and Delegation Budget — hard maximums, not relaxable by models.
	budget: {
		max_turns:            uint & >0
		max_context_tokens:   uint & >0
		max_context_bytes:    uint & >0
		max_output_tokens:    uint & >0
		max_output_bytes:     uint & >0
		max_workers:          uint & >0         // fanout cap
		max_delegation_depth: uint & >=0 & <=2  // Architect → Manager → Worker = depth 2
		retrieval_top_k:      uint & >=0
		rerank_top_k:         uint & >=0
		max_skill_chunks:     uint & >0
		max_skill_tokens:     uint & >0
		time_budget_ms:       uint & >0
		cost_budget_usd:      float & >=0.0
		token_budget:         uint & >0
		retry_depth:          uint & >=0
		validation_depth:     uint & >=0
		// Structured signal name that triggers escalation reclassification.
		escalation_threshold: ids.#EscalationThreshold
	}

	// Hierarchy constraints for the routing model.
	hierarchy: {
		// Maximum delegation depth (2 = Architect → Manager → Worker).
		max_depth: uint & >=1 & <=2

		// If true, Architect and Manager MUST NOT execute project mutations.
		orchestration_only: bool

		// Feature 048 — orchestration behavior selector. "heuristic" (default) is
		// the byte-identical shipped single-hop heuristic; "force_manager" is the
		// opt-in always-on Architect → Manager → Worker three-tier flow. Optional;
		// an absent field resolves to "heuristic".
		orchestration_mode?: "heuristic" | "force_manager"
	}
}

// RoutingConfig composes activation, model pools and enforcement limits.
#RoutingConfig: {
	activation:  #RoutingActivation
	models:      #RoutingModels
	enforcement: #RoutingEnforcement
}
