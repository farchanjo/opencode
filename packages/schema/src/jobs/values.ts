export * as Values from "./values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/values.cue one-to-one for the ordering, version,
// budget and lag counter ValueObjects. Sequence/attempt/generation authority
// belongs to the canonical Feature 002 executor; these are the typed carriers,
// not a second authority (C6).
//
// Each ValueObject is built on the PLAIN `Schema.Number` base, annotated BEFORE
// any check, with `Schema.isInt()` folded into the check chain alongside the
// bound check. Annotating an already-checked schema (including `Schema.Int`)
// drops the root identifier from `.ast.annotations`, so base(plain)-then-check
// is load-bearing for contract hygiene (see test/contract-hygiene.test.ts).

// Sequence is per-aggregate ordering; no global order is implied (FR10, FR12).
export const Sequence = Schema.Number.annotate({ identifier: "JobsValues.Sequence" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Sequence = typeof Sequence.Type

// Attempt is the 1-based attempt index owned by the Feature 002 executor (C6).
export const Attempt = Schema.Number.annotate({ identifier: "JobsValues.Attempt" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type Attempt = typeof Attempt.Type

// Generation is the fencing generation carried in the idempotency tuple (C6).
export const Generation = Schema.Number.annotate({ identifier: "JobsValues.Generation" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Generation = typeof Generation.Type

// SchemaVersion mirrors the EventV2 durable.version counter (C8).
export const SchemaVersion = Schema.Number.annotate({ identifier: "JobsValues.SchemaVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type SchemaVersion = typeof SchemaVersion.Type

// Version is the Job Definition CAS/optimistic-concurrency version (FR2, FR6).
export const Version = Schema.Number.annotate({ identifier: "JobsValues.Version" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type Version = typeof Version.Type

// DeadlineMs bounds an occurrence deadline; provisional constant with hook AC12.
export const DeadlineMs = Schema.Number.annotate({ identifier: "JobsValues.DeadlineMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type DeadlineMs = typeof DeadlineMs.Type

// TimeoutMs bounds an occurrence execution timeout; provisional constant with hook AC12.
export const TimeoutMs = Schema.Number.annotate({ identifier: "JobsValues.TimeoutMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type TimeoutMs = typeof TimeoutMs.Type

// RetryBudget bounds retry/fallback attempts; no blind retry of mutations (FR14, C11).
export const RetryBudget = Schema.Number.annotate({ identifier: "JobsValues.RetryBudget" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type RetryBudget = typeof RetryBudget.Type

// Priority orders admission/fairness for a definition (FR18).
export const Priority = Schema.Number.annotate({ identifier: "JobsValues.Priority" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Priority = typeof Priority.Type

// ScheduleLagMs is lag measured from nominal due time (FR19, AC3, AC4).
export const ScheduleLagMs = Schema.Number.annotate({ identifier: "JobsValues.ScheduleLagMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ScheduleLagMs = typeof ScheduleLagMs.Type
