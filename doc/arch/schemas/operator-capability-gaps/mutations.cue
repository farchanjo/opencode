// DDD role: ValueObject
// Package: operator_capability_gaps.mutations
// The MCP mutation commit contract (Feature 017, GAP E mutations). The
// config-backed MCP verbs convert to the mutation_plan path so mutateAuthority
// owns the single committed CAS write over the store.config MCP authority; the
// live-service actions (connect/disconnect/reconnect) dispatch as plans whose
// apply calls the live MCP.Service with an honest typed outcome; the interactive
// OAuth auth verbs stay typed gaps while a local credential clear may convert
// (FR3, FR4, FR5). The retired self_commit_query path — the phantom-write trap —
// is named only to record the conversion (FR5). CUE packages are not
// cross-resolved by the structural reader; import paths mirror the
// operator-persistence corpus style.

package operator_capability_gaps.mutations

import (
	"operator-capability-gaps/enums"
	"operator-capability-gaps/shared"
)

// CasExpectation is the optimistic-concurrency guard a config-backed MCP mutation carries: the version it expects to overwrite (FR3).
#CasExpectation: {
	authority:       shared.#AuthorityKey
	expectedVersion: shared.#Version
}

// McpMutation is one authorized MCP mutation routed through the chosen commit path; never a self-committed query (FR3, FR4).
#McpMutation: {
	commandId:    shared.#CommandId
	commitPath:   enums.#McpCommitPath
	expectation?: #CasExpectation
}

// McpAuthDisposition records the headless verdict for an MCP auth verb: interactive OAuth stays gapped, a local clear converts (FR5).
#McpAuthDisposition: {
	commandId: shared.#CommandId
	verdict:   enums.#McpAuthVerdict
	gap?:      enums.#ServiceGap
}

// MutationEnvelope is the typed outcome of a committed mutation or live action: the outcome, the settled version, and a reason on failure (FR3, FR18).
#MutationEnvelope: {
	outcome:  enums.#MutationOutcome
	version?: shared.#Version
	reason?:  shared.#ReasonText
}
