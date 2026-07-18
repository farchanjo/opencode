// DDD role: ValueObject
// Package: lifecycle.envelope
// Cohesive sub-objects composed by the LifecycleEnvelope aggregate root (FR9).

package lifecycle.envelope

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// EventKind carries the event type, schema version, class, actor and runtime.
#EventKind: {
	event_type:          enums.#LifecycleEventType
	schema_version:      ids.#SchemaVersion
	event_class:         enums.#EventClass
	agent_kind:          enums.#AgentKind
	actor_kind:          enums.#ActorKind
	runtime_instance_id: ids.#RuntimeInstanceId
}

// TreeIdentity carries root/session/parent-session identity.
#TreeIdentity: {
	root_session_id:   ids.#RootSessionId
	session_id:        ids.#SessionId
	parent_session_id: ids.#ParentSessionId | null
}

// ProcessIdentity carries task/process/parent-process/root-process identity.
#ProcessIdentity: {
	task_id:           ids.#TaskId
	process_id:        ids.#ProcessId
	parent_process_id: ids.#ParentProcessId | null
	root_process_id:   ids.#RootProcessId
}

// Ordering carries per-aggregate sequence, correlation and attempt/generation.
#Ordering: {
	sequence:       ids.#Sequence
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
	attempt:        ids.#Attempt
	generation:     ids.#Generation
}

// RedactedMetadata is the bounded key/value metadata map; no secrets or payloads (FR13).
#RedactedMetadata: {[string]: string}

// Delivery carries visibility, timestamp and redacted metadata.
#Delivery: {
	visibility:        enums.#Visibility
	timestamp:         ids.#Timestamp
	redacted_metadata: #RedactedMetadata
}
