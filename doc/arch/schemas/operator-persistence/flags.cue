// DDD role: ValueObject
// Package: operator_persistence.shared
// Bounded boolean ValueObjects for the Feature 014 persistence completion. Each
// operator-surface flag is a named type so no bare bool is carried inline
// (wrap-primitives). They record whether a domain is configured, whether a
// mutation truly persisted (round-tripped), whether the cache was invalidated,
// whether the write path landed on a loader-consumed read path, and whether a
// persisted secret is a SecretRef only — never a fabricated availability
// (FR2, FR3, FR11, FR14).

package operator_persistence.shared

// Configured is true when the domain has a persisted, loader-read Config.Service entry; a false success never sets it (FR1, FR4).
#Configured: bool

// Persisted is true only when a committed mutation is read back by the loader; an orphaned write leaves it false (FR2, FR4).
#Persisted: bool

// CacheInvalidated is true when the committed mutation dropped the authority-scoped config cache so a re-read is fresh (FR3).
#CacheInvalidated: bool

// LoaderConsumed is true when the write path lands on a file/authority the instance loader actually reads (FR2).
#LoaderConsumed: bool

// SecretRefOnly is true when every persisted secret value is a SecretRef and no plaintext credential is stored (FR11, Security).
#SecretRefOnly: bool
</content>
