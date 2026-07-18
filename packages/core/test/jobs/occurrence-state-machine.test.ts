import { describe, expect, test } from "bun:test"
import { OccurrenceStateMachine } from "@opencode-ai/core/jobs/occurrence-state-machine"

// Feature 003 / T031 (S18) — the occurrence claim state machine encodes exactly
// the labeled edges of `doc/arch/statecharts/job-occurrence.md` (C6, FR10, FR11):
// pure, total, never throws; illegal edges surface as an observable anomaly and a
// terminal state is never invented or regressed. Mirrors
// `packages/core/test/lifecycle/state-machine.test.ts`.

type State = OccurrenceStateMachine.OccurrenceState
type EventType = OccurrenceStateMachine.JobEventType

const ev = (type: string): EventType => type as EventType

/** Assert `apply(state, event)` is a legal transition to `to`. */
const expectTransition = (state: State, event: string, to: State) => {
  const result = OccurrenceStateMachine.apply(state, ev(event))
  expect(result.kind).toBe("transition")
  if (result.kind === "transition") {
    expect(result.from).toBe(state)
    expect(result.to).toBe(to)
    expect(result.event).toBe(ev(event))
  }
}

/** Assert `apply(state, event)` leaves the state unchanged (legal no-op). */
const expectUnchanged = (state: State, event: string) => {
  const result = OccurrenceStateMachine.apply(state, ev(event))
  expect(result.kind).toBe("unchanged")
  if (result.kind === "unchanged") expect(result.state).toBe(state)
}

/** Assert `apply(state, event)` is rejected as illegal. */
const expectIllegal = (state: State, event: string) => {
  const result = OccurrenceStateMachine.apply(state, ev(event))
  expect(result.kind).toBe("illegal")
  if (result.kind === "illegal") expect(result.from).toBe(state)
}

describe("OccurrenceStateMachine — states", () => {
  test("exposes exactly the fifteen occurrence states (C6)", () => {
    expect(OccurrenceStateMachine.OCCURRENCE_STATES).toHaveLength(15)
    expect([...OccurrenceStateMachine.OCCURRENCE_STATES]).toEqual([
      "due",
      "claimed",
      "admitted",
      "executing",
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "skipped",
      "coalesced",
      "misfired",
      "overlap_rejected",
      "overlap_replaced",
      "reconciled",
      "unknown",
    ])
  })

  test("the ten absorbing terminals are terminal; the five active states are not", () => {
    for (const s of [
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "skipped",
      "coalesced",
      "misfired",
      "overlap_rejected",
      "reconciled",
      "unknown",
    ] as const) {
      expect(OccurrenceStateMachine.isTerminal(s)).toBe(true)
    }
    for (const s of ["due", "claimed", "admitted", "executing", "overlap_replaced"] as const) {
      expect(OccurrenceStateMachine.isTerminal(s)).toBe(false)
    }
  })

  test("TERMINAL_STATES lists exactly the ten absorbing states", () => {
    expect(OccurrenceStateMachine.TERMINAL_STATES).toHaveLength(10)
  })
})

describe("OccurrenceStateMachine — creation", () => {
  test("job.trigger_due yields the initial due state ([*] --> due)", () => {
    const r = OccurrenceStateMachine.create(ev("job.trigger_due"))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.state).toBe("due")
  })

  test("CREATION_EVENT is job.trigger_due", () => {
    expect(OccurrenceStateMachine.CREATION_EVENT).toBe("job.trigger_due")
  })

  test("any non-creation event is not a valid creation", () => {
    expect(OccurrenceStateMachine.create(ev("job.occurrence_claimed")).ok).toBe(false)
    expect(OccurrenceStateMachine.create(ev("job.execution_completed")).ok).toBe(false)
    expect(OccurrenceStateMachine.create(ev("job.admitted")).ok).toBe(false)
  })
})

describe("OccurrenceStateMachine — legal transition table (exactly the statechart edges)", () => {
  test("due edges", () => {
    expectTransition("due", "job.occurrence_claimed", "claimed")
    expectTransition("due", "job.misfired", "misfired")
    expectTransition("due", "job.skipped", "skipped")
    expectTransition("due", "job.coalesced", "coalesced")
  })

  test("claimed edges", () => {
    expectTransition("claimed", "job.admitted", "admitted")
    expectTransition("claimed", "job.overlap_rejected", "overlap_rejected")
    expectTransition("claimed", "job.overlap_replaced", "overlap_replaced")
    expectTransition("claimed", "job.unknown", "unknown")
  })

  test("overlap_replaced routes back to admitted (mutation-safe replace)", () => {
    expectTransition("overlap_replaced", "job.admitted", "admitted")
  })

  test("admitted edges", () => {
    expectTransition("admitted", "job.execution_started", "executing")
    expectTransition("admitted", "job.reconciled", "reconciled")
  })

  test("executing edges (executor terminal outcomes + crash fence)", () => {
    expectTransition("executing", "job.execution_completed", "completed")
    expectTransition("executing", "job.execution_failed", "failed")
    expectTransition("executing", "job.execution_cancelled", "cancelled")
    expectTransition("executing", "job.execution_timed_out", "timed_out")
    expectTransition("executing", "job.unknown", "unknown")
  })
})

describe("OccurrenceStateMachine — illegal transitions are rejected (C6, never invent terminal)", () => {
  test("execution terminals cannot fire before executing", () => {
    expectIllegal("due", "job.execution_completed")
    expectIllegal("claimed", "job.execution_completed")
    expectIllegal("admitted", "job.execution_completed")
    expectIllegal("claimed", "job.execution_started")
  })

  test("claim/admit events cannot fire from the wrong source state", () => {
    expectIllegal("due", "job.admitted")
    expectIllegal("admitted", "job.occurrence_claimed")
    expectIllegal("executing", "job.admitted")
    expectIllegal("due", "job.execution_started")
  })

  test("job.reconciled is a real edge only from admitted (statechart)", () => {
    expectTransition("admitted", "job.reconciled", "reconciled")
    expectIllegal("due", "job.reconciled")
    expectIllegal("claimed", "job.reconciled")
    expectIllegal("executing", "job.reconciled")
  })

  test("job.unknown fences only claimed and executing (statechart)", () => {
    expectTransition("claimed", "job.unknown", "unknown")
    expectTransition("executing", "job.unknown", "unknown")
    expectIllegal("due", "job.unknown")
    expectIllegal("admitted", "job.unknown")
    expectIllegal("overlap_replaced", "job.unknown")
  })

  test("overlap outcomes cannot fire outside claimed", () => {
    expectIllegal("due", "job.overlap_rejected")
    expectIllegal("admitted", "job.overlap_replaced")
    expectIllegal("executing", "job.overlap_rejected")
  })
})

describe("OccurrenceStateMachine — absorbing terminals", () => {
  test("a terminal state rejects any foreign transition event", () => {
    expectIllegal("completed", "job.execution_failed")
    expectIllegal("completed", "job.execution_started")
    expectIllegal("failed", "job.execution_completed")
    expectIllegal("misfired", "job.occurrence_claimed")
    expectIllegal("overlap_rejected", "job.admitted")
    expectIllegal("reconciled", "job.execution_started")
  })

  test("an idempotent redelivery of the terminal's own event is a no-op (at-least-once, C6)", () => {
    expectUnchanged("completed", "job.execution_completed")
    expectUnchanged("failed", "job.execution_failed")
    expectUnchanged("cancelled", "job.execution_cancelled")
    expectUnchanged("timed_out", "job.execution_timed_out")
    expectUnchanged("misfired", "job.misfired")
    expectUnchanged("skipped", "job.skipped")
    expectUnchanged("coalesced", "job.coalesced")
    expectUnchanged("overlap_rejected", "job.overlap_rejected")
    expectUnchanged("reconciled", "job.reconciled")
    expectUnchanged("unknown", "job.unknown")
  })
})

describe("OccurrenceStateMachine — idempotent self-target transition events (C6, at-least-once)", () => {
  test("a transition event whose target is already current is a no-op", () => {
    expectUnchanged("claimed", "job.occurrence_claimed")
    expectUnchanged("admitted", "job.admitted")
    expectUnchanged("executing", "job.execution_started")
    expectUnchanged("overlap_replaced", "job.overlap_replaced")
  })

  test("job.admitted redelivered against admitted (reachable from claimed and overlap_replaced) is a no-op", () => {
    expectUnchanged("admitted", "job.admitted")
  })
})

describe("OccurrenceStateMachine — totality (never throws over the full vocabulary)", () => {
  test("apply resolves every (state, event) pair to one of three kinds", () => {
    const eventTypes = [
      "job.definition_created",
      "job.definition_updated",
      "job.definition_enabled",
      "job.definition_disabled",
      "job.definition_deleted",
      "job.registered",
      "job.unregistered",
      "job.rescheduled",
      "job.trigger_due",
      "job.occurrence_claimed",
      "job.triggered",
      "job.misfired",
      "job.skipped",
      "job.coalesced",
      "job.queued",
      "job.admitted",
      "job.notification_enqueued",
      "job.notification_delivered",
      "job.notification_acknowledged",
      "job.notification_expired",
      "job.execution_started",
      "job.execution_completed",
      "job.execution_failed",
      "job.execution_cancelled",
      "job.execution_timed_out",
      "job.retry_scheduled",
      "job.overlap_rejected",
      "job.overlap_replaced",
      "job.reconciled",
      "job.unknown",
    ] as const
    for (const state of OccurrenceStateMachine.OCCURRENCE_STATES) {
      for (const type of eventTypes) {
        const result = OccurrenceStateMachine.apply(state, ev(type))
        expect(["transition", "unchanged", "illegal"]).toContain(result.kind)
      }
    }
  })

  test("events outside the occurrence sub-vocabulary are illegal from an active state", () => {
    expectIllegal("due", "job.definition_created")
    expectIllegal("claimed", "job.notification_delivered")
    expectIllegal("executing", "job.registered")
  })
})

describe("OccurrenceStateMachine.resolveDuplicate — one execution per idempotency tuple (FR10, AC6)", () => {
  test("a first delivery with no prior occurrence is the primary", () => {
    const decision = OccurrenceStateMachine.resolveDuplicate({
      incomingOccurrenceId: "occ_1",
      existingOccurrenceId: null,
    })
    expect(decision.kind).toBe("primary")
  })

  test("a redelivery of the same occurrence id stays the primary (idempotent)", () => {
    const decision = OccurrenceStateMachine.resolveDuplicate({
      incomingOccurrenceId: "occ_1",
      existingOccurrenceId: "occ_1",
    })
    expect(decision.kind).toBe("primary")
  })

  test("a distinct prior occurrence makes this delivery a duplicate with an observable duplicate_of", () => {
    const decision = OccurrenceStateMachine.resolveDuplicate({
      incomingOccurrenceId: "occ_2",
      existingOccurrenceId: "occ_1",
    })
    expect(decision.kind).toBe("duplicate")
    if (decision.kind === "duplicate") expect(decision.duplicate_of).toBe("occ_1")
  })

  test("never opens a second admitted path — a duplicate always points back to the primary", () => {
    const decision = OccurrenceStateMachine.resolveDuplicate({
      incomingOccurrenceId: "occ_late",
      existingOccurrenceId: "occ_first",
    })
    expect(decision.kind === "duplicate" && decision.duplicate_of).toBe("occ_first")
  })
})
