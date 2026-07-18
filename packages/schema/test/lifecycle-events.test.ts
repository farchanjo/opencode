import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Events } from "../src/lifecycle/events"
import { EventsDurable } from "../src/lifecycle/events-durable"
import { EventsLive } from "../src/lifecycle/events-live"

// The 26-member closed tagged union with the durable/live split (FR20, FR21).

const envelope = {
  event_id: "evt_abc123",
  kind: {
    event_type: "lifecycle.started",
    schema_version: 1,
    event_class: "durable",
    agent_kind: "worker",
    actor_kind: "runtime",
    runtime_instance_id: "rt_1",
  },
  tree: { root_session_id: "ses_root", session_id: "ses_1", parent_session_id: null },
  process: { task_id: "task_1", process_id: "proc_1", parent_process_id: null, root_process_id: "proc_root" },
  ordering: { sequence: 0, correlation_id: "corr_1", causation_id: null, attempt: 1, generation: 0 },
  delivery: { visibility: "session", timestamp: 1_721_260_800_000, redacted_metadata: {} },
  hierarchy: null,
}

const liveUsage = {
  available: true,
  tokens: { input: 10, output: 5 },
  cost_usd: 0.01,
  provenance: { provenance: "reported", source: "provider" },
  elapsed_ms: 1000,
  tokens_per_second: 5,
}

const bare = (type: string) => ({ type, envelope })
const withDetail = (type: string, detail: unknown) => ({ type, envelope, detail })

const admissionDetail = { scope: "session", decision: "granted", fanout: { requested: 2, granted: 1 } }
const handoffDetail = {
  source: { session_id: "ses_1", process_id: "proc_1" },
  target: { session_id: "ses_2", process_id: "proc_2" },
  reason: "single-owner transfer",
  generation: 1,
}
const terminalDetail = (reason: string) => ({ reason, settlement: "settled", final_usage: liveUsage })
const watchdogDetail = { outcome: "owner_lost", lease_id: "lease_1", reason: "lease expired" }
const toolDetail = { activity: "read", label: "reading config" }
const steerDetail = { outcome: "requested", reason: "operator steer" }
const reconcileDetail = { outcome: "reconciled", from_version: 1 }

// One sample per FR20 vocabulary member — the full closed set of 26.
const durableEvents = [
  withDetail("lifecycle.admitted", admissionDetail),
  bare("lifecycle.parent_attached"),
  bare("lifecycle.process_created"),
  bare("lifecycle.started"),
  withDetail("lifecycle.handoff", handoffDetail),
  withDetail("lifecycle.reconciled", reconcileDetail),
  withDetail("lifecycle.completed", terminalDetail("completed_ok")),
  withDetail("lifecycle.failed", terminalDetail("error")),
  withDetail("lifecycle.cancelled", terminalDetail("cancelled_by_root")),
  withDetail("lifecycle.zombie_detected", watchdogDetail),
  withDetail("lifecycle.owner_lost", watchdogDetail),
]

const liveEvents = [
  bare("lifecycle.queued"),
  bare("lifecycle.waiting"),
  bare("lifecycle.promoted"),
  bare("lifecycle.extended"),
  bare("lifecycle.turn_started"),
  bare("lifecycle.turn_ended"),
  bare("lifecycle.turn_failed"),
  bare("lifecycle.unknown"),
  withDetail("lifecycle.steer_requested", steerDetail),
  withDetail("lifecycle.steer_accepted", steerDetail),
  withDetail("lifecycle.steer_rejected", steerDetail),
  withDetail("lifecycle.cancel_requested", steerDetail),
  withDetail("lifecycle.cancelling", steerDetail),
  withDetail("lifecycle.tool_called", toolDetail),
  withDetail("lifecycle.tool_settled", toolDetail),
]

const allEvents = [...durableEvents, ...liveEvents]

describe("Events.LifecycleEvent", () => {
  test("decodes every one of the 26 closed-union members", () => {
    expect(allEvents.length).toBe(26)
    for (const value of allEvents) {
      expect(Schema.decodeUnknownSync(Events.LifecycleEvent)(value)).toBeDefined()
    }
  })

  test("round-trips a durable terminal and a live tool event", () => {
    for (const value of [durableEvents[6], liveEvents[13]]) {
      const decoded = Schema.decodeUnknownSync(Events.LifecycleEvent)(value)
      expect(Schema.encodeSync(Events.LifecycleEvent)(decoded) as unknown).toEqual(value)
    }
  })

  test("rejects an unknown type discriminant", () => {
    expect(() => Schema.decodeUnknownSync(Events.LifecycleEvent)(bare("lifecycle.paused"))).toThrow()
  })

  test("rejects a missing type discriminant", () => {
    expect(() => Schema.decodeUnknownSync(Events.LifecycleEvent)({ envelope })).toThrow()
  })

  test("rejects a member missing its required detail", () => {
    expect(() => Schema.decodeUnknownSync(Events.LifecycleEvent)(bare("lifecycle.admitted"))).toThrow()
  })

  test("rejects an out-of-vocabulary detail enum", () => {
    expect(() =>
      Schema.decodeUnknownSync(Events.LifecycleEvent)(
        withDetail("lifecycle.admitted", { ...admissionDetail, decision: "deferred" }),
      ),
    ).toThrow()
  })

  test("keeps extend, promote, steer and handoff distinct members", () => {
    for (const type of ["lifecycle.extended", "lifecycle.promoted", "lifecycle.steer_requested", "lifecycle.handoff"]) {
      const match = allEvents.filter((event) => event.type === type)
      expect(match.length).toBe(1)
    }
  })
})

describe("durable/live split", () => {
  test("declares eleven durable and fifteen live members", () => {
    expect(EventsDurable.DurableMembers.length).toBe(11)
    expect(EventsLive.LiveMembers.length).toBe(15)
    expect(EventsDurable.DurableMembers.length + EventsLive.LiveMembers.length).toBe(26)
  })

  test("assigns each split sample to its own member schema", () => {
    const decodesUnder = (member: Schema.Top, value: unknown) => {
      try {
        Schema.decodeUnknownSync(member as unknown as Schema.Codec<unknown, unknown>)(value)
        return true
      } catch {
        return false
      }
    }
    for (const value of durableEvents) {
      expect(EventsDurable.DurableMembers.some((member) => decodesUnder(member, value))).toBe(true)
    }
    for (const value of liveEvents) {
      expect(EventsLive.LiveMembers.some((member) => decodesUnder(member, value))).toBe(true)
    }
  })
})
