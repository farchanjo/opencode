import { describe, expect, test } from "bun:test"
import { renderStatus } from "./render"

describe("smart renderer", () => {
  test("renders the active indicator with brain and routing state", () => {
    const out = renderStatus({
      active: true,
      reason: "brain and routing active",
      brainActive: true,
      routingActive: true,
      routingProfile: "manager",
      hierarchyRole: "architect",
      indicatorState: { state: "active" },
      degradedReason: null,
      fallbackText: null,
    })
    expect(out).toContain("smart: active")
    expect(out).toContain("brain: on  routing: on")
    expect(out).toContain("profile: manager  role: architect")
    expect(out).toContain("indicator: active")
  })

  test("renders the inactive fallback with degraded reason", () => {
    const out = renderStatus({
      active: false,
      reason: "routing disabled",
      brainActive: true,
      routingActive: false,
      routingProfile: null,
      hierarchyRole: null,
      indicatorState: "inactive",
      degradedReason: "catalog unavailable",
      fallbackText: "Build",
    })
    expect(out).toContain("smart: inactive")
    expect(out).toContain("brain: on  routing: off")
    expect(out).toContain("profile: -  role: -")
    expect(out).toContain("degraded: catalog unavailable")
    expect(out).toContain("fallback: Build")
  })
})
