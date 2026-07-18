// DDD role: ValueObject
// Package: routing.decision
// Cohesive sub-objects composed by the RoutingDecision aggregate root.

package routing.decision

import (
	"routing/ids"
	"routing/enums"
	"routing/capability"
	"routing/budget"
)

// DecisionContext carries replay and correlation context.
#DecisionContext: {
	// Schema version for replay compatibility against schema changes.
	version:    ids.#Version
	session_id: ids.#SessionId
	turn_id:    ids.#TurnId
	// Deterministic hash of task inputs — used for cache/replay deduplication.
	task_fingerprint: ids.#Fingerprint
}

// DecisionClassification captures the task classification outcome.
#DecisionClassification: {
	task_class:       enums.#TaskClass
	routing_profile:  enums.#RoutingProfile
	task_effort:      enums.#TaskEffort
	reasoning_effort: enums.#ReasoningEffort
}

// DecisionSelection captures the two-stage pipeline result.
#DecisionSelection: {
	specialist_agent: ids.#AgentId
	executor_model:   ids.#ModelId
	selected_skills:  #SkillList
	provider_variant: ids.#VariantName
}

// DecisionEvaluation captures gates, candidates, ranking and decision model.
#DecisionEvaluation: {
	// Hard gates per candidate × dimension.
	gates: #GateList
	// Ranked candidate list after deterministic scoring + tie-break.
	candidates: #CandidateList
	ranking:    #RankingList
	tie_break:  ids.#Reason | null
	// Decision model invocation (null if decision model was not required).
	decision_model_id: ids.#ModelId | null
	decision_inputs:   capability.#DecisionInputs | null
	decision_output:   capability.#DecisionOutput | null
}

// DecisionAccounting captures budget, versions and authorization snapshot.
#DecisionAccounting: {
	// Budget at decision time and consumption observed so far.
	budget:          budget.#BudgetPolicySnapshot
	budget_consumed: budget.#BudgetConsumption
	// Catalog/policy versions at decision time for replay validation.
	catalog_version: ids.#CatalogVersion
	policy_version:  ids.#PolicyVersion
	// Authorization context snapshot.
	auth_context: #AuthContextSnapshot
}

// DecisionLifecycle captures execution boundary, fallback state and timing.
#DecisionLifecycle: {
	// Execution boundary classification from fallback analysis.
	execution_boundary: enums.#ExecutionBoundary
	// Fallback state.
	fallback_attempted:  #FallbackAttempted
	fallback_reason:     ids.#Reason | null
	fallback_candidates: #FallbackCandidates | null
	// Metadata.
	created_at:          ids.#Timestamp // ISO 8601
	decision_latency_ms: uint & >=0
	offline:             #Offline // true when remote metrics were unavailable
}

// FallbackAttempted flags whether a fallback path was tried.
#FallbackAttempted: bool

// Offline flags that remote metrics were unavailable at decision time.
#Offline: bool

// FallbackCandidates is the first-class collection of fallback agent ids.
#FallbackCandidates: [...ids.#AgentId]
