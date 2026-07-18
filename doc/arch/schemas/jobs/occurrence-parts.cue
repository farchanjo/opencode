// DDD role: ValueObject
// Package: jobs.occurrence
// Cohesive sub-objects composed by the JobOccurrence aggregate root (FR10, C6).
// The idempotency tuple resolves duplicate delivery to a single execution with an
// observable duplicate outcome; delivery promises neither exactly-once nor global
// order (FR10, AC6). Each executable occurrence owns its own Todo and OutputGroup;
// a Job Definition never shares live work state (FR8, FR8a, C14, C15).

package jobs.occurrence

import (
	"jobs/ids"
	"jobs/enums"
	"jobs/schedule"
)

// IdempotencyKey is the (definition, schedule, nominal_due_time, generation) tuple (FR10, C6).
#IdempotencyKey: {
	job_definition_id: ids.#JobDefinitionId
	schedule_id:       ids.#ScheduleId
	nominal_due_time:  schedule.#NominalDueTime
	generation:        ids.#Generation
}

// OccurrenceLineage carries correlation/causation and session/root/process identity (FR10, FR12).
#OccurrenceLineage: {
	correlation_id:  ids.#CorrelationId
	causation_id:    ids.#CausationId | null
	session_id:      ids.#SessionId | null
	root_session_id: ids.#RootSessionId
	process_id:      ids.#ProcessId | null
}

// OccurrenceExecution carries executor-owned attempt/generation/sequence and owned work refs (FR8, FR8a).
#OccurrenceExecution: {
	attempt:    ids.#Attempt
	generation: ids.#Generation
	sequence:   ids.#Sequence
	todo_ref:   ids.#TodoRef | null
	output_ref: ids.#OutputRef | null
}

// OccurrenceStatus carries the state-machine state, reason, lag, duplicate resolution and timestamps (C6).
#OccurrenceStatus: {
	state:           enums.#OccurrenceState
	reason:          ids.#Reason
	schedule_lag_ms: ids.#ScheduleLagMs
	duplicate_of:    ids.#OccurrenceId | null
	created_at:      ids.#Timestamp
	updated_at:      ids.#Timestamp
	terminal_at:     ids.#Timestamp | null
}
