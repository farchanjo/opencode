import { describe, expect, test } from "bun:test"
import { ReconnectPlanner } from "@opencode-ai/core/mcp/reconnect-planner"

// Feature 008 / T015 (S7) — the reconnect planner: bounded/jittered/capped backoff,
// resume carrying Last-Event-ID, max attempts reaching failed, and a stdio restart
// with no backoff schedule (FR29, FR30, FR31, C14).

const config: ReconnectPlanner.BackoffConfig = {
  baseMillis: 500,
  capMillis: 8000,
  maxAttempts: 5,
  jitterRatio: 0.2,
}

describe("ReconnectPlanner — bounded/jittered/capped curve (C14)", () => {
  test("the base curve is exponential and clamped to the cap", () => {
    expect(ReconnectPlanner.cappedDelay(0, config)).toBe(500)
    expect(ReconnectPlanner.cappedDelay(1, config)).toBe(1000)
    expect(ReconnectPlanner.cappedDelay(2, config)).toBe(2000)
    expect(ReconnectPlanner.cappedDelay(10, config)).toBe(8000) // clamped
  })

  test("jitter never lowers the delay below the capped floor and stays bounded above", () => {
    const capped = ReconnectPlanner.cappedDelay(1, config)
    const withZero = ReconnectPlanner.delayWithJitter(1, config, 0)
    const withMax = ReconnectPlanner.delayWithJitter(1, config, 1)
    expect(withZero).toBe(capped)
    expect(withMax).toBe(capped + Math.round(capped * config.jitterRatio))
    expect(withMax).toBeGreaterThanOrEqual(withZero)
  })

  test("the curve is monotonic non-decreasing across attempts", () => {
    let prev = -1
    for (let attempt = 0; attempt < 12; attempt++) {
      const d = ReconnectPlanner.cappedDelay(attempt, config)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})

describe("ReconnectPlanner — resume + attempt cap (FR29, FR30, C14)", () => {
  const resume: ReconnectPlanner.ResumeState = { lastEventId: "evt-42", sessionId: "sess-1", resumeSupported: true }

  test("a retry carries the Last-Event-ID when resume is supported", () => {
    const decision = ReconnectPlanner.planReconnect(0, config, 0.5, resume)
    expect(decision.kind).toBe("retry")
    if (decision.kind === "retry") {
      expect(decision.attempt).toBe(1)
      expect(decision.resume.lastEventId).toBe("evt-42")
      expect(decision.delayMillis).toBeGreaterThanOrEqual(config.baseMillis)
    }
  })

  test("resume drops the Last-Event-ID when the server does not support resume", () => {
    const decision = ReconnectPlanner.planReconnect(1, config, 0, { ...resume, resumeSupported: false })
    if (decision.kind === "retry") expect(decision.resume.lastEventId).toBeNull()
  })

  test("reaching the attempt cap resolves to failed", () => {
    expect(ReconnectPlanner.planReconnect(5, config, 0, resume).kind).toBe("failed")
    expect(ReconnectPlanner.planReconnect(6, config, 0, resume).kind).toBe("failed")
  })
})

describe("ReconnectPlanner — stdio restart without backoff (FR31, C14)", () => {
  test("a stdio restart is immediate with child cleanup and no backoff attempt", () => {
    const restart = ReconnectPlanner.planStdioRestart()
    expect(restart.kind).toBe("stdio_restart")
    expect(restart.delayMillis).toBe(0)
    expect(restart.cleanupChild).toBe(true)
  })
})
