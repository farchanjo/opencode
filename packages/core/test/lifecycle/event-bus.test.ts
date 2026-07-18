import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { EventBus } from "@opencode-ai/core/lifecycle/event-bus"
import { EventV2 } from "@opencode-ai/core/event"

const payload = (type: string): EventV2.Payload =>
  ({ id: EventV2.ID.create(), type, data: {} }) as unknown as EventV2.Payload

describe("EventBus — Definition inventory (C2, C4)", () => {
  test("registers exactly the 26 closed vocabulary members", () => {
    expect(EventBus.Definitions).toHaveLength(26)
    expect(EventBus.ByType.size).toBe(26)
    expect(EventBus.LifecycleEventTypes).toHaveLength(26)
    for (const type of EventBus.LifecycleEventTypes) {
      expect(type.startsWith("lifecycle.")).toBe(true)
    }
  })

  test("the eleven durable members carry durable {version: 1, aggregate: root_process_id} (C4, C5)", () => {
    expect(EventBus.DurableDefinitions).toHaveLength(11)
    for (const def of EventBus.DurableDefinitions) {
      expect(def.durable).toBeDefined()
      expect(def.durable?.version).toBe(1)
      expect(def.durable?.aggregate).toBe("root_process_id")
    }
  })

  test("the fifteen live members omit the durable annotation (C4)", () => {
    expect(EventBus.LiveDefinitions).toHaveLength(15)
    for (const def of EventBus.LiveDefinitions) {
      expect(def.durable).toBeUndefined()
    }
  })

  test("durable and live members are disjoint and cover the vocabulary", () => {
    const durable = new Set(EventBus.DurableDefinitions.map((d) => d.type))
    const live = new Set(EventBus.LiveDefinitions.map((d) => d.type))
    for (const t of durable) expect(live.has(t)).toBe(false)
    expect(durable.size + live.size).toBe(26)
  })

  test("no raw tagged union is exposed — only per-member Definitions (C2)", () => {
    for (const [type, def] of EventBus.ByType) {
      expect(def.type).toBe(type)
    }
  })
})

describe("EventBus — priority classification (C10, FR35-FR37)", () => {
  test("priority set covers the terminal, cancellation and tool-boundary members", () => {
    expect([...EventBus.PRIORITY_EVENT_TYPES].sort()).toEqual(
      [
        "lifecycle.completed",
        "lifecycle.failed",
        "lifecycle.cancelled",
        "lifecycle.zombie_detected",
        "lifecycle.owner_lost",
        "lifecycle.cancel_requested",
        "lifecycle.cancelling",
        "lifecycle.tool_called",
        "lifecycle.tool_settled",
      ].sort(),
    )
    for (const t of EventBus.PRIORITY_EVENT_TYPES) {
      expect(EventBus.isPriorityEvent(payload(t))).toBe(true)
    }
  })

  test("isLifecycleEvent recognizes registered members and rejects foreign events", () => {
    expect(EventBus.isLifecycleEvent(payload("lifecycle.started"))).toBe(true)
    expect(EventBus.isLifecycleEvent(payload("routing.decision"))).toBe(false)
    expect(EventBus.isPriorityEvent(payload("lifecycle.started"))).toBe(false)
  })
})

/**
 * A minimal EventV2 listen seam: `subscribeBounded` only exercises `listen`, so
 * a partial fake capturing the registered subscriber is sufficient to drive the
 * bounded queue without a real Database-backed EventV2 layer.
 */
const listenSeam = () => {
  const subscribers: Array<(event: EventV2.Payload) => Effect.Effect<void>> = []
  const iface = {
    listen: (subscriber: (event: EventV2.Payload) => Effect.Effect<void>) =>
      Effect.sync(() => {
        subscribers.push(subscriber)
        return Effect.sync(() => {
          const i = subscribers.indexOf(subscriber)
          if (i >= 0) subscribers.splice(i, 1)
        })
      }),
  } as unknown as EventV2.Interface
  const emit = (event: EventV2.Payload) => Effect.forEach(subscribers, (s) => s(event), { discard: true })
  return { iface, emit }
}

describe("EventBus — bounded subscription surface (C10, C14, AC7)", () => {
  test("filters to lifecycle members and preserves order under the queue bound", async () => {
    const result = await Effect.gen(function* () {
      const { iface, emit } = listenSeam()
      const stream = yield* EventBus.subscribeBounded(iface, { capacity: 16 })
      yield* emit(payload("lifecycle.process_created"))
      yield* emit(payload("routing.decision")) // filtered out — never enters the queue
      yield* emit(payload("lifecycle.started"))
      yield* emit(payload("lifecycle.completed"))
      const chunk = yield* stream.pipe(Stream.take(3), Stream.runCollect)
      return Array.from(chunk).map((p) => p.type)
    }).pipe(Effect.scoped, Effect.runPromise)
    expect(result).toEqual(["lifecycle.process_created", "lifecycle.started", "lifecycle.completed"])
  })

  test("drop policy rejects the newest live signals beyond capacity (never blocks the producer)", async () => {
    const result = await Effect.gen(function* () {
      const { iface, emit } = listenSeam()
      const stream = yield* EventBus.subscribeBounded(iface, { capacity: 2, overflow: "drop" })
      for (const t of ["lifecycle.turn_started", "lifecycle.turn_ended", "lifecycle.tool_called", "lifecycle.tool_settled"]) {
        yield* emit(payload(t))
      }
      const chunk = yield* stream.pipe(Stream.take(2), Stream.runCollect)
      return Array.from(chunk).map((p) => p.type)
    }).pipe(Effect.scoped, Effect.runPromise)
    // Dropping queue keeps the earliest admitted signals and drops the overflow.
    expect(result).toEqual(["lifecycle.turn_started", "lifecycle.turn_ended"])
  })

  test("backpressure policy evicts the oldest live signal to admit the newest", async () => {
    const result = await Effect.gen(function* () {
      const { iface, emit } = listenSeam()
      const stream = yield* EventBus.subscribeBounded(iface, { capacity: 2, overflow: "backpressure" })
      for (const t of ["lifecycle.turn_started", "lifecycle.turn_ended", "lifecycle.tool_called", "lifecycle.tool_settled"]) {
        yield* emit(payload(t))
      }
      const chunk = yield* stream.pipe(Stream.take(2), Stream.runCollect)
      return Array.from(chunk).map((p) => p.type)
    }).pipe(Effect.scoped, Effect.runPromise)
    // Sliding queue evicts the oldest, retaining the two most-recent signals.
    expect(result).toEqual(["lifecycle.tool_called", "lifecycle.tool_settled"])
  })
})
