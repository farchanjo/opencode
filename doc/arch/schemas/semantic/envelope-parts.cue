// DDD role: ValueObject
// Package: semantic.events
// Cohesive sub-objects composed by the SemanticEnvelope (C22). Every event carries the
// event type/version/class/source/actor/visibility, the binding/generation/collection/
// project subject, per-aggregate sequence and correlation, timestamp and redacted
// metadata; no query text, vectors, entity ids, session ids, or paths appear (FR42,
// ADR-0001, C22). An actor is runtime or operator; an LLM never administers (FR31, C15).

package semantic.events

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// EventKind carries the event type, schema version, class, source, actor and visibility (C22).
#EventKind: {
	event_type:     enums.#SemanticEventType
	schema_version: values.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#EventSource
	actor_kind:     enums.#ActorKind
	visibility:     enums.#Visibility
}

// EventSubject carries the binding/generation/collection/project identity; no path appears (FR17, C22).
#EventSubject: {
	binding_id:    ids.#BindingId | null
	generation_id: ids.#GenerationId | null
	collection:    enums.#Collection | null
	project_id:    ids.#ProjectId
}

// Ordering carries the per-aggregate sequence, correlation and causation (C22).
#Ordering: {
	sequence:       values.#Sequence
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
}

// RedactedMetadata is the bounded key/value metadata map; no content, vectors, or secrets (FR42, C22).
#RedactedMetadata: {[string]: string}

// Delivery carries the visibility, timestamp and redacted metadata (C22).
#Delivery: {
	visibility:        enums.#Visibility
	timestamp:         ids.#Timestamp
	redacted_metadata: #RedactedMetadata
}
