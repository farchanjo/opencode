// DDD role: ValueObject
// Package: routing.budget
// BudgetPolicy — hard transversal limits for Context, Turn and Delegation Budget.
// Numeric defaults remain open clarification parameters; schema enforces constraints.

package routing.budget

import (
	"routing/ids"
	"routing/enums"
)

// BudgetLimits caps turn, context and output size.
#BudgetLimits: {
	max_turns:          uint & >0
	max_context_tokens: uint & >0
	max_context_bytes:  uint & >0
	max_output_tokens:  uint & >0
	max_output_bytes:   uint & >0
}

// BudgetConcurrency caps fanout and delegation depth.
#BudgetConcurrency: {
	max_workers:          uint & >0        // fanout cap per Manager dispatch
	max_delegation_depth: uint & >=0 & <=2 // depth 2 = Architect→Manager→Worker
}

// BudgetRetrieval caps retrieval and skill-context expansion.
#BudgetRetrieval: {
	retrieval_top_k:  uint & >=0
	rerank_top_k:     uint & >=0
	max_skill_chunks: uint & >0
	max_skill_tokens: uint & >0
}

// BudgetCost caps wall-clock, monetary and token spend.
#BudgetCost: {
	time_budget_ms:  uint & >0
	cost_budget_usd: float & >=0.0
	token_budget:    uint & >0
}

// BudgetResilience caps retry and validation depth and names the escalation signal.
#BudgetResilience: {
	retry_depth:      uint & >=0
	validation_depth: uint & >=0
	// Named escalation signal; exceeds this threshold → reclassify to Manager path.
	escalation_threshold: ids.#EscalationThreshold
}

// BudgetPolicy composes the hard maximums that a model may never relax.
#BudgetPolicy: {
	limits:      #BudgetLimits
	concurrency: #BudgetConcurrency
	retrieval:   #BudgetRetrieval
	cost:        #BudgetCost
	resilience:  #BudgetResilience
}

#BudgetScope: "global" | "project" | "session"

// Snapshot captured at routing decision time for replay and audit.
#BudgetPolicySnapshot: {
	policy:          #BudgetPolicy
	applied_at:      ids.#Timestamp // ISO 8601
	scope:           #BudgetScope
	routing_profile: enums.#RoutingProfile
	task_class:      enums.#TaskClass
	role:            enums.#HierarchyRole
}
