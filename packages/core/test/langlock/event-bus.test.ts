import { describe, expect, test } from "bun:test"
import { EventBus } from "@opencode-ai/core/langlock/event-bus"

// Feature 004 / T037 (S20) — the langlock.* idempotent projector and the
// durable-versus-live split (FR27, C8, AC14). The projector is pure and total:
// it classifies each record into exactly one outcome, keyed on event id plus the
// durable `(correlation_id, seq)` pair, and never throws or invents state. Audit
// and advisory events are never coalesced or dropped.

const rec = (overrides: Partial<EventBus.LangLockEventRecord> = {}): EventBus.LangLockEventRecord => ({
  id: "evt_1",
  type: "langlock.policy_set",
  correlation_id: "corr_1",
  seq: 0,
  ...overrides,
})

describe("EventBus — durable-versus-live split (C8)", () => {
  test("exactly six durable audit members and nine live members", () => {
    expect(EventBus.DurableDefinitions.length).toBe(6)
    expect(EventBus.LiveDefinitions.length).toBe(9)
    expect(EventBus.Definitions.length).toBe(15)
  })

  test("the six durable audit member types are the audit vocabulary", () => {
    expect([...EventBus.DURABLE_LANGLOCK_EVENT_TYPES].sort()).toEqual(
      [
        "langlock.exception_registered",
        "langlock.exception_revoked",
        "langlock.override_authorized",
        "langlock.override_denied",
        "langlock.policy_reset",
        "langlock.policy_set",
      ].sort(),
    )
  })

  test("isDurableEvent / isLangLockEvent classify by type", () => {
    expect(EventBus.isDurableEvent({ type: "langlock.policy_set" } as never)).toBe(true)
    expect(EventBus.isDurableEvent({ type: "langlock.advisory_flagged" } as never)).toBe(false)
    expect(EventBus.isLangLockEvent({ type: "langlock.advisory_flagged" } as never)).toBe(true)
    expect(EventBus.isLangLockEvent({ type: "job.trigger_due" } as never)).toBe(false)
  })

  test("no member is classified as both durable and live", () => {
    const durable = new Set(EventBus.DurableDefinitions.map((d) => d.type))
    for (const d of EventBus.LiveDefinitions) expect(durable.has(d.type)).toBe(false)
  })
})

describe("EventBus.createProjector — idempotent durable projection (AC14)", () => {
  test("applies an in-order durable audit member and advances the aggregate sequence", () => {
    const projector = EventBus.createProjector()
    expect(projector.classify(rec({ id: "evt_1", seq: 0 })).kind).toBe("applied")
    expect(projector.classify(rec({ id: "evt_2", seq: 1 })).kind).toBe("applied")
    expect(projector.appliedSeq("corr_1")).toBe(1)
  })

  test("a redelivered event id is a duplicate — never re-applied (C8)", () => {
    const projector = EventBus.createProjector()
    projector.classify(rec({ id: "evt_1", seq: 0 }))
    expect(projector.classify(rec({ id: "evt_1", seq: 0 })).kind).toBe("duplicate")
  })

  test("a sequence gap or regression is out_of_order (never thrown)", () => {
    const projector = EventBus.createProjector()
    projector.classify(rec({ id: "evt_1", seq: 0 }))
    expect(projector.classify(rec({ id: "evt_2", seq: 2 })).kind).toBe("out_of_order")
    expect(projector.classify(rec({ id: "evt_3", seq: 0 })).kind).toBe("out_of_order")
  })

  test("a live member (seq null) is always an accepted observation, never dropped", () => {
    const projector = EventBus.createProjector()
    const outcome = projector.classify(rec({ id: "evt_live", type: "langlock.advisory_flagged", seq: null }))
    expect(outcome.kind).toBe("observed")
    expect(projector.appliedSeq("corr_1")).toBe(-1)
  })

  test("reset clears the ledger for a fresh replay", () => {
    const projector = EventBus.createProjector()
    projector.classify(rec({ id: "evt_1", seq: 0 }))
    projector.reset()
    expect(projector.seen("evt_1")).toBe(false)
    expect(projector.classify(rec({ id: "evt_1", seq: 0 })).kind).toBe("applied")
  })
})
