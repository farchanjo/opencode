import { describe, expect, test } from "bun:test"
import { Degradation } from "@opencode-ai/core/mcp/degradation"

// Feature 008 / T020 (S12) — the typed capability-gap classifier: each gap code,
// server unavailability yields mcp_unavailable not a crash, and the session
// continues on a degraded capability (FR7, C1, C2).

describe("Degradation — classification (FR7, C1, C2)", () => {
  test("a healthy set stays none and the session continues", () => {
    const out = Degradation.classify(Degradation.HEALTHY_CONDITIONS)
    expect(out.gap).toBe("none")
    expect(out.degraded_reason).toBeNull()
    expect(out.session_continues).toBe(true)
  })

  test("each gap code maps from its condition with a stable reason and a continuing session", () => {
    for (const gap of Degradation.GAP_PRECEDENCE) {
      const conditionKey = {
        mcp_unavailable: "serverUnreachable",
        needs_auth: "needsAuth",
        needs_client_registration: "needsClientRegistration",
        feature_unsupported: "featureUnsupported",
      }[gap] as keyof Degradation.CapabilityConditions
      const out = Degradation.classify({ ...Degradation.HEALTHY_CONDITIONS, [conditionKey]: true })
      expect(out.gap).toBe(gap)
      expect(out.degraded_reason).toBeTruthy()
      expect(out.session_continues).toBe(true)
    }
  })

  test("an unreachable server yields mcp_unavailable, never a crash", () => {
    const out = Degradation.classify({ ...Degradation.HEALTHY_CONDITIONS, serverUnreachable: true })
    expect(out.gap).toBe("mcp_unavailable")
    expect(out.session_continues).toBe(true)
  })

  test("the most severe gap wins when several conditions hold", () => {
    const out = Degradation.classify({
      ...Degradation.HEALTHY_CONDITIONS,
      serverUnreachable: true,
      featureUnsupported: true,
    })
    expect(out.gap).toBe("mcp_unavailable")
  })
})

describe("Degradation — capability exercisability (FR7, C2)", () => {
  test("a capability is exercisable only when advertised and ungapped", () => {
    expect(Degradation.capabilityExercisable(true, "none")).toBe(true)
    expect(Degradation.capabilityExercisable(false, "none")).toBe(false)
    expect(Degradation.capabilityExercisable(true, "mcp_unavailable")).toBe(false)
  })
})
