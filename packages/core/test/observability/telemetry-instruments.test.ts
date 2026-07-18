import { describe, expect, test } from "bun:test"
import { Effect, Metric } from "effect"
import {
  boundEnum,
  createCardinalityAllowlist,
  DropReason,
  Labels,
  OTHER,
  SpanName,
  hardGateRejection,
  routingDecisionLatency,
  exportQueueDepth,
} from "@opencode-ai/core/observability/telemetry-instruments"

describe("telemetry-instruments concept spans", () => {
  test("exposes the eight routing concept spans", () => {
    expect(Object.values(SpanName)).toEqual([
      "routing.evaluate",
      "decision_model",
      "hard_gates",
      "rank",
      "task.execute",
      "llm.request",
      "tool.execute",
      "fallback",
    ])
  })
})

describe("boundEnum", () => {
  test("passes through allowlisted values", () => {
    for (const value of Labels.status) expect(boundEnum(Labels.status, value)).toBe(value)
  })

  test("maps out-of-allowlist values to other", () => {
    expect(boundEnum(Labels.status, "explosion")).toBe(OTHER)
    expect(boundEnum(Labels.task_class, "gigantic")).toBe(OTHER)
  })

  test("bounded drop reasons are stable", () => {
    expect(DropReason).toEqual(["queue_full", "backpressure_evict", "stale"])
  })
})

describe("createCardinalityAllowlist", () => {
  test("admits up to the budget then collapses to other", () => {
    const allow = createCardinalityAllowlist(2)
    expect(allow.bound("anthropic")).toBe("anthropic")
    expect(allow.bound("openai")).toBe("openai")
    expect(allow.bound("mistral")).toBe(OTHER)
    expect(allow.size()).toBe(2)
  })

  test("re-admits already-known values even past budget", () => {
    const allow = createCardinalityAllowlist(1)
    expect(allow.bound("anthropic")).toBe("anthropic")
    expect(allow.bound("openai")).toBe(OTHER)
    expect(allow.bound("anthropic")).toBe("anthropic")
  })

  test("non-positive budget collapses everything", () => {
    const allow = createCardinalityAllowlist(0)
    expect(allow.bound("anthropic")).toBe(OTHER)
  })

  test("reset clears admitted values", () => {
    const allow = createCardinalityAllowlist(1)
    allow.bound("anthropic")
    allow.reset()
    expect(allow.size()).toBe(0)
    expect(allow.bound("openai")).toBe("openai")
  })
})

describe("metric instruments", () => {
  test("counter records increments in the registry", () => {
    const before = Effect.runSync(Metric.value(hardGateRejection)).count
    Effect.runSync(Metric.update(hardGateRejection, 3))
    const after = Effect.runSync(Metric.value(hardGateRejection)).count
    expect(after - before).toBe(3)
  })

  test("histogram records observations", () => {
    const before = Effect.runSync(Metric.value(routingDecisionLatency)).count
    Effect.runSync(Metric.update(routingDecisionLatency, 42))
    const after = Effect.runSync(Metric.value(routingDecisionLatency)).count
    expect(after - before).toBe(1)
  })

  test("gauge holds the latest value", () => {
    Effect.runSync(Metric.update(exportQueueDepth, 7))
    expect(Effect.runSync(Metric.value(exportQueueDepth)).value).toBe(7)
  })
})
