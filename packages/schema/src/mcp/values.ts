export * as Values from "./values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/values.cue one-to-one. Numeric counter, bound and
// wire-value ValueObjects keep primitive obsession out of the aggregates. Page
// index/size and max-page are the cursor-pagination guard bounds (FR10, C4); byte
// length is a spooled byte count, never inline content (FR34, C16); attempt count and
// duration parametrise the bounded reconnect backoff curve (FR29, C14). Exact bounds
// are provisional plan constants (C4, C14).
//
// Each integer counter is built on the PLAIN `Schema.Number` base, annotated BEFORE
// any check, with `Schema.isInt()` folded into the check chain alongside the bound
// check. `Progress` and `Total` are deliberately REAL-valued (no `isInt`) because the
// wire progress value is fractional; they are enforced monotonic per token at the
// boundary, not by the schema (FR15, C7). Annotating an already-checked schema drops
// the root identifier, so base(plain)-then-check is load-bearing for contract hygiene.

// SchemaVersion mirrors the EventV2 durable.version counter on a durable mcp.* event (FR38, C3).
export const SchemaVersion = Schema.Number.annotate({ identifier: "McpValues.SchemaVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type SchemaVersion = typeof SchemaVersion.Type

// Sequence is per-aggregate ordering of a coalesced resource update; no global order (FR23, C9).
export const Sequence = Schema.Number.annotate({ identifier: "McpValues.Sequence" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Sequence = typeof Sequence.Type

// PageIndex is the zero-based page counter of a cursor-paginated tools/list walk (FR10, C4).
export const PageIndex = Schema.Number.annotate({ identifier: "McpValues.PageIndex" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type PageIndex = typeof PageIndex.Type

// PageSize is the bounded per-page entry count of a paginated walk; plan constant (FR10, C4).
export const PageSize = Schema.Number.annotate({ identifier: "McpValues.PageSize" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type PageSize = typeof PageSize.Type

// MaxPages is the max-page fail-closed bound of a paginated walk; plan constant (FR10, C4).
export const MaxPages = Schema.Number.annotate({ identifier: "McpValues.MaxPages" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type MaxPages = typeof MaxPages.Type

// ByteLength is a bounded spooled byte count on a preview/output descriptor (FR34, C16).
export const ByteLength = Schema.Number.annotate({ identifier: "McpValues.ByteLength" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ByteLength = typeof ByteLength.Type

// AttemptCount is the bounded reconnect attempt counter under the backoff cap (FR29, C14).
export const AttemptCount = Schema.Number.annotate({ identifier: "McpValues.AttemptCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type AttemptCount = typeof AttemptCount.Type

// DurationMillis is a bounded elapsed/backoff-delay millisecond value; plan constant (FR29, C14).
export const DurationMillis = Schema.Number.annotate({ identifier: "McpValues.DurationMillis" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type DurationMillis = typeof DurationMillis.Type

// Progress is the wire progress value enforced monotonic per progress token (FR15, C7).
export const Progress = Schema.Number.annotate({ identifier: "McpValues.Progress" }).check(
  Schema.isGreaterThanOrEqualTo(0),
)
export type Progress = typeof Progress.Type

// Total is the optional server-declared total a progress value advances toward (FR16, C7).
export const Total = Schema.Number.annotate({ identifier: "McpValues.Total" }).check(Schema.isGreaterThanOrEqualTo(0))
export type Total = typeof Total.Type
