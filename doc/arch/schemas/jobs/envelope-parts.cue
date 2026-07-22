// DDD role: ValueObject
// Package: jobs.envelope
// Cohesive sub-objects composed by the JobEnvelope aggregate (FR12). Every
// event carries aggregate/sequence, correlation/causation, occurrence, session,
// root-session, process, attempt, generation, source, visibility, timestamp and
// redacted metadata; no prompts, results, paths or secrets (FR12, FR32).

package jobs.envelope

import (
	"jobs/ids"
	"jobs/enums"
)

// Job EventKind — schedule/source classification for job.* only (FR11, FR12).
// Includes JobSource so consumers distinguish cron, run-now, and reconcile origins.
#EventKind: {
	event_type:     enums.#JobEventType
	schema_version: ids.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#JobSource
	actor_kind:     enums.#ActorKind
	visibility:     enums.#Visibility
}

// OccurrenceIdentity — definition/schedule/occurrence/process plus attempt/generation.
// The idempotency tuple keys on these ids with nominal_due_time (C6); process_id is null until claim.
#OccurrenceIdentity: {
	job_definition_id: ids.#JobDefinitionId
	schedule_id:       ids.#ScheduleId
	occurrence_id:     ids.#OccurrenceId
	process_id:        ids.#ProcessId | null
	attempt:           ids.#Attempt
	generation:        ids.#Generation
}

// TreeIdentity — root-session and optional session for scheduled headless work (FR21).
// Session may be null until the Feature 002 Task Process admits the occurrence.
#TreeIdentity: {
	root_session_id: ids.#RootSessionId
	session_id:      ids.#SessionId | null
}

// Ordering — per-job-aggregate sequence plus correlation/causation (FR12, C6).
// Sequence is local to the job aggregate; never a global event clock.
#Ordering: {
	sequence:       ids.#Sequence       // jobs aggregate local order
	correlation_id: ids.#CorrelationId  // ties trigger → occurrence → notify
	causation_id:   ids.#CausationId | null
}

// Jobs redacted metadata map — bounded string pairs only; no secrets or payloads (FR32).
// Job notifications and history projections may attach lag/outcome labels here only.
#RedactedMetadata: {[string]: string} // jobs lag/outcome labels only

// Jobs delivery slice — visibility for observer authorization, occurrence timestamp,
// and redacted metadata. Paths, prompts, and full results stay out of the envelope (FR22, FR32).
#Delivery: {
	visibility:        enums.#Visibility // jobs observer auth
	timestamp:         ids.#Timestamp    // occurrence wall-clock
	redacted_metadata: #RedactedMetadata // FR32 — no paths/prompts
}
