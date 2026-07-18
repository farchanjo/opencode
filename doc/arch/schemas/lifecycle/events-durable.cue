// DDD role: ValueObject
// Package: lifecycle.events
// Durable semantic-checkpoint event members (C4). Durable members carry the
// EventV2 durable {version, aggregate: "root_process_id"} annotation and replay
// through readAggregate. Terminal durable members live in events-durable-terminal.cue.

package lifecycle.events

import "lifecycle/envelope"

// admitted — capacity granted/partial/queued/rejected under a scope (C11).
#LifecycleAdmittedEvent: {
	type:     "lifecycle.admitted"
	envelope: envelope.#LifecycleEnvelope
	detail:   #AdmissionDetail
}

// parent_attached — the process was linked into its parent tree.
#LifecycleParentAttachedEvent: {
	type:     "lifecycle.parent_attached"
	envelope: envelope.#LifecycleEnvelope
}

// process_created — a new attempt/execution identity was created.
#LifecycleProcessCreatedEvent: {
	type:     "lifecycle.process_created"
	envelope: envelope.#LifecycleEnvelope
}

// started — execution began for the process.
#LifecycleStartedEvent: {
	type:     "lifecycle.started"
	envelope: envelope.#LifecycleEnvelope
}

// handoff — single durable ownership transfer projectable to both sessions (C16).
#LifecycleHandoffEvent: {
	type:     "lifecycle.handoff"
	envelope: envelope.#LifecycleEnvelope
	detail:   #HandoffDetail
}

// reconciled — versioned reconciliation with durable Sessions; no auto-retry (C13).
#LifecycleReconciledEvent: {
	type:     "lifecycle.reconciled"
	envelope: envelope.#LifecycleEnvelope
	detail:   #ReconcileDetail
}
