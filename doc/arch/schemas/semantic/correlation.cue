// DDD role: ValueObject
// Package: semantic.shared
// Correlation and telemetry-span ValueObjects carried on semantic.* events and the
// route/retrieval decision. Trace and span ids live in traces/logs only and are
// never a metric label (FR42, ADR-0001, C22). The routing decision id is a Feature
// 001 parity ref so a retrieval span links to its route span without content (FR41).

package semantic.shared

// CorrelationId groups related semantic.* events across one logical retrieval or reindex (C22).
#CorrelationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CausationId references the event that directly caused this one (C22).
#CausationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// TraceId correlates a semantic.* span; lives in traces/logs only, never a metric label (C22).
#TraceId: string & !~"^$"

// SpanId correlates a semantic.* span; lives in traces/logs only, never a metric label (C22).
#SpanId: string & !~"^$"

// DecisionId references a Feature 001 routing.decision the retrieval fed — parity id (FR41).
#DecisionId: string & =~"^[0-9A-HJKMNP-TV-Z]{26}$"
