import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Notification } from "../../src/jobs/notification"

// Feature 003 / T032 — packages/schema/src/jobs/notification.ts mirrors
// doc/arch/schemas/jobs/notification.cue and notification-parts.cue
// one-to-one (FR22, FR24, FR25, C9, C15, AC7, AC8, AC29). The bounded
// summary + opaque Feature 005 OutputRef boundary never carries full
// content, spool filesystem paths, or unbounded payloads.

const rawNotification = {
  notification_id: "ntf_1",
  routing: {
    event_id: "evt_1",
    occurrence_id: "occ_1",
    job_definition_id: "jdf_1",
    target_root_session_id: "ses_root",
    target_session_id: null,
  },
  descriptor: {
    source: "scheduler",
    type: "occurrence_settled",
    priority: "normal",
    action: "operator_only",
  },
  timing: {
    created_at: 1_721_260_800_000,
    expiry_at: 1_721_261_100_000,
    correlation_id: "corr_1",
    causation_id: null,
  },
  content: {
    summary: "the nightly backup occurrence settled",
    payload_ref: null,
    output_ref: null,
  },
  state: {
    delivery_state: "enqueued",
    ack_state: "unacknowledged",
    safe_boundary: "unsafe",
    delivered_at: null,
    acknowledged_at: null,
  },
}

describe("Notification.NotificationEnvelope", () => {
  test("round-trips a freshly-enqueued operator-only notification", () => {
    const decoded = Schema.decodeUnknownSync(Notification.NotificationEnvelope)(rawNotification)
    expect(Schema.encodeSync(Notification.NotificationEnvelope)(decoded) as unknown).toEqual(rawNotification)
  })

  test("round-trips a delivered-and-acknowledged notification at a safe boundary (FR25, AC7)", () => {
    const delivered = {
      ...rawNotification,
      state: {
        delivery_state: "delivered",
        ack_state: "acknowledged",
        safe_boundary: "safe",
        delivered_at: 1_721_260_850_000,
        acknowledged_at: 1_721_260_860_000,
      },
    }
    const decoded = Schema.decodeUnknownSync(Notification.NotificationEnvelope)(delivered)
    expect(Schema.encodeSync(Notification.NotificationEnvelope)(decoded) as unknown).toEqual(delivered)
  })

  test("round-trips a notification carrying an opaque Feature 005 output_ref only (FR8a, C15)", () => {
    const withOutput = { ...rawNotification, content: { ...rawNotification.content, output_ref: "output_ref_1" } }
    const decoded = Schema.decodeUnknownSync(Notification.NotificationEnvelope)(withOutput)
    expect(Schema.encodeSync(Notification.NotificationEnvelope)(decoded) as unknown).toEqual(withOutput)
  })

  test("round-trips a notification targeted at a specific session in the tree", () => {
    const targeted = {
      ...rawNotification,
      routing: { ...rawNotification.routing, target_session_id: "ses_1" },
    }
    const decoded = Schema.decodeUnknownSync(Notification.NotificationEnvelope)(targeted)
    expect(Schema.encodeSync(Notification.NotificationEnvelope)(decoded) as unknown).toEqual(targeted)
  })

  test("round-trips every explicit non-default DeliveryAction (wake/queue/child are audited, never default, C9)", () => {
    for (const action of ["manager_wake", "input_queue", "child_session"]) {
      const value = { ...rawNotification, descriptor: { ...rawNotification.descriptor, action } }
      const decoded = Schema.decodeUnknownSync(Notification.NotificationEnvelope)(value)
      expect(Schema.encodeSync(Notification.NotificationEnvelope)(decoded) as unknown).toEqual(value)
    }
  })

  test("rejects an out-of-vocabulary notification type", () => {
    expect(() =>
      Schema.decodeUnknownSync(Notification.NotificationEnvelope)({
        ...rawNotification,
        descriptor: { ...rawNotification.descriptor, type: "occurrence_paused" },
      }),
    ).toThrow()
  })

  test("rejects a notification_id without the ntf_ prefix", () => {
    expect(() =>
      Schema.decodeUnknownSync(Notification.NotificationEnvelope)({ ...rawNotification, notification_id: "abc" }),
    ).toThrow()
  })

  test("the content boundary carries only a bounded summary and opaque refs — no unbounded payload field exists", () => {
    const decoded = Schema.decodeUnknownSync(Notification.NotificationContent)(rawNotification.content)
    expect(Object.keys(decoded).sort()).toEqual(["output_ref", "payload_ref", "summary"])
  })
})
