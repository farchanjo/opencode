// DDD role: ValueObject
// Package: tui.smart-state
// SmartIndicatorState — TUI projection state for the Smart indicator.
// Owned by routing; rendered by TUI. Three mutually exclusive states.

package tui.smart_state

#SmartIndicatorActiveReason: "brain_mode_active" | "routing_active"
#SmartIndicatorInactiveReason: "brain_inactive" | "routing_inactive" | "degraded"
#HierarchyRole: "architect" | "manager" | "worker"
#RoutingProfile: "direct_worker" | "manager"

// FallbackText — non-empty agent label shown when routing is inactive
// (DDD role: ValueObject).
#FallbackText: string & !=""

// SmartIndicatorActive — routing is actively governing the session.
#SmartIndicatorActive: {
	active:           true
	reason:           #SmartIndicatorActiveReason
	routing_profile:  #RoutingProfile
	hierarchy_role:   #HierarchyRole
}

// SmartIndicatorInactive — routing is not governing the session.
#SmartIndicatorInactive: {
	active:          false
	reason:          #SmartIndicatorInactiveReason
	// Bounded degraded reason — not a free-form string.
	degraded_reason: string | null
	// Fallback text shown when inactive (e.g. agent().name).
	fallback_text: #FallbackText
}

// SmartIndicatorState is the closed union rendered by the TUI.
// Active: shows "Smart" in theme.error (red).
// Degraded: shows reason in status/detail.
// Inactive/manual: preserves agent label.
#SmartIndicatorState: #SmartIndicatorActive | #SmartIndicatorInactive