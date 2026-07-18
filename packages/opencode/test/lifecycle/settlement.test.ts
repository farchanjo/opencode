/**
 * Feature 002 / T030 — the terminal↔settlement seam (C20, FR64). A Task is never
 * marked terminal-as-successfully-settled until Feature 005 reports settlement:
 * a `completed` row enters `settling`, and only `reportSettlement` moves it to
 * `settled`/`unknown`/`corrupt`, projecting the bounded OutputRef/cursor only.
 * In-process fixture style over the real core Process Table.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import { createEventV2Adapter } from "@/lifecycle/eventv2-adapter"
import { emitEnvelope, fakeBridge } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

async function driveToCompleted() {
  const table = createProcessTable()
  const { bridge } = fakeBridge()
  let n = 0
  const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${n++}` })
  for (const eventType of ["lifecycle.process_created", "lifecycle.admitted", "lifecycle.started", "lifecycle.completed"] as const) {
    await run(adapter.emit({ envelope: emitEnvelope({ eventType }), eventType, data: eventType === "lifecycle.admitted" ? { scope: "session", decision: "granted", fanout: { requested: 1, granted: 1 } } : {} }))
  }
  return { table, adapter }
}

describe("T030 settlement seam", () => {
  test("a completed row enters `settling`, never `settled`, until Feature 005 reports", async () => {
    const { table } = await driveToCompleted()
    const row = table.get("proc_1" as never)
    expect(row?.status.state).toBe("completed")
    expect(row?.status.settlement).toBe("settling")
    expect(row?.status.output_ref).toBeNull()
  })

  test("reportSettlement moves `settling` -> `settled` and projects the bounded OutputRef/cursor", async () => {
    const { table, adapter } = await driveToCompleted()

    const out = await run(
      adapter.reportSettlement({
        processId: "proc_1" as never,
        settlement: "settled",
        outputRef: { ref: "out_abc", cursor: "cur_10" },
      }),
    )

    expect(out.applied).toBe(true)
    expect(out.settlement).toBe("settled")
    const row = table.get("proc_1" as never)
    expect(row?.status.settlement).toBe("settled")
    expect(row?.status.output_ref).toEqual({ ref: "out_abc", cursor: "cur_10" })
  })

  test("reportSettlement can mark a settling row `corrupt` with no output ref", async () => {
    const { table, adapter } = await driveToCompleted()
    const out = await run(adapter.reportSettlement({ processId: "proc_1" as never, settlement: "corrupt" }))
    expect(out.applied).toBe(true)
    expect(table.get("proc_1" as never)?.status.settlement).toBe("corrupt")
    expect(table.get("proc_1" as never)?.status.output_ref).toBeNull()
  })

  test("settlement on an unknown process is a no-op, never inventing a verdict", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table })
    const out = await run(adapter.reportSettlement({ processId: "proc_missing" as never, settlement: "settled" }))
    expect(out.applied).toBe(false)
    expect(out.settlement).toBeNull()
  })

  test("settlement on a still-running (non-terminal) process is refused", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    let n = 0
    const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${n++}` })
    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.process_created" }), eventType: "lifecycle.process_created", data: {} }))
    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.started" }), eventType: "lifecycle.started", data: {} }))

    const out = await run(adapter.reportSettlement({ processId: "proc_1" as never, settlement: "settled" }))
    expect(out.applied).toBe(false)
    expect(table.get("proc_1" as never)?.status.settlement).toBeNull()
  })
})
