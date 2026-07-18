// DDD role: ValueObject
// Package: jobs.events
// Notification-lifecycle event members (FR22, C8, C9). Enqueue, delivery,
// acknowledgement and expiry are Feature 003 concerns projected on the single
// EventV2 authority and delivered over the authorized bounded observation seam
// segmented by root/session/project; no second channel (FR20, C8).

package jobs.events

import "jobs/envelope"

// notification_enqueued — a bounded, redacted notification was enqueued (FR22, C9).
#JobNotificationEnqueuedEvent: {
	type:     "job.notification_enqueued"
	envelope: envelope.#JobEnvelope
	detail:   #NotificationDetail
}

// notification_delivered — the notification was delivered at a safe boundary (FR25, AC7).
#JobNotificationDeliveredEvent: {
	type:     "job.notification_delivered"
	envelope: envelope.#JobEnvelope
	detail:   #NotificationDetail
}

// notification_acknowledged — a delivered notification was acknowledged (FR22).
#JobNotificationAcknowledgedEvent: {
	type:     "job.notification_acknowledged"
	envelope: envelope.#JobEnvelope
	detail:   #NotificationDetail
}

// notification_expired — a notification reached TTL with no unbounded queue growth (FR25, AC8).
#JobNotificationExpiredEvent: {
	type:     "job.notification_expired"
	envelope: envelope.#JobEnvelope
	detail:   #NotificationDetail
}
