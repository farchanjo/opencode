// DDD role: ValueObject
// Package: mcp.shared
// Boolean posture ValueObjects, wrapped to keep bare booleans out of the aggregates
// (calisthenics). A capability flag records only what the server advertised and is never
// exercised unless set (FR7, C2); an annotation hint is untrusted unless the trust
// profile elevates it (FR13a, C6); a policy opt-in gates re-read/reindex/wake off by
// default (FR23, C9); an operator-surfaced flag guarantees elicitation reaches the
// operator (FR47, C20). No flag carries content.

package mcp.shared

// Enabled is the operator enable posture of a server, flag, or subscription (FR8, FR41).
#Enabled: bool

// Capable records a single negotiated server capability; never exercised unless true (FR7, C2).
#Capable: bool

// Hint is an untrusted tool annotation hint; ignored for gating unless elevated (FR13a, C6).
#Hint: bool

// Supported records task/resume support advertised by the server or SDK (FR29, FR42, C14, C18).
#Supported: bool

// OperatorSurfaced guarantees an elicitation/input_required reached the operator UI (FR47, C20).
#OperatorSurfaced: bool

// SensitiveBlocked records that sensitive-mode blocked a model-mediated answer (FR47, C20).
#SensitiveBlocked: bool

// PolicyOptin gates a re-read/reindex/wake opt-in that is off by default (FR23, FR24, C9, C21, C22).
#PolicyOptin: bool

// RateLimited records that a logging notification was dropped by the rate limit (FR28, C23).
#RateLimited: bool

// Active records that a subscription or alias is the live one (FR21, C10).
#Active: bool

// Coalesced records that an update was merged into a bounded-queue frame (FR23, C9).
#Coalesced: bool
