export * as TextValues from "./text-values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/text-values.cue one-to-one. Bounded
// content-classified text, flag and timestamp ValueObjects exclude file text,
// diffs, prompts, messages, paths, snippets and secrets (FR5, FR12, FR33,
// Security 5, C22). A language tag is Feature 004 provenance metadata on a
// textual channel, never re-computed content (FR40, C8). Each string base is
// annotated BEFORE its check for contract hygiene.

// Canonical BCP 47 provenance tag: language, optional script, optional region (FR40, C8).
const languageTagPattern = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/

// ContentType is the bounded media type of a channel; classification, not content (FR16).
export const ContentType = Schema.String.annotate({ identifier: "OutputSpoolValues.ContentType" }).check(
  Schema.isNonEmpty(),
)
export type ContentType = typeof ContentType.Type

// IntegrityTag is the opaque cursor/seal integrity tag; codec is a plan constant (FR17, C14, C18).
export const IntegrityTag = Schema.String.annotate({ identifier: "OutputSpoolValues.IntegrityTag" }).check(
  Schema.isNonEmpty(),
)
export type IntegrityTag = typeof IntegrityTag.Type

// LanguageTag is a canonical BCP 47 provenance tag on a textual channel (FR40, C8).
export const LanguageTag = Schema.String.annotate({ identifier: "OutputSpoolValues.LanguageTag" }).check(
  Schema.isPattern(languageTagPattern),
)
export type LanguageTag = typeof LanguageTag.Type

// Reason is a bounded human-readable explanation on a record or event; no content (Security 5).
export const Reason = Schema.String.annotate({ identifier: "OutputSpoolValues.Reason" })
export type Reason = typeof Reason.Type

// TraceId correlates an output.* span; lives in traces/logs only, never a metric label (C22).
export const TraceId = Schema.String.annotate({ identifier: "OutputSpoolValues.TraceId" }).check(Schema.isNonEmpty())
export type TraceId = typeof TraceId.Type

// SpanId correlates an output.* span; lives in traces/logs only, never a metric label (C22).
export const SpanId = Schema.String.annotate({ identifier: "OutputSpoolValues.SpanId" }).check(Schema.isNonEmpty())
export type SpanId = typeof SpanId.Type

// CaughtUp signals an open-stream reader consumed through committed end without eof (FR21).
export const CaughtUp = Schema.Boolean.annotate({ identifier: "OutputSpoolValues.CaughtUp" })
export type CaughtUp = typeof CaughtUp.Type

// Eof is true only when the channel is sealed or aborted and consumed through committed end (FR21, C20).
export const Eof = Schema.Boolean.annotate({ identifier: "OutputSpoolValues.Eof" })
export type Eof = typeof Eof.Type

// Disposable marks a channel eligible for OS-tmp with no recovery guarantee (FR11, C2).
export const Disposable = Schema.Boolean.annotate({ identifier: "OutputSpoolValues.Disposable" })
export type Disposable = typeof Disposable.Type
