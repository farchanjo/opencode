// DDD role: ValueObject
// Package: jobs.envelope
// JobEnvelope — the common context bundle carried on every job.* event (FR12).
// It is a ValueObject: the identifiable message is the job.* event member that
// carries it; the envelope holds only the EventV2-assigned event_id as a value.
// Cohesive parts live in envelope-parts.cue to keep every definition small.

package jobs.envelope

import "jobs/ids"

// JobEnvelope carries typed identity, ordering and delivery context for one
// job.* event; Feature 002 per-aggregate ordering remains authoritative (FR12, C6).
#JobEnvelope: {
	// EventV2 evt_ id carried as a value; the event member owns identity (C8).
	event_id: ids.#EventId

	// Event type, schema version, class, source, actor and visibility.
	kind: #EventKind

	// Definition/schedule/occurrence/process identity plus attempt/generation.
	occurrence: #OccurrenceIdentity

	// Root-session and session identity of the occurrence tree.
	tree: #TreeIdentity

	// Per-aggregate sequence, correlation and causation.
	ordering: #Ordering

	// Visibility, timestamp and redacted metadata.
	delivery: #Delivery
}
