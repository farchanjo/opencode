// DDD role: ValueObject
// Package: routing.correlation
// RoutingCorrelation — telemetry correlation chain for Feature 001.
// session_id and turn_id live in trace context, never as metric labels.

package routing.correlation

import "routing/ids"

#CorrelationLevel: "session_only" | "session_turn" | "session_turn_routing" | "full"

// RoutingCorrelation records the full telemetry correlation path for a routing decision.
// All identifiers live in trace spans; none are permitted as metric labels.
#RoutingCorrelation: {
	// Active correlation level at time of decision.
	level: #CorrelationLevel

	// session_id is always present in trace context.
	session_id: ids.#SessionId

	// turn_id is present from session_turn upwards.
	turn_id: ids.#TurnId | null

	// decision_id is present from session_turn_routing upwards.
	decision_id: ids.#DecisionId | null

	// execution_id is present at full correlation (task execution span).
	execution_id: ids.#ExecutionId | null
}