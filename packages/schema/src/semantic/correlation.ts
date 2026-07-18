export * as Correlation from "./correlation"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/correlation.cue (package semantic.shared)
// one-to-one. Correlation and telemetry-span ValueObjects carried on semantic.*
// events and the route/retrieval decision. Trace and span ids live in traces/logs
// only and are never a metric label (FR42, ADR-0001, C22). The routing decision id
// is a Feature 001 parity ref so a retrieval span links to its route span without
// content (FR41). Same annotate-before-check-then-brand discipline as ./ids.
//
// This module is a dedicated mirror of correlation.cue (matching the
// outputspool/langlock precedent's own correlation.ts) rather than folding the
// correlation refs into ./refs, so the CUE package boundary is preserved one-to-one.

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/

// CorrelationId groups related semantic.* events across one logical retrieval or reindex (C22).
export const CorrelationId = Schema.String.annotate({ identifier: "SemanticCorrelation.CorrelationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.CorrelationId"))
export type CorrelationId = typeof CorrelationId.Type

// CausationId references the event that directly caused this one (C22).
export const CausationId = Schema.String.annotate({ identifier: "SemanticCorrelation.CausationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.CausationId"))
export type CausationId = typeof CausationId.Type

// TraceId correlates a semantic.* span; lives in traces/logs only, never a metric label (C22).
export const TraceId = Schema.String.annotate({ identifier: "SemanticCorrelation.TraceId" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.TraceId"))
export type TraceId = typeof TraceId.Type

// SpanId correlates a semantic.* span; lives in traces/logs only, never a metric label (C22).
export const SpanId = Schema.String.annotate({ identifier: "SemanticCorrelation.SpanId" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.SpanId"))
export type SpanId = typeof SpanId.Type

// DecisionId references a Feature 001 routing.decision the retrieval fed — parity id (FR41).
export const DecisionId = Schema.String.annotate({ identifier: "SemanticCorrelation.DecisionId" })
  .check(Schema.isPattern(ulidPattern))
  .pipe(Schema.brand("Semantic.DecisionId"))
export type DecisionId = typeof DecisionId.Type
