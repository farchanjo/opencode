// DDD role: ValueObject
// Package: langlock.enums
// LangLockEventType — the closed langlock.* event vocabulary (C8). The langlock.*
// prefix is the Feature 004 audit/advisory event namespace on EventV2; it is
// distinct from the Feature 007 langlock.* operator command domain, and both are
// reserved (C3, C8).

package langlock.enums

// LangLockEventType is the closed langlock.* vocabulary registered through EventV2.define (C8).
#LangLockEventType: "langlock.policy_set" | "langlock.policy_reset" | "langlock.override_authorized" | "langlock.override_denied" | "langlock.exception_registered" | "langlock.exception_revoked" | "langlock.policy_injected" | "langlock.policy_reapplied" | "langlock.envelope_stamped" | "langlock.advisory_flagged" | "langlock.advisory_acknowledged" | "langlock.advisory_suppressed" | "langlock.detector_unknown" | "langlock.resolution_retained" | "langlock.unknown"
