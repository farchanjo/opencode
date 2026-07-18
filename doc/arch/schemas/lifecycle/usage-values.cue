// DDD role: ValueObject
// Package: lifecycle.shared
// Usage, timing, rate and output-reference ValueObjects (C21, C20).

package lifecycle.shared

// TokenCount is a known token count; unknown fields are absent, never summed (C21).
#TokenCount: uint & >=0

// CostUsd is a non-negative monetary amount.
#CostUsd: float & >=0.0

// ElapsedMs is monotonic elapsed time — the only valid tokens/s denominator (C21).
#ElapsedMs: uint & >=0

// DurationMs measures TTFT, stream and total durations (FR26).
#DurationMs: uint & >=0

// TokensPerSecond is valid only from monotonic elapsed and known token counts (C21).
#TokensPerSecond: float & >=0.0

// OutputRef is a bounded reference; Feature 005 owns content-plane bytes (C20).
#OutputRef: string & !~"^$"

// Cursor is a bounded output cursor; complete output is never loaded by default (FR58).
#Cursor: string & !~"^$"

// Confidence is a unit-interval evidence confidence for Smart Routing (C18).
#Confidence: float & >=0.0 & <=1.0
