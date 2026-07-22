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

// OutputSpool EventKind — output.* event type plus source/actor/visibility (C20).
// Source distinguishes writer, retention sweeper, and operator admin origins.
#EventKind: {
	event_type:     enums.#OutputEventType
	schema_version: values.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#EventSource
	actor_kind:     enums.#ActorKind
	visibility:     enums.#Visibility
}

// EventSubject — group/output/channel/generation identity only; never a filesystem path (FR12, C18).
// Output_ref is an opaque handle; channel is null until a named stream is bound.
#EventSubject: {
	group_id:   ids.#GroupId
	output_ref: ids.#OutputRef | null
	channel:    enums.#Channel | null
	generation: values.#Generation
}

// Ordering — per-output-group sequence plus correlation/causation (C20).
// Correlation_id is the same key EventV2 uses to group per-aggregate publish order.
#Ordering: {
	sequence:       values.#Sequence    // output-group local order
	correlation_id: ids.#CorrelationId  // EventV2 publish grouping key (C20)
	causation_id:   ids.#CausationId | null
}

// OutputSpool redacted metadata map — bounded string pairs; no secrets or page bodies (FR5, C22).
// Stat/follow projections may attach size/generation labels without leaking content.
#RedactedMetadata: {[string]: string} // spool size/generation labels only

// OutputSpool delivery slice — visibility for paged readers, event timestamp, and
// redacted metadata. Page bytes and absolute paths never ride this envelope (FR5, C18).
#Delivery: {
	visibility:        enums.#Visibility // paged reader authorization
	timestamp:         ids.#Timestamp    // spool event wall-clock
	redacted_metadata: #RedactedMetadata // FR5/C18 — no page bytes/paths
}
