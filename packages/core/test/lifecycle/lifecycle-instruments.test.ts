import { describe, expect, test } from "bun:test"
import { Effect, Metric } from "effect"
import {
  CorrelatedSpanName,
  createCardinalityAllowlist,
  createEvidenceStore,
  DEFAULT_EVIDENCE_CONFIDENCE_FLOOR,
  DEFAULT_EVIDENCE_TTL_MS,
  DEFAULT_EVIDENCE_WINDOW_MS,
  Labels,
  OTHER,
  processActive,
  processCompleted,
  queueWaitMs,
  SpanName,
} from "@opencode-ai/core/lifecycle/lifecycle-instruments"

describe("lifecycle-instruments concept spans", () => {
  test("exposes the five lifecycle concept spans (FR43)", () => {
    expect(Object.values(SpanName)).toEqual(["admission", "queue.wait", "cancel", "handoff", "reconciliation"])
  })

  test("correlates with the existing Feature 001 / session spans (FR43, C18)", () => {
    expect(CorrelatedSpanName.taskExecute).toBe("task.execute")
    expect(CorrelatedSpanName.sessionExecution).toBe("session.execution")
    expect(CorrelatedSpanName.llmRequest).toBe("llm.request")
    expect(CorrelatedSpanName.toolExecute).toBe("tool.execute")
    expect(CorrelatedSpanName.fallback).toBe("fallback")
  })
})

describe("lifecycle-instruments bounded labels", () => {
  test("process_state carries exactly the ten Process Table states", () => {
    expect(Labels.process_state).toHaveLength(10)
    expect(Labels.process_state).toContain("cancelling")
    expect(Labels.process_state).toContain("zombie")
  })

  test("admission_scope carries exactly the twelve admission scopes", () => {
    expect(Labels.admission_scope).toHaveLength(12)
  })

  test("reuses the Feature 001 hierarchy_role allowlist verbatim (C15)", () => {
    expect(Labels.hierarchy_role).toEqual(["architect", "manager", "worker"])
  })

  test("reuses the Feature 001 cardinality allowlist (C18)", () => {
    const allow = createCardinalityAllowlist(1)
    expect(allow.bound("anthropic")).toBe("anthropic")
    expect(allow.bound("openai")).toBe(OTHER)
  })
})

describe("lifecycle-instruments metric instruments", () => {
  test("counter records increments in the registry", () => {
    const before = Effect.runSync(Metric.value(processCompleted)).count
    Effect.runSync(Metric.update(processCompleted, 2))
    const after = Effect.runSync(Metric.value(processCompleted)).count
    expect(after - before).toBe(2)
  })

  test("gauge holds the latest value", () => {
    Effect.runSync(Metric.update(processActive, 5))
    expect(Effect.runSync(Metric.value(processActive)).value).toBe(5)
  })

  test("histogram records observations", () => {
    const before = Effect.runSync(Metric.value(queueWaitMs)).count
    Effect.runSync(Metric.update(queueWaitMs, 42))
    const after = Effect.runSync(Metric.value(queueWaitMs)).count
    expect(after - before).toBe(1)
  })
})

describe("createEvidenceStore — local evidence window/confidence/TTL (FR47, C18, AC16)", () => {
  test("exposes the AC16 provisional defaults", () => {
    expect(DEFAULT_EVIDENCE_WINDOW_MS).toBe(300_000)
    expect(DEFAULT_EVIDENCE_CONFIDENCE_FLOOR).toBe(0.6)
    expect(DEFAULT_EVIDENCE_TTL_MS).toBe(600_000)
  })

  test("query returns only entries within the window and at/above the confidence floor", () => {
    const store = createEvidenceStore({ windowMs: 1000, confidenceFloor: 0.6, ttlMs: 10_000 })
    store.record({ role: "worker", validation_outcome: "passed", confidence: 0.9, recorded_at_ms: 0 })
    store.record({ role: "worker", validation_outcome: "low_confidence", confidence: 0.3, recorded_at_ms: 0 })
    store.record({ role: "manager", validation_outcome: "passed", confidence: 0.8, recorded_at_ms: 2000 })

    const atOneThousand = store.query(1000)
    expect(atOneThousand).toHaveLength(1)
    expect(atOneThousand[0]!.confidence).toBe(0.9)

    const atThreeThousand = store.query(3000)
    expect(atThreeThousand.map((entry) => entry.role).sort()).toEqual(["manager"])
  })

  test("query filters by role when supplied", () => {
    const store = createEvidenceStore({ windowMs: 10_000 })
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 0 })
    store.record({ role: "architect", validation_outcome: "passed", confidence: 1, recorded_at_ms: 0 })
    expect(store.query(0, "worker")).toHaveLength(1)
    expect(store.query(0, "architect")).toHaveLength(1)
    expect(store.query(0)).toHaveLength(2)
  })

  test("evicts entries older than the TTL even if never queried in between", () => {
    const store = createEvidenceStore({ ttlMs: 100, windowMs: 100_000 })
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 0 })
    expect(store.size()).toBe(1)
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 500 })
    expect(store.size()).toBe(1)
  })

  test("clear empties the store", () => {
    const store = createEvidenceStore()
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 0 })
    store.clear()
    expect(store.size()).toBe(0)
  })

  test("bounds worst-case memory by capacity", () => {
    const store = createEvidenceStore({ capacity: 2, windowMs: 100_000, ttlMs: 100_000 })
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 0 })
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 1 })
    store.record({ role: "worker", validation_outcome: "passed", confidence: 1, recorded_at_ms: 2 })
    expect(store.size()).toBe(2)
  })
})
