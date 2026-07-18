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

// EventKind carries the event type, schema version, class, source, actor and visibility.
#EventKind: {
	event_type:     enums.#JobEventType
	schema_version: ids.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#JobSource
	actor_kind:     enums.#ActorKind
	visibility:     enums.#Visibility
}

// OccurrenceIdentity carries definition/schedule/occurrence/process identity and attempt/generation.
#OccurrenceIdentity: {
	job_definition_id: ids.#JobDefinitionId
	schedule_id:       ids.#ScheduleId
	occurrence_id:     ids.#OccurrenceId
	process_id:        ids.#ProcessId | null
	attempt:           ids.#Attempt
	generation:        ids.#Generation
}

// TreeIdentity carries root-session and session identity.
#TreeIdentity: {
	root_session_id: ids.#RootSessionId
	session_id:      ids.#SessionId | null
}

// Ordering carries per-aggregate sequence, correlation and causation (FR12, C6).
#Ordering: {
	sequence:       ids.#Sequence
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
}

// RedactedMetadata is the bounded key/value metadata map; no secrets or payloads (FR32).
#RedactedMetadata: {[string]: string}

// Delivery carries visibility, timestamp and redacted metadata.
#Delivery: {
	visibility:        enums.#Visibility
	timestamp:         ids.#Timestamp
	redacted_metadata: #RedactedMetadata
}
