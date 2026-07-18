// DDD role: ValueObject
// Package: jobs.notification
// NotificationEnvelope — the bounded, redacted async notification carried over the
// single EventV2 authority and the Feature 002 observation seam; no second channel
// (FR20, FR22, C8). It is a ValueObject: notification_id is held as a value. It
// carries only a bounded summary and an opaque Feature 005 OutputRef, never full
// content, spool paths or unbounded payloads (FR22, C15, AC29). Parts live in
// notification-parts.cue.

package jobs.notification

import "jobs/ids"

// NotificationEnvelope is the bounded async notification for the main context (FR22, C15).
#NotificationEnvelope: {
	// Notification identity carried as a value (FR22).
	notification_id: ids.#NotificationId

	// Event/occurrence/definition ids and target root/session (FR21, FR22).
	routing: #NotificationRouting

	// Source, type, priority and delivery action (FR22, FR24, C9).
	descriptor: #NotificationDescriptor

	// Created/expiry timestamps and correlation/causation (FR22).
	timing: #NotificationTiming

	// Bounded summary, redacted payload ref and opaque OutputRef (FR22, C15).
	content: #NotificationContent

	// Delivery state, ack state, safe boundary and delivery/ack timestamps (FR25, C9).
	state: #NotificationState
}
