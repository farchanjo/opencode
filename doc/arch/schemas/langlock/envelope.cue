// DDD role: ValueObject
// Package: langlock.envelope
// LangLockEnvelope — the common context bundle carried on every langlock.* event
// (C8). It is a ValueObject: the identifiable message is the langlock.* event
// member that carries it; the envelope holds only the EventV2-assigned event_id as
// a value. Content-free per ADR-0001 (Security 5, Observability). Cohesive parts
// live in envelope-parts.cue to keep every definition small.

package langlock.envelope

import "langlock/ids"

// LangLockEnvelope carries typed identity, ordering and delivery context for one langlock.* event (C8).
#LangLockEnvelope: {
	// EventV2 evt_ id carried as a value; the event member owns identity (C8).
	event_id: ids.#EventId

	// Event type, schema version, class and source.
	kind: #EventKind

	// Acting principal, actor kind and scope; no LLM ever administers (FR35).
	actor: #ActorContext

	// Per-aggregate sequence, correlation and causation.
	ordering: #Ordering

	// Execution correlation, timestamp and redacted metadata.
	delivery: #Delivery
}
