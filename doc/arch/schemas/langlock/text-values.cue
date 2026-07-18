// DDD role: ValueObject
// Package: langlock.shared
// Bounded text, flag and timestamp ValueObjects. All text axes exclude file text,
// diffs, prompts, messages, paths, snippets and secrets (NFR Privacy, Security 5).

package langlock.shared

// DisplayName is the human/native language name shown in pickers; never a technical tag (FR4, C13).
#DisplayName: string & !~"^$"

// Enabled flags whether Lang Lock is active for the resolved scope (FR1, FR7).
#Enabled: bool

// OverrideAuthorized flags whether native operator policy permits a project override (FR5, Security 1).
#OverrideAuthorized: bool

// HardFloor flags whether the global policy pins a hard-policy floor a project cannot relax (FR5, C2).
#HardFloor: bool

// Reason is a bounded human-readable explanation on a record or event; never content (Security 5).
#Reason: string

// Timestamp is an ISO 8601 instant.
#Timestamp: string & !~"^$"

// TraceId correlates a langlock.* span; lives in traces/logs only, never a metric label (C8, Observability).
#TraceId: string & !~"^$"

// SpanId correlates a langlock.* span; lives in traces/logs only, never a metric label (C8, Observability).
#SpanId: string & !~"^$"
