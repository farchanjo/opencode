// DDD role: ValueObject
// Package: jobs.notification
// Cohesive sub-objects composed by the NotificationEnvelope (FR22). Cross-session
// and cross-project leakage is rejected before delivery; only a bounded summary
// and opaque OutputRef cross the boundary (FR21, FR22, C10, C15, AC9, AC29).

package jobs.notification

import (
	"jobs/ids"
	"jobs/enums"
)

// NotificationRouting carries event/occurrence/definition ids and the authorized target scope (FR21, FR22).
#NotificationRouting: {
	event_id:               ids.#EventId
	occurrence_id:          ids.#OccurrenceId
	job_definition_id:      ids.#JobDefinitionId
	target_root_session_id: ids.#RootSessionId
	target_session_id:      ids.#SessionId | null
}

// NotificationDescriptor carries source, type, priority and the default delivery action (FR22, FR24, C9).
#NotificationDescriptor: {
	source:   enums.#NotificationSource
	type:     enums.#NotificationType
	priority: enums.#NotificationPriority
	action:   enums.#DeliveryAction
}

// NotificationTiming carries created/expiry timestamps and correlation/causation (FR22).
#NotificationTiming: {
	created_at:     ids.#Timestamp
	expiry_at:      ids.#Timestamp
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
}

// NotificationContent carries a bounded summary, redacted payload ref and opaque OutputRef only (FR22, C15).
#NotificationContent: {
	summary:     ids.#BoundedSummary
	payload_ref: ids.#PayloadRef | null
	output_ref:  ids.#OutputRef | null
}

// NotificationState carries delivery/ack state, the safe-boundary flag and delivery/ack timestamps (FR25, C9).
#NotificationState: {
	delivery_state:  enums.#DeliveryState
	ack_state:       enums.#AckState
	safe_boundary:   enums.#SafeBoundary
	delivered_at:    ids.#Timestamp | null
	acknowledged_at: ids.#Timestamp | null
}
