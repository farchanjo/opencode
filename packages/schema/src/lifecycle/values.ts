export * as Values from "./values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/lifecycle/values.cue one-to-one for the ordering,
// version and fanout counters, and doc/arch/schemas/lifecycle/text-values.cue
// for the bounded redacted text ValueObjects reused across process rows and
// event details (Reason, Description, ActivityLabel).
//
// DEVIATION FROM data-model.md's illustrative snippet: rather than aliasing
// the shared `PositiveInt` / `NonNegativeInt` from ../schema directly, or
// building on `Schema.Int` (itself already `Schema.Number.check(isInt)`),
// each ValueObject below is built fresh on the PLAIN `Schema.Number` base,
// annotated BEFORE any check is applied, with `Schema.isInt()` folded into
// the check chain alongside the bound check. Annotating an already-checked
// schema (including `Schema.Int`, `PositiveInt`/`NonNegativeInt`) drops the
// root identifier from `.ast.annotations` in favor of annotating the last
// check instead, so base(plain)-then-check is load-bearing for contract
// hygiene (see test/contract-hygiene.test.ts and
// packages/schema/src/routing/ids.ts `Version` for the same pattern).

// --- values.cue ---

// Sequence is per-aggregate ordering; no global order is implied (FR10, C8).
export const Sequence = Schema.Number.annotate({ identifier: "LifecycleValues.Sequence" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Sequence = typeof Sequence.Type

// Attempt is the 1-based attempt index of a task_id (C8).
export const Attempt = Schema.Number.annotate({ identifier: "LifecycleValues.Attempt" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type Attempt = typeof Attempt.Type

// Generation is the fencing generation for handoff and reconciliation (C8, C16).
export const Generation = Schema.Number.annotate({ identifier: "LifecycleValues.Generation" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Generation = typeof Generation.Type

// SchemaVersion mirrors the EventV2 durable.version counter (C4).
export const SchemaVersion = Schema.Number.annotate({ identifier: "LifecycleValues.SchemaVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
)
export type SchemaVersion = typeof SchemaVersion.Type

// DelegationDepth is 0 at the root; Architect -> Manager -> Worker = depth 2 (C15).
export const DelegationDepth = Schema.Number.annotate({ identifier: "LifecycleValues.DelegationDepth" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type DelegationDepth = typeof DelegationDepth.Type

// FanoutCount counts requested or granted worker fanout (C11).
export const FanoutCount = Schema.Number.annotate({ identifier: "LifecycleValues.FanoutCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type FanoutCount = typeof FanoutCount.Type

// ItemCount is a bounded Todo item count observed by the row (C23).
export const ItemCount = Schema.Number.annotate({ identifier: "LifecycleValues.ItemCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ItemCount = typeof ItemCount.Type

// --- text-values.cue ---

// Reason is a bounded human-readable explanation on a record; empty is valid,
// mirroring the CUE #Reason unconstrained string (FR13).
export const Reason = Schema.String.annotate({ identifier: "LifecycleValues.Reason" })
export type Reason = typeof Reason.Type

// Description is a bounded redacted process description (FR28).
export const Description = Schema.String.annotate({ identifier: "LifecycleValues.Description" })
export type Description = typeof Description.Type

// ActivityLabel is the rendered form of an allowlisted ActivityKind (FR56).
export const ActivityLabel = Schema.String.annotate({ identifier: "LifecycleValues.ActivityLabel" }).check(
  Schema.isNonEmpty(),
)
export type ActivityLabel = typeof ActivityLabel.Type
