export * as SmartState from "./smart-state"

import { Schema } from "effect"

export const ActiveReason = Schema.Literals(["brain_mode_active", "routing_active"] as const).annotate({
  identifier: "SmartState.ActiveReason",
})
export type ActiveReason = typeof ActiveReason.Type

export const InactiveReason = Schema.Literals(["brain_inactive", "routing_inactive", "degraded"] as const).annotate({
  identifier: "SmartState.InactiveReason",
})
export type InactiveReason = typeof InactiveReason.Type

export const HierarchyRole = Schema.Literals(["architect", "manager", "worker"] as const).annotate({
  identifier: "SmartState.HierarchyRole",
})
export type HierarchyRole = typeof HierarchyRole.Type

export const RoutingProfile = Schema.Literals(["direct_worker", "manager"] as const).annotate({
  identifier: "SmartState.RoutingProfile",
})
export type RoutingProfile = typeof RoutingProfile.Type

// FallbackText — non-empty agent label shown when routing is inactive.
export const FallbackText = Schema.String.check(Schema.isMinLength(1)).annotate({
  identifier: "SmartState.FallbackText",
})
export type FallbackText = typeof FallbackText.Type

// Active — routing is actively governing the session.
export interface Active extends Schema.Schema.Type<typeof Active> {}
export const Active = Schema.Struct({
  active: Schema.Literal(true),
  reason: ActiveReason,
  routing_profile: RoutingProfile,
  hierarchy_role: HierarchyRole,
}).annotate({ identifier: "SmartState.Active" })

// Inactive — routing is not governing the session.
export interface Inactive extends Schema.Schema.Type<typeof Inactive> {}
export const Inactive = Schema.Struct({
  active: Schema.Literal(false),
  reason: InactiveReason,
  degraded_reason: Schema.NullOr(Schema.String),
  fallback_text: FallbackText,
}).annotate({ identifier: "SmartState.Inactive" })

// SmartIndicatorState is the closed union rendered by the TUI.
export const SmartIndicatorState = Schema.Union([Active, Inactive]).annotate({
  identifier: "SmartState.SmartIndicatorState",
})
export type SmartIndicatorState = typeof SmartIndicatorState.Type
