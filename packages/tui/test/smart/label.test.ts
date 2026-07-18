import { describe, expect, test } from "bun:test"
import { deriveSmartLabel } from "../../src/smart/label"
import type { SmartIndicatorState } from "@opencode-ai/schema/tui/smart-state"

describe("smart.deriveSmartLabel", () => {
  test("renders the literal Smart text with critical tone when active", () => {
    const state: SmartIndicatorState = {
      active: true,
      reason: "routing_active",
      routing_profile: "manager",
      hierarchy_role: "architect",
    }
    expect(deriveSmartLabel(state)).toEqual({ text: "Smart", tone: "critical", detail: null })
  })

  test("preserves the fallback text with default tone when plainly inactive", () => {
    const state: SmartIndicatorState = {
      active: false,
      reason: "brain_inactive",
      degraded_reason: null,
      fallback_text: "Build",
    }
    expect(deriveSmartLabel(state)).toEqual({ text: "Build", tone: "default", detail: null })
  })

  test("surfaces the degraded reason as label detail without hiding the fallback text", () => {
    const state: SmartIndicatorState = {
      active: false,
      reason: "degraded",
      degraded_reason: "router_unavailable",
      fallback_text: "Build",
    }
    expect(deriveSmartLabel(state)).toEqual({
      text: "Build",
      tone: "default",
      detail: "router_unavailable",
    })
  })
})
