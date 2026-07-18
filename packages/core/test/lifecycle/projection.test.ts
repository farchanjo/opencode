import { describe, expect, test } from "bun:test"
import { Projection } from "@opencode-ai/core/lifecycle/projection"
import type { LifecycleEnvelope } from "@opencode-ai/schema/lifecycle/envelope"
import type { LifecycleEventType, ProcessState } from "@opencode-ai/schema/lifecycle/enums"

// Feature 002 / T016 — the idempotent lifecycle projector: keyed on event id +
// (aggregateID, seq); surfaces duplicate/out_of_order/unknown_process/unreconciled
// without throwing and without inventing terminal state (FR23, FR29, C9).

const envelope = (input: { process_id?: string; root_process_id?: string }): LifecycleEnvelope =>
  ({
    process: {
      process_id: input.process_id ?? "proc_1",
      root_process_id: input.root_process_id ?? "root_1",
      parent_process_id: null,
      task_id: "task_1",
    },
    tree: { session_id: "sess_1", parent_session_id: null, root_session_id: "root_sess_1" },
    ordering: { attempt: 1, generation: 1, sequence: 1 },
    kind: { runtime_instance_id: "rt_1", actor_kind: "runtime" },
    delivery: { visibility: "session", timestamp: 1000 },
    hierarchy: null,
  }) as unknown as LifecycleEnvelope

const record = (input: {
  id: string
  type: string
  seq: number | null
  process_id?: string
  root_process_id?: string
}): Projection.LifecycleEventRecord => ({
  id: input.id as never,
  type: input.type as LifecycleEventType,
  envelope: envelope(input),
  seq: input.seq,
})

const st = (s: string): ProcessState => s as ProcessState

describe("Projection — anomaly kinds", () => {
  test("exposes exactly the four schema AnomalyKind literals", () => {
    expect([...Projection.ANOMALY_KINDS]).toEqual(["duplicate", "out_of_order", "unknown_event", "unreconciled"])
  })
})

describe("Projection — creation and unknown process", () => {
  test("process_created against a fresh process yields a created outcome", () => {
    const p = Projection.createProjector()
    const outcome = p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    expect(outcome.kind).toBe("created")
    if (outcome.kind === "created") expect(outcome.state).toBe("created")
  })

  test("a non-creation event for a process with no created row is unknown_process (unknown_event)", () => {
    const p = Projection.createProjector()
    const outcome = p.classify(record({ id: "e1", type: "lifecycle.started", seq: 0 }), null)
    expect(outcome.kind).toBe("unknown_process")
    if (outcome.kind === "unknown_process") expect(outcome.anomaly.kind).toBe("unknown_event")
  })

  test("a second process_created over an existing row is unreconciled, never a regression", () => {
    const p = Projection.createProjector()
    // In-order at the aggregate high-water (seq 0) so the ordering gate passes and
    // the creation-over-existing-row check fires.
    const outcome = p.classify(record({ id: "e2", type: "lifecycle.process_created", seq: 0 }), st("running"))
    expect(outcome.kind).toBe("unreconciled")
    if (outcome.kind === "unreconciled") expect(outcome.anomaly.reason).toBe("duplicate_creation")
  })
})

describe("Projection — idempotency keyed on event id (C9, at-least-once)", () => {
  test("a redelivered event id is a duplicate and the row is untouched", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    const dup = p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), st("created"))
    expect(dup.kind).toBe("duplicate")
    if (dup.kind === "duplicate") expect(dup.anomaly.kind).toBe("duplicate")
  })

  test("seen() reports whether an event id was already classified", () => {
    const p = Projection.createProjector()
    expect(p.seen("e0" as never)).toBe(false)
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    expect(p.seen("e0" as never)).toBe(true)
  })
})

describe("Projection — durable ordering keyed on (aggregateID, seq)", () => {
  test("a sequence gap ahead of the high-water mark is out_of_order", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    const gap = p.classify(record({ id: "e5", type: "lifecycle.started", seq: 5 }), st("created"))
    expect(gap.kind).toBe("out_of_order")
    if (gap.kind === "out_of_order") expect(gap.anomaly.kind).toBe("out_of_order")
  })

  test("a stale sequence at or below the high-water mark is out_of_order", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    p.classify(record({ id: "e1", type: "lifecycle.admitted", seq: 1 }), st("created"))
    const stale = p.classify(record({ id: "e1b", type: "lifecycle.admitted", seq: 1 }), st("queued"))
    expect(stale.kind).toBe("out_of_order")
    expect(p.appliedSeq("root_1" as never)).toBe(1)
  })

  test("live members (seq null) never trigger ordering anomalies", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    p.classify(record({ id: "e1", type: "lifecycle.admitted", seq: 1 }), st("created"))
    const live = p.classify(record({ id: "eq", type: "lifecycle.queued", seq: null }), st("queued"))
    expect(live.kind).toBe("applied")
  })

  test("appliedSeq advances on an in-order durable event even when the transition is illegal", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    // completed is durable and in-order at seq 1, but illegal from created.
    const outcome = p.classify(record({ id: "e1", type: "lifecycle.completed", seq: 1 }), st("created"))
    expect(outcome.kind).toBe("unreconciled")
    expect(p.appliedSeq("root_1" as never)).toBe(1)
  })
})

describe("Projection — state transition delegation (T017)", () => {
  test("a legal transition is applied and carries the new state", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    const outcome = p.classify(record({ id: "e1", type: "lifecycle.admitted", seq: 1 }), st("created"))
    expect(outcome.kind).toBe("applied")
    if (outcome.kind === "applied") {
      expect(outcome.state).toBe("queued")
      expect(outcome.transition.kind).toBe("transition")
    }
  })

  test("an illegal transition is unreconciled — never a thrown error or invented terminal", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    const outcome = p.classify(record({ id: "eb", type: "lifecycle.tool_settled", seq: null }), st("completed"))
    expect(outcome.kind).toBe("unreconciled")
    if (outcome.kind === "unreconciled") expect(outcome.anomaly.kind).toBe("unreconciled")
  })

  test("an in-state observation is applied and preserves the current state", () => {
    const p = Projection.createProjector()
    const outcome = p.classify(record({ id: "et", type: "lifecycle.turn_started", seq: null }), st("running"))
    expect(outcome.kind).toBe("applied")
    if (outcome.kind === "applied") expect(outcome.state).toBe("running")
  })
})

describe("Projection — reset", () => {
  test("reset clears the ledger so a fresh replay starts clean", () => {
    const p = Projection.createProjector()
    p.classify(record({ id: "e0", type: "lifecycle.process_created", seq: 0 }), null)
    p.reset()
    expect(p.seen("e0" as never)).toBe(false)
    expect(p.appliedSeq("root_1" as never)).toBe(-1)
  })
})
