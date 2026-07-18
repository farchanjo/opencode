// DDD role: ValueObject
// Package: semantic.shared
// Content-hash, config-hash, fingerprint and flag ValueObjects. Index updates are
// content-hash incremental upsert / tombstone so a changed or deleted document
// reconciles against core state (FR13, AC10). The query fingerprint keys the query
// embedding cache derived once per logical Task (FR18, C10). Flags carry no content;
// availability mirrors live core state and is revalidated before injection (FR20, C11).

package semantic.shared

// ContentHash is the canonical content hash driving incremental upsert/tombstone (FR13, AC10).
#ContentHash: string & !~"^$"

// ConfigHash invalidates caches by config generation alongside the binding version (FR25, C10).
#ConfigHash: string & !~"^$"

// Fingerprint keys the query-embedding cache derived once per logical Task (FR18, C10, AC16).
#Fingerprint: string & !~"^$"

// Enabled marks a profile/model/document enabled in the operator panel (FR29, FR31).
#Enabled: bool

// Available mirrors live availability revalidated against core before injection (FR20, C11).
#Available: bool

// Normalized flags whether a collection generation stores normalized vectors (FR12, C7).
#Normalized: bool

// InsecureAllowed permits non-TLS only for an explicit local profile with a warning (FR33, C17).
#InsecureAllowed: bool
