// DDD role: AggregateRoot
// Package: routing.decision
// RoutingDecision — immutable decision record persisted after every routing evaluation.
// Schema version enables replay compatibility. No primitive obsession.

package routing.decision

import "routing/ids"

// RoutingDecision is the immutable record of a complete routing evaluation.
// ULID id provides sort order and approximate time; sub-objects keep the
// aggregate small and cohesive while the id preserves lifecycle identity.
#RoutingDecision: {
	// ULID — sort order encodes creation time; the aggregate identity.
	id: ids.#DecisionId

	// Correlation and replay context (version, session, turn, fingerprint).
	context: #DecisionContext

	// Task classification outcome.
	classification: #DecisionClassification

	// Two-stage pipeline result (specialist agent, executor model, skills).
	selection: #DecisionSelection

	// Hard gates, candidates, ranking and decision-model invocation.
	evaluation: #DecisionEvaluation

	// Budget, versions and authorization context at decision time.
	accounting: #DecisionAccounting

	// Execution boundary, fallback state and timing metadata.
	lifecycle: #DecisionLifecycle
}
