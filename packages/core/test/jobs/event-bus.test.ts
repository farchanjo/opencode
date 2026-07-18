import { describe, expect, test } from "bun:test"
import { EventBus } from "@opencode-ai/core/jobs/event-bus"
import type { JobEnvelope } from "@opencode-ai/schema/jobs/envelope"
import type { JobEventType, OccurrenceState } from "@opencode-ai/core/jobs/occurrence-state-machine"

// Feature 003 / T017 — the job.* EventV2 bus + idempotent projector: keyed on
// event id + (aggregateID, seq); surfaces duplicate/out_of_order/
// unknown_occurrence/unreconciled without throwing and without inventing terminal
// state; a non-occurrence member is observed, never dropped (FR11, FR12, C8, AC18).

const envelope = (input: { occurrence_id?: string; root_session_id?: string }): JobEnvelope =>
  ({
    occurrence: { occurrence_id: input.occurrence_id ?? "occ_1" },
    tree: { root_session_id: input.root_session_id ?? "root_sess_1" },
  }) as unknown as JobEnvelope

const record = (input: {
  id: string
  type: string
  seq: number | null
  occurrence_id?: string
  root_session_id?: string
}): EventBus.JobEventRecord => ({
  id: input.id,
  type: input.type as JobEventType,
  envelope: envelope(input),
  seq: input.seq,
})

const st = (s: string): OccurrenceState => s as OccurrenceState

describe("EventBus — registered job.* Definitions (C8)", () => {
  test("exposes the 23 durable + 7 live members = 30 in ByType", () => {
    expect(EventBus.DurableDefinitions.length).toBe(23)
    expect(EventBus.LiveDefinitions.length).toBe(7)
    expect(EventBus.Definitions.length).toBe(30)
    expect(EventBus.ByType.size).toBe(30)
    expect(EventBus.JobEventTypes.length).toBe(30)
  })

  test("every registered type is namespaced under job.*", () => {
    for (const type of EventBus.JobEventTypes) expect(type.startsWith("job.")).toBe(true)
  })

  test("priority set covers definition-mutation, execution-terminal, and reconcile members (AC18)", () => {
    for (const type of [
      "job.definition_created",
      "job.definition_deleted",
      "job.execution_completed",
      "job.execution_failed",
      "job.execution_cancelled",
      "job.execution_timed_out",
      "job.reconciled",
    ]) {
      expect(EventBus.PRIORITY_EVENT_TYPES.includes(type)).toBe(true)
    }
  })
})

describe("EventBus.Projection — creation and unknown occurrence", () => {
  test("job.trigger_due against a fresh occurrence yields a created due outcome", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "e0", type: "job.trigger_due", seq: null }), null)
    expect(outcome.kind).toBe("created")
    if (outcome.kind === "created") expect(outcome.state).toBe("due")
  })

  test("an occurrence event for an occurrence with no due row is unknown_occurrence", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "e1", type: "job.admitted", seq: 0 }), null)
    expect(outcome.kind).toBe("unknown_occurrence")
    if (outcome.kind === "unknown_occurrence") expect(outcome.anomaly.kind).toBe("unknown_occurrence")
  })

  test("a second job.trigger_due over an existing occurrence is unreconciled, never a regression", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "e2", type: "job.trigger_due", seq: null }), st("claimed"))
    expect(outcome.kind).toBe("unreconciled")
    if (outcome.kind === "unreconciled") expect(outcome.anomaly.reason).toBe("duplicate_creation")
  })
})

describe("EventBus.Projection — non-occurrence members are observed, never dropped (AC18)", () => {
  test("a definition-mutation member is observed with no occurrence transition", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "ed", type: "job.definition_created", seq: 0 }), null)
    expect(outcome.kind).toBe("observed")
    if (outcome.kind === "observed") expect(outcome.type).toBe("job.definition_created")
  })

  test("a notification member is observed even with no occurrence state", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "en", type: "job.notification_enqueued", seq: 0 }), null)
    expect(outcome.kind).toBe("observed")
  })
})

describe("EventBus.Projection — idempotency keyed on event id (C8, at-least-once)", () => {
  test("a redelivered event id is a duplicate and the ledger is untouched", () => {
    const p = EventBus.createProjector()
    p.classify(record({ id: "e0", type: "job.trigger_due", seq: null }), null)
    const dup = p.classify(record({ id: "e0", type: "job.trigger_due", seq: null }), st("due"))
    expect(dup.kind).toBe("duplicate")
    if (dup.kind === "duplicate") expect(dup.anomaly.kind).toBe("duplicate")
  })

  test("seen() reports whether an event id was already classified", () => {
    const p = EventBus.createProjector()
    expect(p.seen("e0")).toBe(false)
    p.classify(record({ id: "e0", type: "job.trigger_due", seq: null }), null)
    expect(p.seen("e0")).toBe(true)
  })
})

describe("EventBus.Projection — durable ordering keyed on (aggregateID, seq)", () => {
  test("a sequence gap ahead of the high-water mark is out_of_order", () => {
    const p = EventBus.createProjector()
    p.classify(record({ id: "e0", type: "job.occurrence_claimed", seq: 0 }), st("due"))
    const gap = p.classify(record({ id: "e5", type: "job.admitted", seq: 5 }), st("claimed"))
    expect(gap.kind).toBe("out_of_order")
    if (gap.kind === "out_of_order") expect(gap.anomaly.kind).toBe("out_of_order")
  })

  test("a stale sequence at or below the high-water mark is out_of_order", () => {
    const p = EventBus.createProjector()
    p.classify(record({ id: "e0", type: "job.occurrence_claimed", seq: 0 }), st("due"))
    p.classify(record({ id: "e1", type: "job.admitted", seq: 1 }), st("claimed"))
    const stale = p.classify(record({ id: "e1b", type: "job.admitted", seq: 1 }), st("admitted"))
    expect(stale.kind).toBe("out_of_order")
    expect(p.appliedSeq("root_sess_1" as never)).toBe(1)
  })

  test("live members (seq null) never trigger ordering anomalies", () => {
    const p = EventBus.createProjector()
    p.classify(record({ id: "e0", type: "job.trigger_due", seq: null }), null)
    const live = p.classify(record({ id: "eq", type: "job.queued", seq: null }), st("due"))
    expect(live.kind).toBe("observed")
  })

  test("appliedSeq advances on an in-order durable event even when the transition is illegal", () => {
    const p = EventBus.createProjector()
    // job.execution_completed is durable and in-order at seq 0, but illegal from claimed.
    const outcome = p.classify(record({ id: "e0", type: "job.execution_completed", seq: 0 }), st("claimed"))
    expect(outcome.kind).toBe("unreconciled")
    expect(p.appliedSeq("root_sess_1" as never)).toBe(0)
  })
})

describe("EventBus.Projection — state transition delegation (T014)", () => {
  test("a legal transition is applied and carries the new state", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "e1", type: "job.admitted", seq: 0 }), st("claimed"))
    expect(outcome.kind).toBe("applied")
    if (outcome.kind === "applied") {
      expect(outcome.state).toBe("admitted")
      expect(outcome.transition.kind).toBe("transition")
    }
  })

  test("an illegal transition is unreconciled — never a thrown error or invented terminal", () => {
    const p = EventBus.createProjector()
    const outcome = p.classify(record({ id: "eb", type: "job.execution_started", seq: 0 }), st("completed"))
    expect(outcome.kind).toBe("unreconciled")
    if (outcome.kind === "unreconciled") expect(outcome.anomaly.kind).toBe("unreconciled")
  })
})

describe("EventBus.Projection — reset", () => {
  test("reset clears the ledger so a fresh replay starts clean", () => {
    const p = EventBus.createProjector()
    p.classify(record({ id: "e0", type: "job.occurrence_claimed", seq: 0 }), st("due"))
    p.reset()
    expect(p.seen("e0")).toBe(false)
    expect(p.appliedSeq("root_sess_1" as never)).toBe(-1)
  })
})
