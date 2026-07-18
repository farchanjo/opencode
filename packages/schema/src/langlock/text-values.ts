export * as TextValues from "./text-values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/text-values.cue one-to-one. Bounded text,
// flag and timestamp ValueObjects exclude file text, diffs, prompts, messages,
// paths, snippets and secrets (NFR Privacy, Security 5). Each string base is
// annotated BEFORE its check for contract hygiene.

// DisplayName is the human/native language name shown in pickers; never a technical tag (FR4, C13).
export const DisplayName = Schema.String.annotate({ identifier: "LangLockValues.DisplayName" }).check(
  Schema.isNonEmpty(),
)
export type DisplayName = typeof DisplayName.Type

// Reason is a bounded human-readable explanation on a record or event; never content (Security 5).
export const Reason = Schema.String.annotate({ identifier: "LangLockValues.Reason" })
export type Reason = typeof Reason.Type

// Timestamp is an ISO 8601 instant carried where a string form is required (mirrors CUE #Timestamp).
export const Timestamp = Schema.String.annotate({ identifier: "LangLockValues.Timestamp" }).check(Schema.isNonEmpty())
export type Timestamp = typeof Timestamp.Type

// TraceId correlates a langlock.* span; lives in traces/logs only, never a metric label (C8, Observability).
export const TraceId = Schema.String.annotate({ identifier: "LangLockValues.TraceId" }).check(Schema.isNonEmpty())
export type TraceId = typeof TraceId.Type

// SpanId correlates a langlock.* span; lives in traces/logs only, never a metric label (C8, Observability).
export const SpanId = Schema.String.annotate({ identifier: "LangLockValues.SpanId" }).check(Schema.isNonEmpty())
export type SpanId = typeof SpanId.Type

// Enabled flags whether Lang Lock is active for the resolved scope (FR1, FR7).
export const Enabled = Schema.Boolean.annotate({ identifier: "LangLockValues.Enabled" })
export type Enabled = typeof Enabled.Type

// OverrideAuthorized flags whether native operator policy permits a project override (FR5, Security 1).
export const OverrideAuthorized = Schema.Boolean.annotate({ identifier: "LangLockValues.OverrideAuthorized" })
export type OverrideAuthorized = typeof OverrideAuthorized.Type

// HardFloor flags whether the global policy pins a hard-policy floor a project cannot relax (FR5, C2).
export const HardFloor = Schema.Boolean.annotate({ identifier: "LangLockValues.HardFloor" })
export type HardFloor = typeof HardFloor.Type
