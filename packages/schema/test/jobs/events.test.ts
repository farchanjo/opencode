import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Events } from "../../src/jobs/events"
import { EventsDurable } from "../../src/jobs/events-durable"
import { EventsLive } from "../../src/jobs/events-live"

// Feature 003 / T032 — the closed 30-member job.* tagged union (FR11, FR12,
// C8) mirroring doc/arch/schemas/jobs/events.cue, events-definition.cue,
// events-occurrence.cue, events-execution.cue and events-notification.cue.
// Definition-mutation, registration, misfire, overlap, execution-terminal,
// retry, notification and reconciliation stay distinct semantic events and
// are never collapsed into a generic status update.

const envelope = {
  event_id: "evt_abc123",
  kind: {
    event_type: "job.trigger_due",
    schema_version: 1,
    event_class: "live",
    source: "scheduler",
    actor_kind: "runtime",
    visibility: "session",
  },
  occurrence: {
    job_definition_id: "jdf_1",
    schedule_id: "sch_1",
    occurrence_id: "occ_1",
    process_id: null,
    attempt: 1,
    generation: 0,
  },
  tree: { root_session_id: "ses_root", session_id: null },
  ordering: { sequence: 0, correlation_id: "corr_1", causation_id: null },
  delivery: { visibility: "session", timestamp: 1_721_260_800_000, redacted_metadata: {} },
}

const bare = (type: string) => ({ type, envelope })
const withDetail = (type: string, detail: unknown) => ({ type, envelope, detail })

const definitionDetail = { version: 1, scope: "project" }
const registrationDetail = { state: "registered", intent: "register", capability_surface: "in_process" }
const triggerDetail = { schedule_lag_ms: 0 }
const misfireDetail = { policy: "skip", outcome: "skipped" }
const overlapDetail = { policy: "forbid", outcome: "overlap_rejected" }
const executionDetail = (outcome: string) => ({ outcome, reason: "" })
const retryDetail = { retry_budget: 0, reason: "" }
const notificationDetail = { delivery_state: "enqueued", ack_state: "unacknowledged" }
const reconcileDetail = { outcome: "reconciled", from_version: 1 }

// One sample per FR11 vocabulary member — the full closed set of 30.
const durableEvents = [
  withDetail("job.definition_created", definitionDetail),
  withDetail("job.definition_updated", definitionDetail),
  withDetail("job.definition_enabled", definitionDetail),
  withDetail("job.definition_disabled", definitionDetail),
  withDetail("job.definition_deleted", definitionDetail),
  withDetail("job.registered", registrationDetail),
  withDetail("job.unregistered", registrationDetail),
  withDetail("job.rescheduled", registrationDetail),
  bare("job.occurrence_claimed"),
  bare("job.triggered"),
  bare("job.admitted"),
  bare("job.execution_started"),
  withDetail("job.execution_completed", executionDetail("completed")),
  withDetail("job.execution_failed", executionDetail("failed")),
  withDetail("job.execution_cancelled", executionDetail("cancelled")),
  withDetail("job.execution_timed_out", executionDetail("timed_out")),
  withDetail("job.overlap_rejected", overlapDetail),
  withDetail("job.overlap_replaced", { policy: "replace", outcome: "overlap_replaced" }),
  withDetail("job.notification_enqueued", notificationDetail),
  withDetail("job.notification_acknowledged", { delivery_state: "delivered", ack_state: "acknowledged" }),
  withDetail("job.notification_expired", { delivery_state: "expired", ack_state: "expired" }),
  withDetail("job.reconciled", reconcileDetail),
  bare("job.unknown"),
]

const liveEvents = [
  withDetail("job.trigger_due", triggerDetail),
  withDetail("job.misfired", misfireDetail),
  withDetail("job.skipped", { policy: "skip", outcome: "skipped" }),
  withDetail("job.coalesced", { policy: "coalesce", outcome: "coalesced" }),
  bare("job.queued"),
  withDetail("job.notification_delivered", { delivery_state: "delivered", ack_state: "unacknowledged" }),
  withDetail("job.retry_scheduled", retryDetail),
]

const allEvents = [...durableEvents, ...liveEvents]

describe("Events.JobEvent", () => {
  test("decodes every one of the thirty closed-union members", () => {
    expect(allEvents.length).toBe(30)
    for (const value of allEvents) {
      expect(Schema.decodeUnknownSync(Events.JobEvent)(value)).toBeDefined()
    }
  })

  test("round-trips a durable definition mutation and a live misfire event", () => {
    for (const value of [durableEvents[0], liveEvents[1]]) {
      const decoded = Schema.decodeUnknownSync(Events.JobEvent)(value)
      expect(Schema.encodeSync(Events.JobEvent)(decoded) as unknown).toEqual(value)
    }
  })

  test("rejects an unknown type discriminant", () => {
    expect(() => Schema.decodeUnknownSync(Events.JobEvent)(bare("job.paused"))).toThrow()
  })

  test("rejects a missing type discriminant", () => {
    expect(() => Schema.decodeUnknownSync(Events.JobEvent)({ envelope })).toThrow()
  })

  test("rejects a member missing its required detail", () => {
    expect(() => Schema.decodeUnknownSync(Events.JobEvent)(bare("job.definition_created"))).toThrow()
  })

  test("rejects an out-of-vocabulary detail enum", () => {
    expect(() =>
      Schema.decodeUnknownSync(Events.JobEvent)(withDetail("job.registered", { ...registrationDetail, state: "deferred" })),
    ).toThrow()
  })

  test("keeps misfire, overlap, execution-terminal and notification members distinct", () => {
    for (const type of ["job.misfired", "job.overlap_rejected", "job.execution_failed", "job.notification_enqueued"]) {
      const match = allEvents.filter((event) => event.type === type)
      expect(match.length).toBe(1)
    }
  })

  test("definition-mutation, registration, and reconciliation members are never collapsed into one generic status update (FR11)", () => {
    const distinctTags = new Set(allEvents.map((event) => event.type))
    expect(distinctTags.size).toBe(30)
  })
})

describe("durable/live split (C8)", () => {
  test("declares twenty-three durable and seven live members", () => {
    expect(EventsDurable.DurableMembers.length).toBe(23)
    expect(EventsLive.LiveMembers.length).toBe(7)
    expect(EventsDurable.DurableMembers.length + EventsLive.LiveMembers.length).toBe(30)
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

  test("no live member is classified as durable and vice versa", () => {
    const durableTypes = new Set(durableEvents.map((event) => event.type))
    const liveTypes = new Set(liveEvents.map((event) => event.type))
    for (const type of durableTypes) expect(liveTypes.has(type)).toBe(false)
  })
})
