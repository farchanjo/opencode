export * as TextValues from "./text-values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/text-values.cue one-to-one for the bounded
// redacted text, flag and permission ValueObjects. All text axes exclude raw
// prompts, results, spool paths and secrets (FR22, FR32, Privacy). The CUE
// #Timestamp is not re-declared here — observational timestamps decode through
// the shared DateTimeUtcFromMillis per the schema-surface conventions.
//
// Identifiers stay in the shared JobsValues namespace (parity with values.ts);
// leaf names are disjoint, so contract-hygiene uniqueness holds.

// JobName is a non-empty human label for a definition (FR2).
export const JobName = Schema.String.annotate({ identifier: "JobsValues.JobName" }).check(Schema.isNonEmpty())
export type JobName = typeof JobName.Type

// JobDescription is a bounded redacted description; empty is valid (FR2).
export const JobDescription = Schema.String.annotate({ identifier: "JobsValues.JobDescription" })
export type JobDescription = typeof JobDescription.Type

// ActionTarget names a redacted target/action handle; never a shell literal (FR28, FR29).
export const ActionTarget = Schema.String.annotate({ identifier: "JobsValues.ActionTarget" }).check(
  Schema.isNonEmpty(),
)
export type ActionTarget = typeof ActionTarget.Type

// BoundedSummary is the bounded notification summary; never full content (FR22, AC29).
export const BoundedSummary = Schema.String.annotate({ identifier: "JobsValues.BoundedSummary" })
export type BoundedSummary = typeof BoundedSummary.Type

// Reason is a bounded human-readable explanation on a record or event.
export const Reason = Schema.String.annotate({ identifier: "JobsValues.Reason" })
export type Reason = typeof Reason.Type

// TraceId correlates a job.* span; lives in traces/logs only, never a label (C18).
export const TraceId = Schema.String.annotate({ identifier: "JobsValues.TraceId" }).check(Schema.isNonEmpty())
export type TraceId = typeof TraceId.Type

// SpanId correlates a job.* span; lives in traces/logs only, never a label (C18).
export const SpanId = Schema.String.annotate({ identifier: "JobsValues.SpanId" }).check(Schema.isNonEmpty())
export type SpanId = typeof SpanId.Type

// Enabled flags whether a Job Definition is active and eligible for registration (FR2, FR6).
export const Enabled = Schema.Boolean.annotate({ identifier: "JobsValues.Enabled" })
export type Enabled = typeof Enabled.Type

// PermissionSet is the first-class collection of allowlisted permission ids (FR29, C10).
export const PermissionSet = Schema.Array(Schema.String).annotate({ identifier: "JobsValues.PermissionSet" })
export type PermissionSet = typeof PermissionSet.Type
