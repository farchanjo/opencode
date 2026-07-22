// DDD role: ValueObject
// Package: lifecycle.envelope
// Cohesive sub-objects composed by the LifecycleEnvelope aggregate root (FR9).

package lifecycle.envelope

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// Lifecycle EventKind — task-process event type plus agent/runtime placement (FR9).
// Runtime_instance_id scopes multi-worker identity; agent_kind is hierarchy role only.
#EventKind: {
	event_type:          enums.#LifecycleEventType
	schema_version:      ids.#SchemaVersion
	event_class:         enums.#EventClass
	agent_kind:          enums.#AgentKind
	actor_kind:          enums.#ActorKind
	runtime_instance_id: ids.#RuntimeInstanceId
}

// TreeIdentity — root/session/parent-session for the Feature 002 process tree.
// Parent_session_id is null at the root session; never an OS or network handle.
#TreeIdentity: {
	root_session_id:   ids.#RootSessionId
	session_id:        ids.#SessionId
	parent_session_id: ids.#ParentSessionId | null
}

// ProcessIdentity — task/process/parent-process/root-process for the Process Table.
// Process_id is the Feature 002 Task Process id, never an OS PID.
#ProcessIdentity: {
	task_id:           ids.#TaskId
	process_id:        ids.#ProcessId
	parent_process_id: ids.#ParentProcessId | null
	root_process_id:   ids.#RootProcessId
}

// Ordering — per-process-aggregate sequence, correlation, attempt, and generation.
// Attempt/generation are executor-owned fencing counters carried on every lifecycle event.
#Ordering: {
	sequence:       ids.#Sequence       // process-table local order
	correlation_id: ids.#CorrelationId  // tree admission correlation
	causation_id:   ids.#CausationId | null
	attempt:        ids.#Attempt        // executor-owned
	generation:     ids.#Generation     // fencing generation
}

// Lifecycle redacted metadata map — bounded string pairs; no secrets or tool payloads (FR13).
// Process Table projections may surface state labels here without body content.
#RedactedMetadata: {[string]: string} // lifecycle state labels only

// Lifecycle delivery slice — observer visibility, event wall-clock, and redacted
// metadata for the Process Table observation seam. No transcript or path content (FR13).
#Delivery: {
	visibility:        enums.#Visibility // process-table observers
	timestamp:         ids.#Timestamp    // lifecycle event wall-clock
	redacted_metadata: #RedactedMetadata // FR13 — no transcript/path
}
