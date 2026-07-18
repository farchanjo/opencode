export * as Values from "./values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/values.cue one-to-one. Byte-offset,
// length, ordering and version-counter ValueObjects keep primitive obsession out
// of the aggregates. The canonical offset unit is uncompressed bytes (FR20, C15);
// the committed length is the control-store recovery authority, carried not
// re-authored (FR25, C12). Bounds are provisional plan constants (C3).
//
// Each counter is built on the PLAIN `Schema.Number` base, annotated BEFORE any
// check, with `Schema.isInt()` folded into the check chain alongside the bound
// check. Annotating an already-checked schema (including `Schema.Int`) drops the
// root identifier from `.ast.annotations`, so base(plain)-then-check is
// load-bearing for contract hygiene (see test/contract-hygiene.test.ts).

// ByteOffset is a zero-based uncompressed byte position; the canonical read unit (FR20, C15).
export const ByteOffset = Schema.Number.annotate({ identifier: "OutputSpoolValues.ByteOffset" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ByteOffset = typeof ByteOffset.Type

// ByteLength is a bounded uncompressed byte count (FR20, C3).
export const ByteLength = Schema.Number.annotate({ identifier: "OutputSpoolValues.ByteLength" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ByteLength = typeof ByteLength.Type

// CommittedBytes is the control-store committed-length authority for a generation (FR25, C12).
export const CommittedBytes = Schema.Number.annotate({ identifier: "OutputSpoolValues.CommittedBytes" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type CommittedBytes = typeof CommittedBytes.Type

// NextOffset is the byte offset a follow read resumes from (FR21, AC4).
export const NextOffset = Schema.Number.annotate({ identifier: "OutputSpoolValues.NextOffset" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type NextOffset = typeof NextOffset.Type

// PageLimit is the mandatory server-capped read page limit; provisional 1 MiB cap (FR20, C3, AC1).
export const PageLimit = Schema.Number.annotate({ identifier: "OutputSpoolValues.PageLimit" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type PageLimit = typeof PageLimit.Type

// QueueDepthBytes bounds the per-writer async queue; provisional cap (FR8, C3, AC5).
export const QueueDepthBytes = Schema.Number.annotate({ identifier: "OutputSpoolValues.QueueDepthBytes" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type QueueDepthBytes = typeof QueueDepthBytes.Type

// Sequence is per-aggregate ordering of a durable output.* event; no global order (C20).
export const Sequence = Schema.Number.annotate({ identifier: "OutputSpoolValues.Sequence" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Sequence = typeof Sequence.Type

// SchemaVersion mirrors the EventV2 durable.version counter (C20).
export const SchemaVersion = Schema.Number.annotate({ identifier: "OutputSpoolValues.SchemaVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type SchemaVersion = typeof SchemaVersion.Type

// Generation is the fencing generation; a new generation never overwrites its predecessor (FR14, FR27, C18).
export const Generation = Schema.Number.annotate({ identifier: "OutputSpoolValues.Generation" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Generation = typeof Generation.Type

// Attempt is the 1-based attempt index owned by the Feature 002 executor (C21).
export const Attempt = Schema.Number.annotate({ identifier: "OutputSpoolValues.Attempt" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type Attempt = typeof Attempt.Type
