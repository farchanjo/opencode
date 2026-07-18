export * as Binding from "./binding"

import { Schema } from "effect"
import { Collections } from "./collections"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/binding-parts.cue and binding.cue one-to-one.
// SemanticModelBinding is a Feature 006 SSOT aggregate pinning one model to one slot
// (FR28). Its id is the binding_id; the version is immutable and bindings persist
// across sessions/restarts/resume/jobs until an operator changes them via Feature
// 007 (FR31). No LLM/router/agent/plugin/MCP sets, updates, or deletes a binding
// (FR31, C3, C15). The effective embedding dimension/metric is bound to the index
// generation and never mixed (FR12, C12). BindingStatus is the runtime read model:
// the degraded/unavailable state carries a typed reason and never auto-substitutes
// another model (FR24, FR31, C20).

// BindingRefs carries the provider ref, model ref and rerank compatibility mode (FR28, FR30).
export const BindingRefs = Schema.Struct({
  provider_ref: Refs.ProviderRef,
  model_ref: Refs.ModelRef,
  rerank_profile: Schema.NullOr(Enums.RerankProfile),
}).annotate({ identifier: "SemanticBinding.BindingRefs" })
export type BindingRefs = Schema.Schema.Type<typeof BindingRefs>

// CapabilityContract carries the effective capability kind, dimension, metric and normalization (FR12, FR30, C7).
export const CapabilityContract = Schema.Struct({
  kind: Enums.CapabilityKind,
  dimension: Schema.NullOr(Values.Dimension),
  metric: Schema.NullOr(Enums.Metric),
  normalized: Schema.NullOr(TextValues.Normalized),
}).annotate({ identifier: "SemanticBinding.CapabilityContract" })
export type CapabilityContract = Schema.Schema.Type<typeof CapabilityContract>

// BindingSelection carries the selecting operator, selection time and config version/hash (FR28, FR31, C10).
export const BindingSelection = Schema.Struct({
  selected_by: Refs.OperatorRef,
  selected_at: TextValues.Timestamp,
  config_version: Values.ConfigVersion,
  config_hash: TextValues.ConfigHash,
}).annotate({ identifier: "SemanticBinding.BindingSelection" })
export type BindingSelection = Schema.Schema.Type<typeof BindingSelection>

// BindingGeneration carries the bound index generation, its aliases and generation state (FR12, C12).
export const BindingGeneration = Schema.Struct({
  generation_id: Ids.GenerationId,
  aliases: Collections.AliasRefSet,
  state: EnumsState.GenerationState,
}).annotate({ identifier: "SemanticBinding.BindingGeneration" })
export type BindingGeneration = Schema.Schema.Type<typeof BindingGeneration>

// BindingStatus is the runtime read model of a slot; degraded/unavailable never auto-substitutes (FR24, FR31, C20).
export const BindingStatus = Schema.Struct({
  slot: Enums.Slot,
  state: EnumsState.BindingState,
  version: Values.BindingVersion,
  degraded_reason: Schema.NullOr(TextValues.DegradedReason),
}).annotate({ identifier: "SemanticBinding.BindingStatus" })
export type BindingStatus = Schema.Schema.Type<typeof BindingStatus>

// SemanticModelBinding is the SSOT aggregate root of a pinned slot; id is its binding id (FR28, C12).
export const SemanticModelBinding = Schema.Struct({
  id: Ids.BindingId,
  slot: Enums.Slot,
  version: Values.BindingVersion,
  refs: BindingRefs,
  capability: CapabilityContract,
  selection: BindingSelection,
  generation: BindingGeneration,
}).annotate({ identifier: "SemanticBinding.SemanticModelBinding" })
export type SemanticModelBinding = Schema.Schema.Type<typeof SemanticModelBinding>
