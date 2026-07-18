import { describe, expect, test } from "bun:test"
import {
  deriveSmartIndicatorState,
  INACTIVE_SMART_ROUTING_SIGNAL,
  type SmartRoutingSignal,
} from "../../src/routing-state"

describe("routing-state.deriveSmartIndicatorState", () => {
  test("stays inactive with brain_inactive when neither flag is set", () => {
    const result = deriveSmartIndicatorState(INACTIVE_SMART_ROUTING_SIGNAL, "Build")
    expect(result).toEqual({
      active: false,
      reason: "brain_inactive",
      degraded_reason: null,
      fallback_text: "Build",
    })
  })

  test("reports routing_inactive when only brain mode is active", () => {
    const signal: SmartRoutingSignal = {
      ...INACTIVE_SMART_ROUTING_SIGNAL,
      brainModeActive: true,
    }
    const result = deriveSmartIndicatorState(signal, "Build")
    expect(result).toEqual({
      active: false,
      reason: "routing_inactive",
      degraded_reason: null,
      fallback_text: "Build",
    })
  })

  test("reports brain_inactive when only Smart Routing is active", () => {
    const signal: SmartRoutingSignal = {
      ...INACTIVE_SMART_ROUTING_SIGNAL,
      routingActive: true,
      routingProfile: "direct_worker",
      hierarchyRole: "worker",
    }
    const result = deriveSmartIndicatorState(signal, "Build")
    expect(result).toEqual({
      active: false,
      reason: "brain_inactive",
      degraded_reason: null,
      fallback_text: "Build",
    })
  })

  test("goes active only when both brain mode and routing are active with resolved profile/role", () => {
    const signal: SmartRoutingSignal = {
      brainModeActive: true,
      routingActive: true,
      routingProfile: "manager",
      hierarchyRole: "architect",
      degradedReason: null,
    }
    const result = deriveSmartIndicatorState(signal, "Build")
    expect(result).toEqual({
      active: true,
      reason: "routing_active",
      routing_profile: "manager",
      hierarchy_role: "architect",
    })
  })

  test("falls back to routing_inactive when both flags are true but profile/role are unresolved", () => {
    const signal: SmartRoutingSignal = {
      brainModeActive: true,
      routingActive: true,
      routingProfile: null,
      hierarchyRole: null,
      degradedReason: null,
    }
    const result = deriveSmartIndicatorState(signal, "Build")
    expect(result).toEqual({
      active: false,
      reason: "routing_inactive",
      degraded_reason: null,
      fallback_text: "Build",
    })
  })

  test("a degraded reason always wins over active flags", () => {
    const signal: SmartRoutingSignal = {
      brainModeActive: true,
      routingActive: true,
      routingProfile: "manager",
      hierarchyRole: "architect",
      degradedReason: "router_unavailable",
    }
    const result = deriveSmartIndicatorState(signal, "Build")
    expect(result).toEqual({
      active: false,
      reason: "degraded",
      degraded_reason: "router_unavailable",
      fallback_text: "Build",
    })
  })
})
