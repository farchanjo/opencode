// DDD role: ValueObject
// Package: operator_config_domains.persistence
// The shared CAS-versioned mutation contract for the four config-backed domains
// (Feature 013). Every telemetry/smart/budget/pools mutation persists through the
// SAME Config.Service seam (createLiveConfigServiceLike / store.config) langlock
// uses, under an optimistic CAS expectation; a stale version degrades to the typed
// version_conflict envelope and a config-unreachable failure to unavailable —
// never a fabricated success (FR7, FR8, FR12). CUE packages are not cross-resolved
// by the structural reader; import paths mirror the operator-menu corpus style.

package operator_config_domains.persistence

import (
	"operator-config-domains/enums"
	"operator-config-domains/shared"
)

// CasExpectation is the optimistic-concurrency guard a mutation carries: the version it expects to overwrite (FR7, FR12).
#CasExpectation: {
	authority:       shared.#AuthorityKey
	expectedVersion: shared.#Version
}

// ConfigMutation is one authorized, CAS-guarded mutation targeting a config-backed domain (FR7, FR9).
#ConfigMutation: {
	domain:      enums.#ConfigDomain
	commandId:   shared.#CommandId
	expectation: #CasExpectation
}

// MutationEnvelope is the typed outcome of a mutation: the applied outcome, the settled version, and a reason on failure (FR7, FR8).
#MutationEnvelope: {
	outcome:  enums.#MutationOutcome
	version?: shared.#Version
	reason?:  shared.#ReasonText
}
