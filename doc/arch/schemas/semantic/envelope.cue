// DDD role: ValueObject
// Package: semantic.events
// SemanticEnvelope — the common context bundle carried on every semantic.* event (C22).
// It is a ValueObject: the identifiable message is the semantic.* event member that
// carries it; the envelope holds only the EventV2-assigned event_id as a value. It is
// content-free per ADR-0001 — bounded enums, opaque ids and redacted key/value metadata
// only, never query text, vectors, prompts, reasoning, or paths (FR42, C22). Cohesive
// parts live in envelope-parts.cue.

package semantic.events

import "semantic/ids"

// SemanticEnvelope carries typed identity, ordering and delivery context for one semantic.* event (C22).
#SemanticEnvelope: {
	// EventV2 evt_ id carried as a value; the event member owns identity (C22).
	event_id: ids.#EventId

	// Event type, schema version, class, source, actor and visibility.
	kind: #EventKind

	// Binding/generation/collection/project subject identity of the event.
	subject: #EventSubject

	// Per-aggregate sequence, correlation and causation.
	ordering: #Ordering

	// Visibility, timestamp and redacted metadata.
	delivery: #Delivery
}
