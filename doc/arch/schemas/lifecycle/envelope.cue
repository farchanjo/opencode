// DDD role: ValueObject
// Package: lifecycle.envelope
// LifecycleEnvelope — the common context bundle carried on every lifecycle
// event (FR9). It is a ValueObject: the identifiable message is the lifecycle
// event member that carries it; the envelope holds only the EventV2-assigned
// event_id as a value. Cohesive parts live in envelope-parts.cue and
// envelope-hierarchy.cue to keep every definition small.

package lifecycle.envelope

import "lifecycle/ids"

// LifecycleEnvelope carries typed identity, ordering and delivery context for
// one lifecycle event. hierarchy is present only when Smart routing is active (C15).
#LifecycleEnvelope: {
	// EventV2 evt_ id carried as a value; the event member owns identity (C8).
	event_id: ids.#EventId

	// Event kind, schema version, actor and runtime instance.
	kind: #EventKind

	// Root/session/parent-session identity.
	tree: #TreeIdentity

	// Task/process/parent-process/root-process identity.
	process: #ProcessIdentity

	// Per-aggregate sequence, correlation, causation, attempt and generation.
	ordering: #Ordering

	// Visibility, timestamp and redacted metadata.
	delivery: #Delivery

	// Hierarchy role/depth/path/fanout/validation when Smart routing is active.
	hierarchy: #HierarchyContext | null
}
