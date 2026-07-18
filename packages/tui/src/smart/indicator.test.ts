/**
 * Feature 001 / T039 — Smart TUI indicator projection.
 *
 * The prompt component recomputes the Smart label on every render from a raw
 * routing signal (packages/tui/src/routing-state). This pins the pure
 * projection: Smart renders active ONLY when brain mode AND Smart Routing are
 * both active (spec item 31 — AND, never OR), a degraded condition always wins,
 * the label is text-first + theme-aware (never color-only), and the state
 * carries no session/message identifiers.
 */
import { describe, expect, test } from "bun:test"
import { deriveSmartIndicatorState, INACTIVE_SMART_ROUTING_SIGNAL, type SmartRoutingSignal } from "../routing-state"
import { deriveSmartLabel } from "./label"

const FALLBACK = "Build"

function signal(overrides: Partial<SmartRoutingSignal> = {}): SmartRoutingSignal {
  return { ...INACTIVE_SMART_ROUTING_SIGNAL, ...overrides }
}

describe("T039 deriveSmartIndicatorState — AND gate", () => {
  test("active only when brain + routing + profile + role are all present", () => {
    const state = deriveSmartIndicatorState(
      signal({ brainModeActive: true, routingActive: true, routingProfile: "manager", hierarchyRole: "architect" }),
      FALLBACK,
    )
    expect(state.active).toBe(true)
    if (state.active) {
      expect(state.reason).toBe("routing_active")
      expect(state.routing_profile).toBe("manager")
      expect(state.hierarchy_role).toBe("architect")
    }
  })

  test("brain mode off → inactive attributed to brain_inactive with the fallback text", () => {
    const state = deriveSmartIndicatorState(
      signal({ brainModeActive: false, routingActive: true, routingProfile: "manager", hierarchyRole: "architect" }),
      FALLBACK,
    )
    expect(state.active).toBe(false)
    if (!state.active) {
      expect(state.reason).toBe("brain_inactive")
      expect(state.fallback_text).toBe(FALLBACK)
    }
  })

  test("routing off but brain on → routing_inactive", () => {
    const state = deriveSmartIndicatorState(signal({ brainModeActive: true, routingActive: false }), FALLBACK)
    expect(state.active).toBe(false)
    if (!state.active) expect(state.reason).toBe("routing_inactive")
  })

  test("both active but missing profile/role does not flip to active", () => {
    const state = deriveSmartIndicatorState(
      signal({ brainModeActive: true, routingActive: true, routingProfile: null, hierarchyRole: null }),
      FALLBACK,
    )
    expect(state.active).toBe(false)
  })

  test("a degraded condition always wins over an otherwise-active signal", () => {
    const state = deriveSmartIndicatorState(
      signal({
        brainModeActive: true,
        routingActive: true,
        routingProfile: "manager",
        hierarchyRole: "architect",
        degradedReason: "decision pool unavailable",
      }),
      FALLBACK,
    )
    expect(state.active).toBe(false)
    if (!state.active) {
      expect(state.reason).toBe("degraded")
      expect(state.degraded_reason).toBe("decision pool unavailable")
    }
  })
})

describe("T039 deriveSmartLabel — text-first, theme-aware, never color-only", () => {
  test("active state renders the literal `Smart` text in the critical tone", () => {
    const view = deriveSmartLabel(
      deriveSmartIndicatorState(
        signal({ brainModeActive: true, routingActive: true, routingProfile: "direct_worker", hierarchyRole: "worker" }),
        FALLBACK,
      ),
    )
    expect(view.text).toBe("Smart")
    expect(view.tone).toBe("critical")
    expect(view.detail).toBeNull()
  })

  test("inactive state renders the fallback agent text in the default tone", () => {
    const view = deriveSmartLabel(deriveSmartIndicatorState(signal({ brainModeActive: false }), FALLBACK))
    expect(view.text).toBe(FALLBACK)
    expect(view.tone).toBe("default")
  })

  test("degraded state surfaces the reason as detail alongside the fallback label", () => {
    const view = deriveSmartLabel(
      deriveSmartIndicatorState(signal({ degradedReason: "exporter offline" }), FALLBACK),
    )
    expect(view.text).toBe(FALLBACK)
    expect(view.detail).toBe("exporter offline")
  })

  test("the label always carries non-empty distinguishing text (never color-only)", () => {
    for (const s of [
      signal({ brainModeActive: true, routingActive: true, routingProfile: "manager", hierarchyRole: "architect" }),
      signal({ brainModeActive: false }),
      signal({ degradedReason: "x" }),
    ]) {
      const view = deriveSmartLabel(deriveSmartIndicatorState(s, FALLBACK))
      expect(view.text.length).toBeGreaterThan(0)
    }
  })

  test("the projected state exposes no session/message identifier fields", () => {
    const state = deriveSmartIndicatorState(
      signal({ brainModeActive: true, routingActive: true, routingProfile: "manager", hierarchyRole: "architect" }),
      FALLBACK,
    )
    const keys = Object.keys(state)
    for (const forbidden of ["session_id", "message_id", "turn_id", "sessionId", "messageId"]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
