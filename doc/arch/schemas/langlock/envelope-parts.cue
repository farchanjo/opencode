// DDD role: ValueObject
// Package: langlock.envelope
// Cohesive sub-objects composed by the LangLockEnvelope (C8). Every event carries
// its type/class/source, acting principal, per-aggregate sequence, correlation and
// causation, opaque execution id, timestamp and redacted metadata; no file text,
// diff, prompt, message, path, snippet, reasoning or tool payload (Security 5).

package langlock.envelope

import (
	"langlock/ids"
	"langlock/enums"
)

// EventKind carries the event type, schema version, class and emitting source (C8).
#EventKind: {
	event_type:     enums.#LangLockEventType
	schema_version: ids.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#EventSource
}

// ActorContext carries the acting principal, actor kind and scope; no LLM ever administers (FR35, AC13).
#ActorContext: {
	actor_kind: enums.#ActorKind
	principal:  ids.#Principal
	scope:      enums.#Scope
}

// Ordering carries per-aggregate sequence, correlation and causation (C8).
#Ordering: {
	sequence:       ids.#Sequence
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
}

// RedactedMetadata is the bounded key/value metadata map; no content or secrets (Security 5).
#RedactedMetadata: {[string]: string}

// Delivery carries the opaque execution correlation, timestamp and redacted metadata (Observability, C8).
#Delivery: {
	execution_id:      ids.#ExecutionId
	timestamp:         ids.#Timestamp
	redacted_metadata: #RedactedMetadata
}
