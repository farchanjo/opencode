// DDD role: ValueObject
// Package: jobs.shared
// Bounded redacted text, flag, timestamp and permission ValueObjects. All text
// axes exclude raw prompts, results, spool paths and secrets (FR22, FR32, Privacy).

package jobs.shared

// JobName is a non-empty human label for a definition (FR2).
#JobName: string & !~"^$"

// JobDescription is a bounded redacted description; empty is valid (FR2).
#JobDescription: string

// ActionTarget names a redacted target/action handle; never a shell command literal (FR28, FR29).
#ActionTarget: string & !~"^$"

// BoundedSummary is the bounded notification summary; never full content (FR22, AC29).
#BoundedSummary: string

// Reason is a bounded human-readable explanation on a record or event.
#Reason: string

// Timestamp is an ISO 8601 instant.
#Timestamp: string & !~"^$"

// TraceId correlates a job.* span; lives in traces/logs only, never a label (C18).
#TraceId: string & !~"^$"

// SpanId correlates a job.* span; lives in traces/logs only, never a label (C18).
#SpanId: string & !~"^$"

// Enabled flags whether a Job Definition is active and eligible for registration (FR2, FR6).
#Enabled: bool

// PermissionSet is the first-class collection of allowlisted permission ids (FR29, C10).
#PermissionSet: [...string]
