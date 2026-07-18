export * as Capability from "./capability"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

// Mirrors doc/arch/schemas/routing/capability.cue and descriptors.cue.
//
// RECONCILIATION NOTE: capability.cue imports its identity primitives from
// "routing/ids" (#ProviderName, #ModelId, #VariantName, #ApiFamily) and
// versions.cue (#Timestamp), while descriptors.cue owns #CapabilityDimension,
// #Scope, #Reason, #Requirement. No packages/schema/src/routing/ids.ts exists
// yet, so the identity/descriptor primitives this module needs are defined
// locally below. When routing/ids.ts (and a routing/descriptors.ts) land,
// fold these into that module and re-export/import instead of redefining.

// --- Identity primitives (routing.shared, from ids.cue) ---

export const ProviderName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.ProviderName",
})
export type ProviderName = typeof ProviderName.Type

export const ModelId = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.ModelId",
})
export type ModelId = typeof ModelId.Type

export const VariantName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.VariantName",
})
export type VariantName = typeof VariantName.Type

export const ApiFamily = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.ApiFamily",
})
export type ApiFamily = typeof ApiFamily.Type

// --- Shared descriptive primitives (routing.shared, from descriptors.cue) ---

export const Scope = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.Scope",
})
export type Scope = typeof Scope.Type

export const CapabilityDimensionName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.DimensionName",
})
export type CapabilityDimensionName = typeof CapabilityDimensionName.Type

export const Reason = Schema.String.annotate({ identifier: "Capability.Reason" })
export type Reason = typeof Reason.Type

export const Requirement = Schema.String.annotate({ identifier: "Capability.Requirement" })
export type Requirement = typeof Requirement.Type

// #Timestamp (routing.shared, from versions.cue): ISO 8601, non-empty string.
export const Timestamp = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "Capability.Timestamp",
})
export type Timestamp = typeof Timestamp.Type

// --- #ToolCapabilityValue: bool | uint | null ---

export const ToolCapabilityValue = Schema.Union([Schema.Boolean, NonNegativeInt, Schema.Null]).annotate({
  identifier: "Capability.ToolCapabilityValue",
})
export type ToolCapabilityValue = typeof ToolCapabilityValue.Type

// --- #ToolCallDimensions: the seven capability dimensions, each nullable ---

export interface ToolCallDimensions extends Schema.Schema.Type<typeof ToolCallDimensions> {}
export const ToolCallDimensions = Schema.Struct({
  tool_call_present: Schema.NullOr(Schema.Boolean),
  max_calls_per_turn: Schema.NullOr(NonNegativeInt),
  same_turn_multiple_calls: Schema.NullOr(Schema.Boolean),
  serial_runner_execution: Schema.NullOr(Schema.Boolean),
  parallel_calls: Schema.NullOr(Schema.Boolean),
  continuation_after_tool_result: Schema.NullOr(Schema.Boolean),
  multi_turn_cycles: Schema.NullOr(Schema.Boolean),
}).annotate({ identifier: "Capability.ToolCallDimensions" })

// --- #CapabilitySource ---

export const Source = Schema.Literals(["catalog", "override", "observed"]).annotate({
  identifier: "Capability.Source",
})
export type Source = typeof Source.Type

// --- #CapabilityIdentity ---

export interface Identity extends Schema.Schema.Type<typeof Identity> {}
export const Identity = Schema.Struct({
  provider: ProviderName,
  model: ModelId,
  variant: VariantName,
  api: ApiFamily,
}).annotate({ identifier: "Capability.Identity" })

// --- #CapabilityAssessment ---

export const Confidence = Schema.Number.annotate({ identifier: "Capability.Confidence" }).check(
  Schema.isGreaterThanOrEqualTo(0.0),
  Schema.isLessThanOrEqualTo(1.0),
)
export type Confidence = typeof Confidence.Type

export interface Assessment extends Schema.Schema.Type<typeof Assessment> {}
export const Assessment = Schema.Struct({
  dimensions: ToolCallDimensions,
  source: Source,
  confidence: Confidence,
}).annotate({ identifier: "Capability.Assessment" })

// --- #CapabilityFreshness ---

export const TtlMs = Schema.Int.check(Schema.isGreaterThan(0)).annotate({
  identifier: "Capability.TtlMs",
})
export type TtlMs = typeof TtlMs.Type

export interface Freshness extends Schema.Schema.Type<typeof Freshness> {}
export const Freshness = Schema.Struct({
  timestamp: Timestamp,
  ttl_ms: TtlMs,
  scope: Scope,
}).annotate({ identifier: "Capability.Freshness" })

// --- #CapabilityRecord ---

export interface Record extends Schema.Schema.Type<typeof Record> {}
export const Record = Schema.Struct({
  identity: Identity,
  assessment: Assessment,
  freshness: Freshness,
}).annotate({ identifier: "Capability.Record" })

// --- #CapabilityMismatch ---

export const MismatchOutcome = Schema.Literals(["hard_gate_reject", "serialization", "fallback"]).annotate({
  identifier: "Capability.MismatchOutcome",
})
export type MismatchOutcome = typeof MismatchOutcome.Type

export interface Mismatch extends Schema.Schema.Type<typeof Mismatch> {}
export const Mismatch = Schema.Struct({
  dimension: CapabilityDimensionName,
  requirement: Requirement,
  candidate_value: ToolCapabilityValue,
  reason: Reason,
  scope: Scope,
  outcome: MismatchOutcome,
}).annotate({ identifier: "Capability.Mismatch" })
