import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SmartState } from "../src/tui/smart-state"

describe("SmartState.SmartIndicatorState", () => {
  test("decodes a valid active state", () => {
    const value = {
      active: true,
      reason: "brain_mode_active",
      routing_profile: "direct_worker",
      hierarchy_role: "architect",
    } as const
    const decoded = Schema.decodeUnknownSync(SmartState.SmartIndicatorState)(value)
    expect(decoded).toEqual(value)
  })

  test("decodes a valid inactive state with null degraded_reason", () => {
    const value = {
      active: false,
      reason: "routing_inactive",
      degraded_reason: null,
      fallback_text: "build",
    } as const
    const decoded = Schema.decodeUnknownSync(SmartState.SmartIndicatorState)(value)
    expect(decoded).toEqual(value)
  })

  test("decodes a valid degraded inactive state with a reason", () => {
    const value = {
      active: false,
      reason: "degraded",
      degraded_reason: "router_timeout",
      fallback_text: "build",
    } as const
    const decoded = Schema.decodeUnknownSync(SmartState.SmartIndicatorState)(value)
    expect(decoded).toEqual(value)
  })

  test("rejects an empty fallback_text", () => {
    const invalid = {
      active: false,
      reason: "brain_inactive",
      degraded_reason: null,
      fallback_text: "",
    }
    expect(() => Schema.decodeUnknownSync(SmartState.SmartIndicatorState)(invalid)).toThrow()
  })

  test("rejects an unknown active reason", () => {
    const invalid = {
      active: true,
      reason: "not_a_reason",
      routing_profile: "manager",
      hierarchy_role: "worker",
    }
    expect(() => Schema.decodeUnknownSync(SmartState.SmartIndicatorState)(invalid)).toThrow()
  })

  test("HierarchyRole and RoutingProfile enums are closed", () => {
    expect(Schema.decodeUnknownSync(SmartState.HierarchyRole)("manager")).toBe("manager")
    expect(() => Schema.decodeUnknownSync(SmartState.HierarchyRole)("owner")).toThrow()
    expect(Schema.decodeUnknownSync(SmartState.RoutingProfile)("manager")).toBe("manager")
    expect(() => Schema.decodeUnknownSync(SmartState.RoutingProfile)("solo")).toThrow()
  })
})
