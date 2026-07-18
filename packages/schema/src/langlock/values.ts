export * as Values from "./values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/values.cue one-to-one. Version and
// bounded-count ValueObjects keep primitive obsession out of the aggregates.
// Versions are carried, not re-authored: Feature 007 Config.Service owns the CAS
// PolicyVersion and EventV2 owns the durable SchemaVersion (C2, C8).
//
// Each counter is built on the PLAIN `Schema.Number` base, annotated BEFORE any
// check, with `Schema.isInt()` folded into the check chain alongside the bound
// check. Annotating an already-checked schema (including `Schema.Int`) drops the
// root identifier from `.ast.annotations`, so base(plain)-then-check is
// load-bearing for contract hygiene (see test/contract-hygiene.test.ts).

// PolicyVersion is the Config.Service CAS/optimistic-concurrency version of a policy (FR5, FR7).
export const PolicyVersion = Schema.Number.annotate({ identifier: "LangLockValues.PolicyVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type PolicyVersion = typeof PolicyVersion.Type

// ConfigVersion is the config-document version captured into an execution envelope at start (FR7, C11).
export const ConfigVersion = Schema.Number.annotate({ identifier: "LangLockValues.ConfigVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type ConfigVersion = typeof ConfigVersion.Type

// SchemaVersion mirrors the EventV2 durable.version counter (C8).
export const SchemaVersion = Schema.Number.annotate({ identifier: "LangLockValues.SchemaVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type SchemaVersion = typeof SchemaVersion.Type

// Sequence is per-aggregate ordering for a durable langlock.* event; no global order (C8).
export const Sequence = Schema.Number.annotate({ identifier: "LangLockValues.Sequence" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Sequence = typeof Sequence.Type

// AdvisoryCount is a bounded advisory-violation count exported as a metric value (Observability, AC14).
export const AdvisoryCount = Schema.Number.annotate({ identifier: "LangLockValues.AdvisoryCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type AdvisoryCount = typeof AdvisoryCount.Type

// ExceptionCount is a bounded count of matched exception entries exported as a metric value (Observability, AC14).
export const ExceptionCount = Schema.Number.annotate({ identifier: "LangLockValues.ExceptionCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ExceptionCount = typeof ExceptionCount.Type
