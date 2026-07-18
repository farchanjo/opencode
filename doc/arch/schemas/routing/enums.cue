// DDD role: ValueObject
// Package: routing.enums
// Bounded enums for Feature 001 routing domain.

package routing.enums

// TaskClass classifies task complexity before routing.
#TaskClass: "small" | "medium" | "large" | "complex"

// RoutingProfile selects the hierarchy path.
#RoutingProfile: "direct_worker" | "manager"

// TaskEffort rates expected resource consumption.
#TaskEffort: "minimal" | "low" | "medium" | "high" | "massive"

// ReasoningEffort rates expected reasoning complexity.
#ReasoningEffort: "minimal" | "low" | "medium" | "high"

// ExecutionBoundary classifies failure modes for fallback decisions.
#ExecutionBoundary: "safe" | "retryable" | "mutation_risky"

// HierarchyRole names a role in the routing hierarchy.
#HierarchyRole: "architect" | "manager" | "worker"

// SmartIndicatorActiveReason explains why Smart is active.
#SmartIndicatorActiveReason: "brain_mode_active" | "routing_active"

// SmartIndicatorInactiveReason explains why Smart is not active.
#SmartIndicatorInactiveReason: "brain_inactive" | "routing_inactive" | "degraded"

// RoutingDecisionReason explains a routing outcome for status/detail display.
// Bounded set — only outcomes that can be shown to an operator.
#RoutingDecisionReason: "gate_fail" | "capability_mismatch" | "no_candidate" | "budget_exceeded" | "escalation" | "ok"

// CorrelationLevel describes the telemetry correlation depth.
#CorrelationLevel: "session_only" | "session_turn" | "session_turn_routing" | "full"