// DDD role: ValueObject
// Package: operator_capability_gaps.shared
// Bounded boolean ValueObjects for the Feature 017 capability-gap closure. Each
// operator-surface flag is a named type so no bare bool is carried inline
// (wrap-primitives). They record whether a live host is bound, whether the spool
// is actually populated, whether a Milvus endpoint is configured, whether a
// persisted secret is a SecretRef only, and whether the read model fabricated any
// SSOT-only field (which it must never do) — never a fabricated availability
// (FR1, FR6, FR13, FR18). Shares the shared package with shared.cue (the
// operator-persistence corpus precedent).

package operator_capability_gaps.shared

// LiveHostBound is true when the underlying live host (MCP.Service, EventV2Bridge, Milvus) is resolvable; an unbound host degrades to a typed gap (FR2, FR12, FR14).
#LiveHostBound: bool

// SpoolPopulated is true when a production writer has written the channel generation the read projects; an empty store leaves it false (FR6, FR7).
#SpoolPopulated: bool

// EndpointConfigured is true when a Milvus endpoint is configured so the index override binds; unconfigured degrades to the typed milvus_unavailable gap (FR13).
#EndpointConfigured: bool

// SsotFieldFabricated must always be false: the live read projects only host-carried fields, leaving CAS version / auditId / trust profile absent (FR1, FR18).
#SsotFieldFabricated: bool

// SecretRefOnly is true when every persisted secret value is a SecretRef and no plaintext credential is stored (FR11, FR18, Security).
#SecretRefOnly: bool

// CapabilitiesPresent is true when a live MCP server advertises capabilities in its client host record; a content-free presence flag, never the capability payload (FR1).
#CapabilitiesPresent: bool

// WatchBounded is true when the jobs.watch subscription carries a bounded buffer and an explicit close so a slow consumer cannot grow memory without bound (FR12).
#WatchBounded: bool

// FieldRequired is true when an edit-modal field must be filled before Save composes the payload; an optional field may stay empty (FR19, FR20).
#FieldRequired: bool
