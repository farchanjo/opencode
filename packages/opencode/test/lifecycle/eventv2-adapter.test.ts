/**
 * Feature 002 / T025 — the lifecycle-to-EventV2 adapter. Exercises the real
 * core Process Table (createProcessTable) through the adapter's `emit`,
 * `project`, and `replay`, plus `normalizeRecord`, against the in-memory bridge
 * fixture. No database or live runtime (in-process fixture style).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import { createEventV2Adapter, normalizeRecord, type AggregatePage } from "@/lifecycle/eventv2-adapter"
import type { Projection } from "@opencode-ai/core/lifecycle/projection"
import { emitEnvelope, fakeBridge, payload } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

describe("T025 EventV2 adapter — emit", () => {
  test("durable process_created creates a row and returns the committed durable position", async () => {
    const table = createProcessTable()
    const { bridge, published } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table, newEventId: () => "evt_1" })

    const out = await run(
      adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.process_created" }), eventType: "lifecycle.process_created", data: {} }),
    )

    expect(out.eventId as string).toBe("evt_1")
    expect(out.durable).toEqual({ aggregateID: "proc_root", seq: 0, version: 1 })
    expect(published).toHaveLength(1)
    expect(table.get("proc_1" as never)?.status.state).toBe("created")
  })

  test("a durable chain advances the row through the state machine", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    let n = 0
    const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${n++}` })

    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.process_created" }), eventType: "lifecycle.process_created", data: {} }))
    await run(
      adapter.emit({
        envelope: emitEnvelope({ eventType: "lifecycle.admitted" }),
        eventType: "lifecycle.admitted",
        data: { scope: "session", decision: "granted", fanout: { requested: 1, granted: 1 } },
      }),
    )
    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.started" }), eventType: "lifecycle.started", data: {} }))

    expect(table.get("proc_1" as never)?.status.state).toBe("running")
  })

  test("a live event projects without a durable sequence", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    let n = 0
    const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${n++}` })

    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.process_created" }), eventType: "lifecycle.process_created", data: {} }))
    const out = await run(
      adapter.emit({
        envelope: emitEnvelope({ eventType: "lifecycle.tool_called" }),
        eventType: "lifecycle.tool_called",
        data: { activity: "read", label: "reading" },
      }),
    )

    expect(out.durable).toBeNull()
  })

  test("an unknown event type fails with unknown_event_type", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table })

    const exit = await Effect.runPromiseExit(
      adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.nope" }), eventType: "lifecycle.nope" as never, data: {} }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("T025 EventV2 adapter — normalizeRecord", () => {
  test("maps a durable payload onto the core record with its seq", () => {
    const p = payload({ eventType: "lifecycle.started", processId: "proc_1" }, { id: "evt_9", seq: 4 })
    const record = normalizeRecord(p)
    expect(record.id as string).toBe("evt_9")
    expect(record.type).toBe("lifecycle.started")
    expect(record.seq).toBe(4)
    expect(record.envelope.process.process_id as string).toBe("proc_1")
  })

  test("maps a live payload with a null seq", () => {
    const p = payload({ eventType: "lifecycle.tool_called" })
    expect(normalizeRecord(p).seq).toBeNull()
  })
})

describe("T025 EventV2 adapter — project", () => {
  test("a duplicate event surfaces a duplicate anomaly and does not re-apply", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table })

    const created = payload({ eventType: "lifecycle.process_created", processId: "proc_1" }, { id: "evt_c", seq: 0 })
    const record = normalizeRecord(created)
    const input = {
      eventId: record.id,
      eventType: record.type,
      envelope: record.envelope,
      data: {},
      durable: { aggregateID: "proc_root", seq: 0 },
    }

    const first = await run(adapter.project(input as never))
    const second = await run(adapter.project(input as never))

    expect(first.applied).toBe(true)
    expect(second.applied).toBe(false)
    expect(second.anomaly?.kind).toBe("duplicate")
  })
})

describe("T025 EventV2 adapter — replay", () => {
  test("wires readAggregate into rebuild and counts unreconciled restarts", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()

    const records: Projection.LifecycleEventRecord[] = [
      normalizeRecord(payload({ eventType: "lifecycle.process_created", processId: "proc_1" }, { id: "e0", seq: 0 })),
      normalizeRecord(payload({ eventType: "lifecycle.admitted", processId: "proc_1" }, { id: "e1", seq: 1 })),
      normalizeRecord(payload({ eventType: "lifecycle.started", processId: "proc_1" }, { id: "e2", seq: 2 })),
    ]
    const page: AggregatePage = { records, hasMore: false, cursor: 2 }

    const adapter = createEventV2Adapter({
      bridge,
      table,
      readAggregate: () => Effect.succeed(page),
      // Restart with no live owner: the running row reconciles to unknown (FR40).
      reconcile: () => ({ owner_present: false, from_version: 1, durable_version: 1 }),
    })

    const out = await run(adapter.replay({ scope: "root", scopeId: "proc_root", limit: 100 }))

    expect(out.hasMore).toBe(false)
    expect(out.cursor).toBe(2)
    expect(out.unreconciledCount).toBe(1)
    expect(table.get("proc_1" as never)?.status.state).toBe("unknown")
    expect(adapter.rebuiltRows("root", "proc_root")).toHaveLength(1)
  })

  test("replay without a reader is not_implemented", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table })
    const exit = await Effect.runPromiseExit(adapter.replay({ scope: "root", scopeId: "proc_root", limit: 10 }))
    expect(exit._tag).toBe("Failure")
  })
})
