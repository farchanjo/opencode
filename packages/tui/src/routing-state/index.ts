// Pure projection of the raw brain-mode / Smart Routing session signals into
// the TUI's SmartIndicatorState (packages/schema/src/tui/smart-state.ts).
//
// No I/O, no Effect runtime, no session/message identifiers — safe to call on
// every render. The concrete live signal (fed by the brain-mode + routing
// application layer) is wired in by the component; this module only knows
// how to fold that signal into the closed SmartIndicatorState union per
// spec item 31 (Smart MUST NOT render active unless both brain mode and
// Smart Routing are active).

import type {
  ActiveReason,
  FallbackText,
  HierarchyRole,
  InactiveReason,
  RoutingProfile,
  SmartIndicatorState,
} from "@opencode-ai/schema/tui/smart-state"

/** Raw session signal the caller assembles from live application state. */
export interface SmartRoutingSignal {
  readonly brainModeActive: boolean
  readonly routingActive: boolean
  readonly routingProfile: RoutingProfile | null
  readonly hierarchyRole: HierarchyRole | null
  /** Non-null when a subsystem reports a degraded/unavailable condition. */
  readonly degradedReason: string | null
}

/**
 * Safe default: brain mode and Smart Routing both report inactive, no
 * degraded condition. Used until the live signal source is wired in.
 */
export const INACTIVE_SMART_ROUTING_SIGNAL: SmartRoutingSignal = {
  brainModeActive: false,
  routingActive: false,
  routingProfile: null,
  hierarchyRole: null,
  degradedReason: null,
}

/**
 * Fold a raw routing signal into the closed SmartIndicatorState union.
 *
 * - A reported degraded/unavailable condition always wins: the operator
 *   sees the observable reason rather than a generic inactive state.
 * - Active requires brain mode AND Smart Routing both true, with a resolved
 *   routing profile and hierarchy role (spec item 31 — AND, never OR).
 * - Otherwise inactive, attributing the cause to whichever half is off.
 */
export function deriveSmartIndicatorState(
  signal: SmartRoutingSignal,
  fallbackText: FallbackText,
): SmartIndicatorState {
  if (signal.degradedReason) {
    return {
      active: false,
      reason: "degraded",
      degraded_reason: signal.degradedReason,
      fallback_text: fallbackText,
    }
  }

  if (signal.brainModeActive && signal.routingActive && signal.routingProfile && signal.hierarchyRole) {
    const reason: ActiveReason = "routing_active"
    return {
      active: true,
      reason,
      routing_profile: signal.routingProfile,
      hierarchy_role: signal.hierarchyRole,
    }
  }

  const reason: InactiveReason = signal.brainModeActive ? "routing_inactive" : "brain_inactive"
  return {
    active: false,
    reason,
    degraded_reason: null,
    fallback_text: fallbackText,
  }
}
