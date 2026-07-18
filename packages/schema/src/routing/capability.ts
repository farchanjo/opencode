export * as Capability from "./capability"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"
import { Ids } from "./ids"

// Mirrors doc/arch/schemas/routing/capability.cue and descriptors.cue.
//
// capability.cue imports its identity primitives from "routing/ids"
// (#ProviderName, #ModelId, #VariantName, #ApiFamily), versions.cue
// (#Timestamp), and descriptors.cue (#CapabilityDimension, #Scope, #Reason,
// #Requirement). This module re-exports those ValueObjects from routing/ids.ts
// (their single owner) under the member names its structs and consumers use,
// so the primitives are no longer duplicated here.

// --- Identity + descriptive primitives (re-exported from routing/ids.ts) ---

export const ProviderName = Ids.ProviderName
export type ProviderName = typeof ProviderName.Type

export const ModelId = Ids.ModelId
export type ModelId = typeof ModelId.Type

export const VariantName = Ids.VariantName
export type VariantName = typeof VariantName.Type

export const ApiFamily = Ids.ApiFamily
export type ApiFamily = typeof ApiFamily.Type

export const Scope = Ids.Scope
export type Scope = typeof Scope.Type

export const CapabilityDimensionName = Ids.CapabilityDimension
export type CapabilityDimensionName = typeof CapabilityDimensionName.Type

export const Reason = Ids.Reason
export type Reason = typeof Reason.Type

export const Requirement = Ids.Requirement
export type Requirement = typeof Requirement.Type

export const Timestamp = Ids.Timestamp
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
