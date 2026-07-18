import { describe, expect, test } from "bun:test"
import {
  BoundedExportQueue,
  cardinalityBudget,
  createLabelBounder,
  type QueueSignal,
} from "@opencode-ai/core/observability/otlp"

const collector = () => {
  const signals: Array<QueueSignal> = []
  return { signals, onSignal: (signal: QueueSignal) => signals.push(signal) }
}

describe("BoundedExportQueue drop policy", () => {
  test("rejects the incoming signal at capacity without blocking", () => {
    const { signals, onSignal } = collector()
    const queue = new BoundedExportQueue<number>({ capacity: 2, batchSize: 10, dropPolicy: "drop", onSignal })
    expect(queue.enqueue(1)).toEqual({ accepted: true })
    expect(queue.enqueue(2)).toEqual({ accepted: true })
    expect(queue.enqueue(3)).toEqual({ accepted: false, dropReason: "queue_full" })
    expect(queue.size).toBe(2)
    expect(queue.dropCount).toBe(1)
    expect(queue.drain()).toEqual([1, 2])
    expect(signals.some((s) => s.kind === "drop" && s.dropReason === "queue_full")).toBe(true)
  })

  test("emits queue capacity at construction", () => {
    const { signals, onSignal } = collector()
    new BoundedExportQueue<number>({ capacity: 5, batchSize: 2, dropPolicy: "drop", onSignal })
    expect(signals[0]).toEqual({ kind: "queue_capacity", value: 5 })
  })
})

describe("BoundedExportQueue backpressure policy", () => {
  test("evicts the oldest to admit the newest", () => {
    const { signals, onSignal } = collector()
    const queue = new BoundedExportQueue<number>({ capacity: 2, batchSize: 10, dropPolicy: "backpressure", onSignal })
    queue.enqueue(1)
    queue.enqueue(2)
    expect(queue.enqueue(3)).toEqual({ accepted: true, dropReason: "backpressure_evict" })
    expect(queue.size).toBe(2)
    expect(queue.dropCount).toBe(1)
    expect(queue.drain()).toEqual([2, 3])
    expect(signals.some((s) => s.kind === "drop" && s.dropReason === "backpressure_evict")).toBe(true)
  })
})

describe("BoundedExportQueue drain and depth signals", () => {
  test("drain returns at most batchSize entries", () => {
    const queue = new BoundedExportQueue<number>({ capacity: 10, batchSize: 2, dropPolicy: "drop" })
    for (const value of [1, 2, 3, 4, 5]) queue.enqueue(value)
    expect(queue.drain()).toEqual([1, 2])
    expect(queue.drain()).toEqual([3, 4])
    expect(queue.drain()).toEqual([5])
    expect(queue.drain()).toEqual([])
  })

  test("emits queue depth on enqueue and drain", () => {
    const { signals, onSignal } = collector()
    const queue = new BoundedExportQueue<number>({ capacity: 4, batchSize: 4, dropPolicy: "drop", onSignal })
    queue.enqueue(1)
    queue.enqueue(2)
    queue.drain()
    const depths = signals.filter((s) => s.kind === "queue_depth").map((s) => s.value)
    expect(depths).toEqual([1, 2, 0])
  })
})

describe("BoundedExportQueue staleness pruning", () => {
  test("drops entries older than enqueueTimeoutMs using the injected clock", () => {
    let clock = 0
    const { signals, onSignal } = collector()
    const queue = new BoundedExportQueue<number>({
      capacity: 10,
      batchSize: 10,
      dropPolicy: "drop",
      enqueueTimeoutMs: 100,
      now: () => clock,
      onSignal,
    })
    queue.enqueue(1)
    clock = 250
    queue.enqueue(2)
    expect(queue.drain()).toEqual([2])
    expect(queue.dropCount).toBe(1)
    expect(signals.some((s) => s.kind === "drop" && s.dropReason === "stale")).toBe(true)
  })
})

describe("cardinalityBudget", () => {
  test("defaults to 128 when unset", () => {
    const prev = process.env.OPENCODE_OTEL_CARDINALITY_BUDGET
    delete process.env.OPENCODE_OTEL_CARDINALITY_BUDGET
    try {
      expect(cardinalityBudget()).toBe(128)
    } finally {
      if (prev !== undefined) process.env.OPENCODE_OTEL_CARDINALITY_BUDGET = prev
    }
  })

  test("honors a valid positive override", () => {
    const prev = process.env.OPENCODE_OTEL_CARDINALITY_BUDGET
    process.env.OPENCODE_OTEL_CARDINALITY_BUDGET = "16"
    try {
      expect(cardinalityBudget()).toBe(16)
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_OTEL_CARDINALITY_BUDGET
      else process.env.OPENCODE_OTEL_CARDINALITY_BUDGET = prev
    }
  })
})

describe("createLabelBounder", () => {
  test("bounds enum labels and passes valid values through", () => {
    const bounder = createLabelBounder(8)
    const bound = bounder.bound({ status: "success", task_class: "gigantic", hierarchy_role: "worker" })
    expect(bound).toEqual({ status: "success", task_class: "other", hierarchy_role: "worker" })
  })

  test("admits dynamic ids up to the budget then collapses to other", () => {
    const bounder = createLabelBounder(1)
    expect(bounder.bound({ provider: "anthropic" }).provider).toBe("anthropic")
    expect(bounder.bound({ provider: "openai" }).provider).toBe("other")
    expect(bounder.bound({ provider: "anthropic" }).provider).toBe("anthropic")
  })

  test("passes unknown label keys through untouched", () => {
    const bounder = createLabelBounder(8)
    expect(bounder.bound({ custom: "value" })).toEqual({ custom: "value" })
  })

  test("reset re-opens the dynamic-id budget", () => {
    const bounder = createLabelBounder(1)
    bounder.bound({ model: "claude" })
    expect(bounder.bound({ model: "gpt" }).model).toBe("other")
    bounder.reset()
    expect(bounder.bound({ model: "gpt" }).model).toBe("gpt")
  })
})
