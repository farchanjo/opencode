export * as Correlation from "./correlation"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/correlation.cue (package
// outputspool.shared) one-to-one. Correlation, principal and reference-edge
// ValueObjects carry opaque handles only; secrets are never raw values and no
// field is a filesystem path (FR12, FR28, Security 5, C5, C22). The reference
// edges gate ref-aware retention: a group is reclaimable only when it holds no
// inbound edge (C5). Same annotate-before-check-then-brand discipline as ./ids.

const idPattern = /^[A-Za-z0-9_-]{1,128}$/

// CorrelationId groups related output.* events across a logical settlement (C20).
export const CorrelationId = Schema.String.annotate({ identifier: "OutputSpoolIds.CorrelationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.CorrelationId"))
export type CorrelationId = typeof CorrelationId.Type

// CausationId references the event that directly caused this one (C20).
export const CausationId = Schema.String.annotate({ identifier: "OutputSpoolIds.CausationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.CausationId"))
export type CausationId = typeof CausationId.Type

// Principal is the operator/system/manager principal re-evaluated per action; a raw
// OutputRef is never a saved resource (FR47, FR48, C7).
export const Principal = Schema.String.annotate({ identifier: "OutputSpoolIds.Principal" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.Principal"))
export type Principal = typeof Principal.Type

// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR5, C22).
export const SecretRef = Schema.String.annotate({ identifier: "OutputSpoolIds.SecretRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.SecretRef"))
export type SecretRef = typeof SecretRef.Type

// TranscriptRef is an inbound retention edge from a durable transcript reference (FR33, C5).
export const TranscriptRef = Schema.String.annotate({ identifier: "OutputSpoolIds.TranscriptRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.TranscriptRef"))
export type TranscriptRef = typeof TranscriptRef.Type

// TodoRef is an inbound retention edge from Feature 002 Todo evidence (FR32, C5).
export const TodoRef = Schema.String.annotate({ identifier: "OutputSpoolIds.TodoRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.TodoRef"))
export type TodoRef = typeof TodoRef.Type

// HandoffRef is an inbound retention edge from a handoff envelope (FR32, FR34, C5).
export const HandoffRef = Schema.String.annotate({ identifier: "OutputSpoolIds.HandoffRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.HandoffRef"))
export type HandoffRef = typeof HandoffRef.Type

// NotificationRef is an inbound retention edge from a Feature 003 NotificationEnvelope output_ref (FR39, C5).
export const NotificationRef = Schema.String.annotate({ identifier: "OutputSpoolIds.NotificationRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.NotificationRef"))
export type NotificationRef = typeof NotificationRef.Type

// RowTelemetryRef is an inbound retention edge from a Feature 002 RowTelemetry.output_ref (FR38, C5).
export const RowTelemetryRef = Schema.String.annotate({ identifier: "OutputSpoolIds.RowTelemetryRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.RowTelemetryRef"))
export type RowTelemetryRef = typeof RowTelemetryRef.Type
