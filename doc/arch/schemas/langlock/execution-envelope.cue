// DDD role: ValueObject
// Package: langlock.execution
// ExecutionStamp — the immutable Lang Lock metadata captured into a Task/subagent/
// write/edit/apply_patch/shell-commit execution envelope at start (FR18, FR19,
// FR26, C4, C11). It is native and is never a model-controlled tool argument
// (FR19). The start-time tag/version is immutable for the running execution and is
// preserved across cancel/retry/resume/handoff (C10, C11).

package langlock.execution

import (
	"langlock/ids"
	"langlock/enums"
)

// StampLanguage carries the effective tag, policy/config version and enforcement mode (FR18, C11).
#StampLanguage: {
	tag:              ids.#LanguageTag
	policy_version:   ids.#PolicyVersion
	config_version:   ids.#ConfigVersion
	enforcement_mode: enums.#EnforcementMode
}

// StampProvenance carries the origin, emitting source, capture instant and correlation (FR18, FR26).
#StampProvenance: {
	origin:         enums.#Origin
	source:         enums.#EventSource
	captured_at:    ids.#Timestamp
	correlation_id: ids.#CorrelationId
}

// StampTree carries the root-session/session/todo/output references the stamp travels with (FR26, FR28, C9, C10).
#StampTree: {
	root_session_id: ids.#RootSessionId
	session_id:      ids.#SessionId | null
	todo_ref:        ids.#TodoRef | null
	output_ref:      ids.#OutputRef | null
}

// ExecutionStamp is the immutable per-execution Lang Lock envelope metadata (FR18, C4, C11).
#ExecutionStamp: {
	language:   #StampLanguage
	provenance: #StampProvenance
	tree:       #StampTree
}
