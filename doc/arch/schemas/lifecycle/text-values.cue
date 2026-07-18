// DDD role: ValueObject
// Package: lifecycle.shared
// Bounded redacted text, timestamp and trace-id ValueObjects.
// All text axes exclude prompts, results, tool payloads, paths and secrets (FR13).

package lifecycle.shared

// Reason is a bounded human-readable explanation on a record.
#Reason: string

// Description is a bounded redacted process description (FR28).
#Description: string

// ActivityLabel is the rendered form of an allowlisted ActivityKind (FR56).
#ActivityLabel: string & !~"^$"

// Timestamp is an ISO 8601 instant.
#Timestamp: string & !~"^$"

// TraceId correlates a lifecycle span; lives in traces/logs only, never a label (C18).
#TraceId: string & !~"^$"

// SpanId correlates a lifecycle span; lives in traces/logs only, never a label (C18).
#SpanId: string & !~"^$"
