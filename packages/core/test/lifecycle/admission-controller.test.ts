import { describe, expect, test } from "bun:test"
import { createAdmissionController } from "@opencode-ai/core/lifecycle/admission/admission-controller"
import { UNMEASURED_CAPACITY_SIGNALS } from "@opencode-ai/core/lifecycle/admission/capacity"

function clock(startMs: number) {
  let now = startMs
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe("AdmissionController (T020)", () => {
  test("grants in full within the token-bucket ceiling and projects requested==granted", () => {
    const controller = createAdmissionController({ ceilings: { session: 4 }, refillPerSecond: 0 })
    const result = controller.request({ scope: "session", key: "s1", requestedFanout: 3 })
    expect(result.decision).toBe("granted")
    expect(result.scope).toBe("session")
    expect(result.fanout).toEqual({ requested: 3, granted: 3 })
  })

  test("partial admission when the request exceeds available tokens", () => {
    const controller = createAdmissionController({ ceilings: { child: 2 }, refillPerSecond: 0 })
    const result = controller.request({ scope: "child", key: "m1", requestedFanout: 5 })
    expect(result.decision).toBe("partial")
    expect(result.fanout).toEqual({ requested: 5, granted: 2 })
  })

  test("queued when the bucket is fully exhausted (no unbounded grant)", () => {
    const controller = createAdmissionController({ ceilings: { tool: 1 }, refillPerSecond: 0 })
    const first = controller.request({ scope: "tool", key: "grep", requestedFanout: 1 })
    expect(first.decision).toBe("granted")
    const second = controller.request({ scope: "tool", key: "grep", requestedFanout: 1 })
    expect(second.decision).toBe("queued")
    expect(second.fanout).toEqual({ requested: 1, granted: 0 })
  })

  test("rejected once a scope+key is fenced after a root cancel (C17)", () => {
    const controller = createAdmissionController({ ceilings: { root: 4 } })
    controller.fence("root", "root-1")
    const result = controller.request({ scope: "root", key: "root-1", requestedFanout: 1 })
    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("fenced")
    expect(result.fanout).toEqual({ requested: 1, granted: 0 })
    expect(controller.isFenced("root", "root-1")).toBe(true)
  })

  test("unfence explicitly lifts a prior fence", () => {
    const controller = createAdmissionController({ ceilings: { root: 4 } })
    controller.fence("root", "root-1")
    controller.unfence("root", "root-1")
    const result = controller.request({ scope: "root", key: "root-1", requestedFanout: 1 })
    expect(result.decision).toBe("granted")
  })

  test("rejected when the resolved scope ceiling is zero", () => {
    const controller = createAdmissionController({ ceilings: { cost: 0 } })
    const result = controller.request({ scope: "cost", key: "global", requestedFanout: 1 })
    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("zero capacity ceiling")
  })

  test("queued when the mapped capacity signal is saturated, independent of token availability", () => {
    const controller = createAdmissionController({ ceilings: { provider: 8 } })
    const signals = { ...UNMEASURED_CAPACITY_SIGNALS, provider_saturation: 0.99 }
    const result = controller.request({ scope: "provider", key: "anthropic", requestedFanout: 1, capacitySignals: signals })
    expect(result.decision).toBe("queued")
    expect(result.reason).toContain("saturated")
  })

  test("refills over time via the injected clock", () => {
    const c = clock(0)
    const controller = createAdmissionController({ ceilings: { session: 2 }, refillPerSecond: 2, nowMs: c.now })
    const first = controller.request({ scope: "session", key: "s1", requestedFanout: 2 })
    expect(first.decision).toBe("granted")
    const exhausted = controller.request({ scope: "session", key: "s1", requestedFanout: 1 })
    expect(exhausted.decision).toBe("queued")

    c.advance(1000) // 2 tokens/s * 1s = 2 tokens refilled, capped at ceiling 2
    const refilled = controller.request({ scope: "session", key: "s1", requestedFanout: 1 })
    expect(refilled.decision).toBe("granted")
  })

  test("requestBatch grants every request in full when there is no contention", () => {
    const controller = createAdmissionController({ ceilings: { child: 10 } })
    const results = controller.requestBatch("child", "manager-1", [
      { id: "w1", role: "parent", requestedFanout: 3 },
      { id: "w2", role: "child", requestedFanout: 3 },
    ])
    expect(results.map((r) => r.result.decision)).toEqual(["granted", "granted"])
    expect(results.map((r) => r.result.fanout.granted)).toEqual([3, 3])
  })

  test("requestBatch applies parent/child fairness weights under contention (FR32, AC21)", () => {
    const controller = createAdmissionController({ ceilings: { child: 3 } })
    const results = controller.requestBatch("child", "manager-1", [
      { id: "parent-request", role: "parent", requestedFanout: 3 },
      { id: "child-request", role: "child", requestedFanout: 3 },
    ])
    const byId = new Map(results.map((r) => [r.id, r.result]))
    const parentGranted = byId.get("parent-request")!.fanout.granted
    const childGranted = byId.get("child-request")!.fanout.granted
    // Only 3 tokens exist for 6 requested; fairness_weight.parent(2) > fairness_weight.child(1),
    // so the parent request must never receive fewer tokens than the child (AC21: starvation observable, never silent).
    expect(parentGranted + childGranted).toBe(3)
    expect(parentGranted).toBeGreaterThanOrEqual(childGranted)
    expect(byId.get("parent-request")!.decision).not.toBe("granted")
    expect(byId.get("child-request")!.decision).not.toBe("granted")
  })

  test("requestBatch never exceeds the bucket total across all contending requests", () => {
    const controller = createAdmissionController({ ceilings: { child: 5 } })
    const results = controller.requestBatch("child", "manager-1", [
      { id: "a", role: "parent", requestedFanout: 4 },
      { id: "b", role: "child", requestedFanout: 4 },
      { id: "c", role: "child", requestedFanout: 4 },
    ])
    const totalGranted = results.reduce((sum, r) => sum + r.result.fanout.granted, 0)
    expect(totalGranted).toBeLessThanOrEqual(5)
  })

  test("bucketState reports scope, bucket, and fence status for observability", () => {
    const c = clock(0)
    const controller = createAdmissionController({ ceilings: { agent: 6 }, refillPerSecond: 1, nowMs: c.now })
    controller.request({ scope: "agent", key: "worker-a", requestedFanout: 2 })
    const state = controller.bucketState("agent", "worker-a")
    expect(state.scope).toBe("agent")
    expect(state.bucket.capacity).toBe(6)
    expect(state.bucket.available).toBe(4)
    expect(state.fenced).toBe(false)
  })

  test("zero requestedFanout is a trivial no-op grant, needing no capacity", () => {
    const controller = createAdmissionController({ ceilings: { global: 4 } })
    const signals = { ...UNMEASURED_CAPACITY_SIGNALS, cpu_saturation: 1 }
    const result = controller.request({ scope: "global", key: "singleton", requestedFanout: 0, capacitySignals: signals })
    expect(result.decision).toBe("granted")
    expect(result.fanout).toEqual({ requested: 0, granted: 0 })
  })

  test("a fenced scope still rejects even a zero-fanout request — fencing quarantines outright (C17)", () => {
    const controller = createAdmissionController({ ceilings: { global: 4 } })
    controller.fence("global", "singleton")
    const result = controller.request({ scope: "global", key: "singleton", requestedFanout: 0 })
    expect(result.decision).toBe("rejected")
  })
})
