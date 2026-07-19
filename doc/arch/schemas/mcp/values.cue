// DDD role: ValueObject
// Package: mcp.shared
// Numeric counter, bound and wire-value ValueObjects. Page index/size and max-page are
// the cursor-pagination guard bounds (FR10, C4); byte length is a spooled byte count,
// never inline content (FR34, C16); attempt count and duration parametrise the bounded
// reconnect backoff curve (FR29, C14); progress and total are the wire progress values
// enforced monotonic per token (FR15, C7). Exact bounds are provisional plan constants.

package mcp.shared

// SchemaVersion mirrors the EventV2 durable.version counter on a durable mcp.* event (FR38, C3).
#SchemaVersion: uint & >=1

// Sequence is per-aggregate ordering of a coalesced resource update; no global order (FR23, C9).
#Sequence: uint & >=0

// PageIndex is the zero-based page counter of a cursor-paginated tools/list walk (FR10, C4).
#PageIndex: uint & >=0

// PageSize is the bounded per-page entry count of a paginated walk; plan constant (FR10, C4).
#PageSize: uint & >=1

// MaxPages is the max-page fail-closed bound of a paginated walk; plan constant (FR10, C4).
#MaxPages: uint & >=1

// ByteLength is a bounded spooled byte count on a preview/output descriptor (FR34, C16).
#ByteLength: uint & >=0

// AttemptCount is the bounded reconnect attempt counter under the backoff cap (FR29, C14).
#AttemptCount: uint & >=0

// DurationMillis is a bounded elapsed/backoff-delay millisecond value; plan constant (FR29, C14).
#DurationMillis: uint & >=0

// Progress is the wire progress value enforced monotonic per progress token (FR15, C7).
#Progress: number & >=0

// Total is the optional server-declared total a progress value advances toward (FR16, C7).
#Total: number & >=0
