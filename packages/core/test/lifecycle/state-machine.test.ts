import { describe, expect, test } from "bun:test"
import { StateMachine } from "@opencode-ai/core/lifecycle/state-machine"
import { EventBus } from "@opencode-ai/core/lifecycle/event-bus"

type State = StateMachine.ProcessState
type EventType = StateMachine.LifecycleEventType

const ev = (type: string): EventType => type as EventType

/** Assert `apply(state, event)` is a legal transition to `to`. */
const expectTransition = (state: State, event: string, to: State) => {
  const result = StateMachine.apply(state, ev(event))
  expect(result.kind).toBe("transition")
  if (result.kind === "transition") {
    expect(result.from).toBe(state)
    expect(result.to).toBe(to)
    expect(result.event).toBe(ev(event))
  }
}

/** Assert `apply(state, event)` leaves the state unchanged (legal no-op). */
const expectUnchanged = (state: State, event: string) => {
  const result = StateMachine.apply(state, ev(event))
  expect(result.kind).toBe("unchanged")
  if (result.kind === "unchanged") expect(result.state).toBe(state)
}

/** Assert `apply(state, event)` is rejected as illegal. */
const expectIllegal = (state: State, event: string) => {
  const result = StateMachine.apply(state, ev(event))
  expect(result.kind).toBe("illegal")
  if (result.kind === "illegal") expect(result.from).toBe(state)
}

describe("StateMachine — states", () => {
  test("exposes exactly the ten Process Table states (C7, FR25)", () => {
    expect(StateMachine.PROCESS_STATES).toHaveLength(10)
    expect([...StateMachine.PROCESS_STATES]).toEqual([
      "created",
      "queued",
      "waiting",
      "running",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
      "zombie",
      "unknown",
    ])
  })

  test("the five absorbing terminals are terminal; the rest are not", () => {
    for (const s of ["completed", "failed", "cancelled", "zombie", "unknown"] as const) {
      expect(StateMachine.isTerminal(s)).toBe(true)
    }
    for (const s of ["created", "queued", "waiting", "running", "cancelling"] as const) {
      expect(StateMachine.isTerminal(s)).toBe(false)
    }
  })
})

describe("StateMachine — creation", () => {
  test("process_created yields the initial created state", () => {
    const r = StateMachine.create(ev("lifecycle.process_created"))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.state).toBe("created")
  })

  test("any non-creation event is not a valid creation", () => {
    expect(StateMachine.create(ev("lifecycle.started")).ok).toBe(false)
    expect(StateMachine.create(ev("lifecycle.completed")).ok).toBe(false)
  })

  test("a duplicate process_created against an existing state is illegal", () => {
    expectIllegal("created", "lifecycle.process_created")
    expectIllegal("running", "lifecycle.process_created")
  })
})

describe("StateMachine — legal transition table (exactly the statechart edges)", () => {
  test("created edges", () => {
    expectTransition("created", "lifecycle.admitted", "queued")
    expectTransition("created", "lifecycle.zombie_detected", "zombie")
    expectTransition("created", "lifecycle.owner_lost", "unknown")
  })

  test("queued edges", () => {
    expectTransition("queued", "lifecycle.started", "running")
    expectTransition("queued", "lifecycle.waiting", "waiting")
    expectTransition("queued", "lifecycle.cancel_requested", "cancelling")
    expectTransition("queued", "lifecycle.zombie_detected", "zombie")
    expectTransition("queued", "lifecycle.owner_lost", "unknown")
  })

  test("waiting edges", () => {
    expectTransition("waiting", "lifecycle.promoted", "running")
    expectTransition("waiting", "lifecycle.cancel_requested", "cancelling")
    expectTransition("waiting", "lifecycle.zombie_detected", "zombie")
    expectTransition("waiting", "lifecycle.owner_lost", "unknown")
  })

  test("running edges (incl. running <-> waiting oscillation)", () => {
    expectTransition("running", "lifecycle.waiting", "waiting")
    expectTransition("running", "lifecycle.completed", "completed")
    expectTransition("running", "lifecycle.failed", "failed")
    expectTransition("running", "lifecycle.cancel_requested", "cancelling")
    expectTransition("running", "lifecycle.zombie_detected", "zombie")
    expectTransition("running", "lifecycle.owner_lost", "unknown")
  })

  test("cancelling funnel + universal watchdog fences (statechart Notes, C7)", () => {
    expectTransition("cancelling", "lifecycle.cancelled", "cancelled")
    expectTransition("cancelling", "lifecycle.failed", "failed")
    expectTransition("cancelling", "lifecycle.unknown", "unknown")
    expectTransition("cancelling", "lifecycle.zombie_detected", "zombie")
    expectTransition("cancelling", "lifecycle.owner_lost", "unknown")
  })

  test("every non-terminal state can be fenced to zombie/unknown (C7, C12)", () => {
    for (const s of ["created", "queued", "waiting", "running", "cancelling"] as const) {
      expectTransition(s, "lifecycle.zombie_detected", "zombie")
      expectTransition(s, "lifecycle.owner_lost", "unknown")
    }
  })
})

describe("StateMachine — illegal transitions are rejected (FR25, C7)", () => {
  test("terminal-only events cannot fire from the wrong state", () => {
    expectIllegal("created", "lifecycle.completed")
    expectIllegal("created", "lifecycle.started")
    expectIllegal("queued", "lifecycle.completed")
    expectIllegal("running", "lifecycle.admitted")
    expectIllegal("waiting", "lifecycle.admitted")
    expectIllegal("created", "lifecycle.cancelled")
  })

  test("the unknown event only fences a cancelling row (per the mermaid)", () => {
    expectTransition("cancelling", "lifecycle.unknown", "unknown")
    expectIllegal("created", "lifecycle.unknown")
    expectIllegal("queued", "lifecycle.unknown")
    expectIllegal("running", "lifecycle.unknown")
  })
})

describe("StateMachine — absorbing terminals", () => {
  test("a terminal state rejects any foreign transition event", () => {
    expectIllegal("completed", "lifecycle.failed")
    expectIllegal("completed", "lifecycle.started")
    expectIllegal("failed", "lifecycle.completed")
    expectIllegal("cancelled", "lifecycle.completed")
    expectIllegal("zombie", "lifecycle.started")
  })

  test("an idempotent redelivery of the terminal's own event is a no-op (C9)", () => {
    expectUnchanged("completed", "lifecycle.completed")
    expectUnchanged("failed", "lifecycle.failed")
    expectUnchanged("cancelled", "lifecycle.cancelled")
    expectUnchanged("zombie", "lifecycle.zombie_detected")
    expectUnchanged("unknown", "lifecycle.owner_lost")
    expectUnchanged("unknown", "lifecycle.unknown")
  })

  test("in-state observation events are illegal once absorbed", () => {
    expectIllegal("completed", "lifecycle.turn_started")
    expectIllegal("completed", "lifecycle.handoff")
    expectIllegal("cancelled", "lifecycle.tool_called")
  })
})

describe("StateMachine — reconciled is a pure audit event, never a transition (C13, FR29)", () => {
  test("reconciled leaves any state unchanged", () => {
    for (const s of StateMachine.PROCESS_STATES) {
      expectUnchanged(s, "lifecycle.reconciled")
    }
  })
})

describe("StateMachine — in-state observation events do not change state", () => {
  test("progress / lineage / control-outcome / tool-boundary events are no-ops", () => {
    expectUnchanged("running", "lifecycle.turn_started")
    expectUnchanged("running", "lifecycle.turn_ended")
    expectUnchanged("running", "lifecycle.turn_failed")
    expectUnchanged("running", "lifecycle.tool_called")
    expectUnchanged("running", "lifecycle.tool_settled")
    expectUnchanged("running", "lifecycle.steer_requested")
    expectUnchanged("running", "lifecycle.steer_accepted")
    expectUnchanged("running", "lifecycle.steer_rejected")
    expectUnchanged("running", "lifecycle.extended")
    expectUnchanged("queued", "lifecycle.parent_attached")
    expectUnchanged("queued", "lifecycle.queued")
    expectUnchanged("cancelling", "lifecycle.cancelling")
  })

  test("handoff is projected onto the current state without altering it (C16)", () => {
    expectUnchanged("running", "lifecycle.handoff")
    expectUnchanged("waiting", "lifecycle.handoff")
  })
})

describe("StateMachine — idempotent self-target transition events (C9, at-least-once)", () => {
  test("a transition event whose target is already current is a no-op", () => {
    expectUnchanged("waiting", "lifecycle.waiting")
    expectUnchanged("running", "lifecycle.started")
    expectUnchanged("running", "lifecycle.promoted")
    expectUnchanged("queued", "lifecycle.admitted")
    expectUnchanged("cancelling", "lifecycle.cancel_requested")
  })
})

describe("StateMachine — totality (never throws over the full vocabulary)", () => {
  test("apply resolves every (state, event) pair to one of three kinds", () => {
    for (const state of StateMachine.PROCESS_STATES) {
      for (const type of EventBus.LifecycleEventTypes) {
        const result = StateMachine.apply(state, ev(type))
        expect(["transition", "unchanged", "illegal"]).toContain(result.kind)
      }
    }
  })
})
