// DDD role: ValueObject
// Package: operator_persistence.roundtrip
// The config persistence round-trip contract (Feature 014). A committed operator
// mutation must land on a loader-consumed path (write/read alignment), invalidate
// the authority-scoped config cache, and be read back — surviving a process
// restart. The orphaned phase is the pre-fix false success (a cas_vN the loader
// never reads) and rejected is the pre-fix unknown-key failure; both stay in the
// contract as the honest negatives the acceptance test pins (FR1, FR2, FR3, FR4).
// Its lifecycle is modeled in ../../statecharts/config-roundtrip.md. CUE packages
// are not cross-resolved by the structural reader; import paths mirror the
// operator-config-domains corpus style.

package operator_persistence.roundtrip

import (
	"operator-persistence/enums"
	"operator-persistence/shared"
	"operator-persistence/flags"
)

// ConfigRoundTrip is one domain's write->invalidate->reload->read alignment over the Config.Service authority (FR2, FR3).
#ConfigRoundTrip: {
	domain:         enums.#ConfigBackedDomain
	authority:      shared.#AuthorityKey
	writePath:      shared.#ConfigFilePath
	readPath:       shared.#ConfigFilePath
	loaderConsumed: flags.#LoaderConsumed
}

// RoundTripOutcome is the typed result of a round-trip attempt: the reached phase, whether it persisted, and the cache state (FR3, FR4).
#RoundTripOutcome: {
	phase:            enums.#RoundTripPhase
	persisted:        flags.#Persisted
	cacheInvalidated: flags.#CacheInvalidated
	version?:         shared.#Version
	reason?:          shared.#ReasonText
}

// RestartCheck asserts a domain's persisted state is still read after a process restart; a false success never satisfies it (FR4).
#RestartCheck: {
	domain:     enums.#ConfigBackedDomain
	configured: flags.#Configured
	version:    shared.#Version
}
</content>
