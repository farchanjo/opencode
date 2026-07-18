import { describe, expect, test } from "bun:test"
import { ProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import type { LifecycleEnvelope } from "@opencode-ai/schema/lifecycle/envelope"
import type { LifecycleEventType } from "@opencode-ai/schema/lifecycle/enums"
import type { LifecycleEventRecord } from "@opencode-ai/core/lifecycle/projection"

// Feature 002 / T018 — the per-root/session in-memory Process Table: folds
// events through the projector (T016) + state machine (T017), rebuilt via replay,
// restart-reconciled to unknown/unreconciled, bounded retention (FR4, FR27, C6).

const envelope = (input: {
  process_id?: string
  root_process_id?: string
  session_id?: string
  hierarchy?: boolean
}): LifecycleEnvelope =>
  ({
    process: {
      process_id: input.process_id ?? "proc_1",
      root_process_id: input.root_process_id ?? "root_1",
      parent_process_id: null,
      task_id: "task_1",
    },
    tree: { session_id: input.session_id ?? "sess_1", parent_session_id: null, root_session_id: "root_sess_1" },
    ordering: { attempt: 1, generation: 1, sequence: 1 },
    kind: { runtime_instance_id: "rt_1", actor_kind: "runtime" },
    delivery: { visibility: "session", timestamp: 1000 },
    hierarchy: input.hierarchy
      ? {
          role: "worker",
          delegation: { depth: 2, path: ["sess_1"] },
          fanout: { requested: 3, granted: 2 },
          validation_outcome: "passed",
        }
      : null,
  }) as unknown as LifecycleEnvelope

const record = (input: {
  id: string
  type: string
  seq: number | null
  process_id?: string
  root_process_id?: string
  session_id?: string
  hierarchy?: boolean
}): LifecycleEventRecord => ({
  id: input.id as never,
  type: input.type as LifecycleEventType,
  envelope: envelope(input),
  seq: input.seq,
})

/** Drive a process from created through to a terminal state. */
const createProc = (
  table: ReturnType<typeof ProcessTable.createProcessTable>,
  process_id: string,
  root_process_id: string,
  seqBase: number,
) => {
  table.applyEvent(record({ id: `${process_id}-c`, type: "lifecycle.process_created", seq: seqBase, process_id, root_process_id }))
}

describe("ProcessTable — creation materializes a projectable row", () => {
  test("process_created builds a created row with identity, relations, and ownership", () => {
    const table = ProcessTable.createProcessTable()
    const { outcome, row } = table.applyEvent(
      record({ id: "e0", type: "lifecycle.process_created", seq: 0, hierarchy: true }),
    )
    expect(outcome.kind).toBe("created")
    expect(row?.status.state).toBe("created")
    expect(row?.relations.root_process_id).toBe("root_1" as never)
    expect(row?.identity.task_id).toBe("task_1" as never)
    expect(row?.ownership.actor_kind).toBe("runtime")
    expect(row?.hierarchy?.role).toBe("worker")
    expect(row?.hierarchy?.route_path).toEqual(["sess_1"] as never)
  })

  test("get returns the stored row by process id", () => {
    const table = ProcessTable.createProcessTable()
    table.applyEvent(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }))
    expect(table.get("proc_1" as never)?.id).toBe("proc_1" as never)
  })
})

describe("ProcessTable — the event fold advances state and stamps terminals", () => {
  test("a legal transition advances the row state", () => {
    const table = ProcessTable.createProcessTable()
    table.applyEvent(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }))
    const { row } = table.applyEvent(record({ id: "e1", type: "lifecycle.admitted", seq: 1 }))
    expect(row?.status.state).toBe("queued")
  })

  test("reaching a terminal state stamps reason, terminal_at, and terminal_order", () => {
    const table = ProcessTable.createProcessTable()
    table.applyEvent(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }))
    table.applyEvent(record({ id: "e1", type: "lifecycle.admitted", seq: 1 }))
    table.applyEvent(record({ id: "e2", type: "lifecycle.started", seq: 2 }))
    const { row } = table.applyEvent(record({ id: "e3", type: "lifecycle.completed", seq: 3 }))
    expect(row?.status.state).toBe("completed")
    expect(row?.status.reason).toBe("completed_ok")
    expect(row?.status.terminal_at).not.toBeNull()
    expect(row?.terminal_order).toBe(0)
  })

  test("an unreconciled event attaches an anomaly without inventing terminal state (C9)", () => {
    const table = ProcessTable.createProcessTable()
    table.applyEvent(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }))
    const { outcome, row } = table.applyEvent(record({ id: "e1", type: "lifecycle.completed", seq: 1 }))
    expect(outcome.kind).toBe("unreconciled")
    expect(row?.status.state).toBe("created")
    expect(row?.anomalies).toHaveLength(1)
    expect(row?.anomalies[0]!.kind).toBe("unreconciled")
  })

  test("an event for an unknown process is a no-op with no row", () => {
    const table = ProcessTable.createProcessTable()
    const { outcome, row } = table.applyEvent(record({ id: "e1", type: "lifecycle.started", seq: 0 }))
    expect(outcome.kind).toBe("unknown_process")
    expect(row).toBeUndefined()
  })
})

describe("ProcessTable — per-root and per-session topology", () => {
  test("rows are indexed by root process and by session", () => {
    const table = ProcessTable.createProcessTable()
    // p1 and p2 share root r1, so they occupy successive positions in the r1
    // durable aggregate sequence (seq 0 then seq 1); p3 opens its own root r2.
    table.applyEvent(record({ id: "a", type: "lifecycle.process_created", seq: 0, process_id: "p1", root_process_id: "r1", session_id: "s1" }))
    table.applyEvent(record({ id: "b", type: "lifecycle.process_created", seq: 1, process_id: "p2", root_process_id: "r1", session_id: "s2" }))
    table.applyEvent(record({ id: "c", type: "lifecycle.process_created", seq: 0, process_id: "p3", root_process_id: "r2", session_id: "s1" }))
    expect(table.rootProcesses("r1" as never).map((r) => r.id).sort()).toEqual(["p1", "p2"] as never)
    expect(table.sessionProcesses("s1" as never).map((r) => r.id).sort()).toEqual(["p1", "p3"] as never)
    expect(table.snapshot()).toEqual({ total: 3, terminal: 0, roots: 2 })
  })
})

describe("ProcessTable — rebuild by replaying a durable aggregate page (C6)", () => {
  test("rebuild folds an ordered record stream into rows with an audit", () => {
    const table = ProcessTable.createProcessTable()
    const audit = table.rebuild([
      record({ id: "e0", type: "lifecycle.process_created", seq: 0 }),
      record({ id: "e1", type: "lifecycle.admitted", seq: 1 }),
      record({ id: "e2", type: "lifecycle.started", seq: 2 }),
      record({ id: "e3", type: "lifecycle.completed", seq: 3 }),
    ])
    expect(audit).toEqual({ applied: 3, created: 1, anomalies: 0 })
    expect(table.get("proc_1" as never)?.status.state).toBe("completed")
  })
})

describe("ProcessTable — restart reconciliation into unknown/unreconciled (FR39, FR40, AC13)", () => {
  test("a non-terminal row with no live owner becomes unknown/unreconciled, no auto-retry", () => {
    const table = ProcessTable.createProcessTable()
    table.applyEvent(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }))
    table.applyEvent(record({ id: "e1", type: "lifecycle.admitted", seq: 1 }))
    table.applyEvent(record({ id: "e2", type: "lifecycle.started", seq: 2 }))
    const records = table.reconcileRestart(() => ({ owner_present: false, from_version: 1 as never, durable_version: 1 as never }))
    expect(records).toHaveLength(1)
    expect(records[0]!.outcome).toBe("unknown")
    expect(records[0]!.auto_retry).toBe(false)
    const row = table.get("proc_1" as never)
    expect(row?.status.state).toBe("unknown")
    expect(row?.status.reason).toBe("reconciled_unknown")
    expect(row?.anomalies.some((a) => a.kind === "unreconciled")).toBe(true)
  })

  test("a terminal row is confirmed reconciled and never regressed (C13)", () => {
    const table = ProcessTable.createProcessTable()
    table.rebuild([
      record({ id: "e0", type: "lifecycle.process_created", seq: 0 }),
      record({ id: "e1", type: "lifecycle.admitted", seq: 1 }),
      record({ id: "e2", type: "lifecycle.started", seq: 2 }),
      record({ id: "e3", type: "lifecycle.completed", seq: 3 }),
    ])
    const records = table.reconcileRestart(() => ({ owner_present: false, from_version: 1 as never, durable_version: 1 as never }))
    expect(records[0]!.outcome).toBe("reconciled")
    expect(table.get("proc_1" as never)?.status.state).toBe("completed")
  })
})

describe("ProcessTable — bounded retention with auditable counts (FR27, AC15)", () => {
  // All three processes share root r1, so they occupy successive, non-overlapping
  // spans of the single r1 durable aggregate sequence.
  const terminate = (table: ReturnType<typeof ProcessTable.createProcessTable>, id: string, base: number) => {
    createProc(table, id, "r1", base)
    table.applyEvent(record({ id: `${id}-a`, type: "lifecycle.admitted", seq: base + 1, process_id: id, root_process_id: "r1" }))
    table.applyEvent(record({ id: `${id}-s`, type: "lifecycle.started", seq: base + 2, process_id: id, root_process_id: "r1" }))
    table.applyEvent(record({ id: `${id}-t`, type: "lifecycle.completed", seq: base + 3, process_id: id, root_process_id: "r1" }))
  }

  test("planRetention marks the oldest terminal rows beyond the cap; applyRetention drops them", () => {
    const table = ProcessTable.createProcessTable()
    ;["p1", "p2", "p3"].forEach((id, i) => terminate(table, id, i * 4))
    const audit = table.planRetention("r1" as never, { maxTerminalRowsPerRoot: 2 })
    expect(audit.pruned_count).toBe(1)
    expect(audit.kept_count).toBe(2)
    expect(audit.pruned_process_ids).toEqual(["p1"] as never) // oldest terminal_order first
    table.applyRetention(audit)
    expect(table.get("p1" as never)).toBeUndefined()
    expect(table.rootProcesses("r1" as never)).toHaveLength(2)
  })

  test("under the cap prunes nothing", () => {
    const table = ProcessTable.createProcessTable()
    terminate(table, "p1", 0)
    const audit = table.planRetention("r1" as never, { maxTerminalRowsPerRoot: 200 })
    expect(audit.pruned_count).toBe(0)
    expect(audit.kept_count).toBe(1)
  })

  test("the default retention constant matches the data-model provisional value", () => {
    expect(ProcessTable.DEFAULT_RETENTION.maxTerminalRowsPerRoot).toBe(200)
    expect(ProcessTable.RETENTION_PRUNE_OLDER_THAN_MS).toBe(3_600_000)
  })
})
