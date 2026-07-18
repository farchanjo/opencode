// DDD role: ValueObject
// Package: outputspool.envelope
// OutputEnvelope — the common context bundle carried on every output.* event (C20).
// It is a ValueObject: the identifiable message is the output.* event member that
// carries it; the envelope holds only the EventV2-assigned event_id as a value. It
// is content-free per ADR-0001 — bounded enums, opaque ids and redacted key/value
// metadata only, never file text, diff, prompt, message, path, snippet, reasoning
// or tool payload (FR5, C22). Cohesive parts live in envelope-parts.cue.

package outputspool.envelope

import "outputspool/ids"

// OutputEnvelope carries typed identity, ordering and delivery context for one output.* event (C20).
#OutputEnvelope: {
	// EventV2 evt_ id carried as a value; the event member owns identity (C20).
	event_id: ids.#EventId

	// Event type, schema version, class, source, actor and visibility.
	kind: #EventKind

	// Group/output/channel/generation subject identity of the event.
	subject: #EventSubject

	// Per-aggregate sequence, correlation and causation.
	ordering: #Ordering

	// Visibility, timestamp and redacted metadata.
	delivery: #Delivery
}
