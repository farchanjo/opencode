// DDD role: ValueObject
// Package: operator_persistence.persistence
// The shared CAS-versioned mutation commit contract for the config-backed
// domains (Feature 014). Every langlock/telemetry/smart/budget/pools/jobs
// mutation commits through the SAME Config.Service seam via the mutation_plan
// path, so mutateAuthority owns the single committed CAS write and the Feature
// 007 audit correlation; the retired self_commit_query path is named here only to
// record the conversion (FR5). A stale version degrades to version_conflict and a
// config-unreachable failure to unavailable — never a fabricated success (FR14).
// CUE packages are not cross-resolved by the structural reader; import paths
// mirror the operator-config-domains corpus style.

package operator_persistence.persistence

import (
	"operator-persistence/enums"
	"operator-persistence/shared"
)

// CasExpectation is the optimistic-concurrency guard a mutation carries: the version it expects to overwrite (FR4, FR5).
#CasExpectation: {
	authority:       shared.#AuthorityKey
	expectedVersion: shared.#Version
}

// MutationCommit is one authorized mutation routed through mutateAuthority via the mutation_plan commit path (FR5).
#MutationCommit: {
	domain:      enums.#ConfigBackedDomain
	commandId:   shared.#CommandId
	commitPath:  enums.#MutationCommitPath
	expectation: #CasExpectation
}

// MutationEnvelope is the typed outcome of a committed mutation: the outcome, the settled version, and a reason on failure (FR5, FR14).
#MutationEnvelope: {
	outcome:  enums.#MutationOutcome
	version?: shared.#Version
	reason?:  shared.#ReasonText
}
</content>
