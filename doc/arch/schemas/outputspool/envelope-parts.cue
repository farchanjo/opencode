// DDD role: ValueObject
// Package: outputspool.envelope
// Cohesive sub-objects composed by the OutputEnvelope (C20). Every event carries
// event type/version/class/source/actor/visibility, group/output/channel/generation
// subject, per-aggregate sequence, correlation/causation, timestamp and redacted
// metadata; no prompts, results, paths or secrets (FR5, C22). Per-aggregate ordering
// groups by correlation_id — the same key EventV2 reads at publish time (C20).

package outputspool.envelope

import (
	"outputspool/ids"
	"outputspool/values"
	"outputspool/enums"
)

// EventKind carries the event type, schema version, class, source, actor and visibility.
#EventKind: {
	event_type:     enums.#OutputEventType
	schema_version: values.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#EventSource
	actor_kind:     enums.#ActorKind
	visibility:     enums.#Visibility
}

// EventSubject carries group/output/channel/generation identity; no path is ever present (FR12, C18).
#EventSubject: {
	group_id:   ids.#GroupId
	output_ref: ids.#OutputRef | null
	channel:    enums.#Channel | null
	generation: values.#Generation
}

// Ordering carries per-aggregate sequence, correlation and causation (C20).
#Ordering: {
	sequence:       values.#Sequence
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
}

// RedactedMetadata is the bounded key/value metadata map; no secrets or payloads (FR5, C22).
#RedactedMetadata: {[string]: string}

// Delivery carries visibility, timestamp and redacted metadata.
#Delivery: {
	visibility:        enums.#Visibility
	timestamp:         ids.#Timestamp
	redacted_metadata: #RedactedMetadata
}
