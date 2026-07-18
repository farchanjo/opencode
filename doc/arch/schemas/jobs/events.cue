// DDD role: ValueObject
// Package: jobs.events
// JobEvent — the closed tagged union of the 30 job.* event members (FR11), plus
// the cohesive detail sub-objects distinct members carry. Mirroring Feature 001/002,
// each member is registered as its own EventV2.define Definition on the EventV2Bridge
// via publishJobEvent; no raw union is wired to the bus (C8). Durable members carry the
// EventV2 durable {version, aggregate} annotation and replay through readAggregate;
// live members omit it (C8). Members live in events-definition.cue, events-occurrence.cue,
// events-execution.cue and events-notification.cue.

package jobs.events

import (
	"jobs/ids"
	"jobs/enums"
)

// DefinitionDetail carries the definition CAS version and scope for a mutation event (FR2, C12).
#DefinitionDetail: {
	version: ids.#Version
	scope:   enums.#Scope
}

// RegistrationDetail carries registration state, intent and capability surface (FR6, C5).
#RegistrationDetail: {
	state:              enums.#RegistrationState
	intent:             enums.#RegistrationIntent
	capability_surface: enums.#CapabilitySurface
}

// TriggerDetail carries schedule lag measured from nominal due time (FR19, AC3, AC4).
#TriggerDetail: {
	schedule_lag_ms: ids.#ScheduleLagMs
}

// MisfireDetail carries the applied misfire policy and its resulting outcome (FR15, C19).
#MisfireDetail: {
	policy:  enums.#MisfirePolicy
	outcome: enums.#OccurrenceState
}

// OverlapDetail carries the applied overlap policy and its resulting outcome (FR16, C3).
#OverlapDetail: {
	policy:  enums.#OverlapPolicy
	outcome: enums.#OccurrenceState
}

// ExecutionDetail carries the terminal occurrence outcome and a bounded reason (FR11, C6).
#ExecutionDetail: {
	outcome: enums.#OccurrenceState
	reason:  ids.#Reason
}

// RetryDetail carries the retry budget and a bounded reason; no blind mutation retry (FR14, C11).
#RetryDetail: {
	retry_budget: ids.#RetryBudget
	reason:       ids.#Reason
}

// NotificationDetail carries the notification delivery and ack state (FR22, C9).
#NotificationDetail: {
	delivery_state: enums.#DeliveryState
	ack_state:      enums.#AckState
}

// ReconcileDetail carries the reconciliation outcome and prior schema version (FR14, C5).
#ReconcileDetail: {
	outcome:      enums.#ReconcileOutcome
	from_version: ids.#SchemaVersion
}

// JobEvent is the closed tagged union of every FR11 vocabulary member.
#JobEvent: (
	#JobDefinitionCreatedEvent |
	#JobDefinitionUpdatedEvent |
	#JobDefinitionEnabledEvent |
	#JobDefinitionDisabledEvent |
	#JobDefinitionDeletedEvent |
	#JobRegisteredEvent |
	#JobUnregisteredEvent |
	#JobRescheduledEvent |
	#JobTriggerDueEvent |
	#JobOccurrenceClaimedEvent |
	#JobTriggeredEvent |
	#JobMisfiredEvent |
	#JobSkippedEvent |
	#JobCoalescedEvent |
	#JobQueuedEvent |
	#JobAdmittedEvent |
	#JobNotificationEnqueuedEvent |
	#JobNotificationDeliveredEvent |
	#JobNotificationAcknowledgedEvent |
	#JobNotificationExpiredEvent |
	#JobExecutionStartedEvent |
	#JobExecutionCompletedEvent |
	#JobExecutionFailedEvent |
	#JobExecutionCancelledEvent |
	#JobExecutionTimedOutEvent |
	#JobRetryScheduledEvent |
	#JobOverlapRejectedEvent |
	#JobOverlapReplacedEvent |
	#JobReconciledEvent |
	#JobUnknownEvent
)
