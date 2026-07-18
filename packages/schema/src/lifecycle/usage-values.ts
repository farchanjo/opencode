export * as UsageValues from "./usage-values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/lifecycle/usage-values.cue one-to-one for the
// usage, timing, rate and output-reference ValueObjects (C21, C20), and
// doc/arch/schemas/lifecycle/text-values.cue for the trace-correlation ids
// (TraceId, SpanId) that live in traces/logs only, never a label (C18).
//
// ANNOTATION ORDER: see ./values.ts — annotate before check, brand after
// check, so the root identifier survives on `.ast.annotations`.

// TokenCount is a known token count; unknown fields are absent, never summed (C21).
export const TokenCount = Schema.Number.annotate({ identifier: "LifecycleUsageValues.TokenCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type TokenCount = typeof TokenCount.Type

// CostUsd is a non-negative monetary amount.
export const CostUsd = Schema.Number.annotate({ identifier: "LifecycleUsageValues.CostUsd" }).check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0.0),
)
export type CostUsd = typeof CostUsd.Type

// ElapsedMs is monotonic elapsed time — the only valid tokens/s denominator (C21).
export const ElapsedMs = Schema.Number.annotate({ identifier: "LifecycleUsageValues.ElapsedMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ElapsedMs = typeof ElapsedMs.Type

// DurationMs measures TTFT, stream and total durations (FR26).
export const DurationMs = Schema.Number.annotate({ identifier: "LifecycleUsageValues.DurationMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type DurationMs = typeof DurationMs.Type

// TokensPerSecond is valid only from monotonic elapsed and known token counts (C21).
export const TokensPerSecond = Schema.Number.annotate({
  identifier: "LifecycleUsageValues.TokensPerSecond",
}).check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0.0))
export type TokensPerSecond = typeof TokensPerSecond.Type

// TraceId correlates a lifecycle span; lives in traces/logs only, never a label (C18).
export const TraceId = Schema.String.annotate({ identifier: "LifecycleUsageValues.TraceId" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.TraceId"))
export type TraceId = typeof TraceId.Type

// SpanId correlates a lifecycle span; lives in traces/logs only, never a label (C18).
export const SpanId = Schema.String.annotate({ identifier: "LifecycleUsageValues.SpanId" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.SpanId"))
export type SpanId = typeof SpanId.Type

// OutputRef is a bounded reference; Feature 005 owns content-plane bytes (C20).
export const OutputRef = Schema.String.annotate({ identifier: "LifecycleUsageValues.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.OutputRef"))
export type OutputRef = typeof OutputRef.Type

// Cursor is a bounded output cursor; complete output is never loaded by default (FR58).
export const Cursor = Schema.String.annotate({ identifier: "LifecycleUsageValues.Cursor" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.Cursor"))
export type Cursor = typeof Cursor.Type

// Confidence is a unit-interval evidence confidence for Smart Routing (C18).
export const Confidence = Schema.Number.annotate({ identifier: "LifecycleUsageValues.Confidence" }).check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 1 }),
)
export type Confidence = typeof Confidence.Type
