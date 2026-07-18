export * as ModelDescriptor from "./model-descriptor"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/model-parts.cue and model-descriptor.cue
// one-to-one. SemanticModelDescriptor is a Feature 006 SSOT aggregate for one
// embedding or rerank model at a provider (FR28); Feature 007 references the schema
// without diverging the field set. A descriptor embeds NO secret (FR35, C19).
// Dimension/normalization/metric are captured from the deterministic
// `/v1/embeddings` probe and stored, never inferred (FR12, FR30, C5, C7). Rerank
// capability is NEVER inferred from a model name; a manual descriptor is untrusted
// until native probe/eval passes (FR30, C16, AC22). Rerank profile C
// (embedding-similarity) is a DISTINCT capability and never reranker-eligible.

// ModelIdentity carries the display name, source, endpoint mode and any rerank profile (FR28, FR30).
export const ModelIdentity = Schema.Struct({
  display_name: TextValues.DisplayName,
  source: Enums.ModelSource,
  endpoint_mode: Enums.EndpointMode,
  rerank_profile: Schema.NullOr(Enums.RerankProfile),
}).annotate({ identifier: "SemanticModel.ModelIdentity" })
export type ModelIdentity = Schema.Schema.Type<typeof ModelIdentity>

// CapabilityKindSet is the first-class collection of validated capability kinds (FR30, C16).
export const CapabilityKindSet = Schema.Array(Enums.CapabilityKind).annotate({
  identifier: "SemanticModel.CapabilityKindSet",
})
export type CapabilityKindSet = typeof CapabilityKindSet.Type

// ModelLimits carries the server-capped probe limits; null when unknown (FR30, C5, AC23).
export const ModelLimits = Schema.Struct({
  batch_size: Schema.NullOr(Values.BatchSize),
  vector_count: Schema.NullOr(Values.VectorCount),
  token_limit: Schema.NullOr(Values.TokenBudget),
}).annotate({ identifier: "SemanticModel.ModelLimits" })
export type ModelLimits = Schema.Schema.Type<typeof ModelLimits>

// ModelCapability carries the capability kinds, stored dimension, metric and limits (FR12, FR30, C7).
export const ModelCapability = Schema.Struct({
  kinds: CapabilityKindSet,
  dimension: Schema.NullOr(Values.Dimension),
  metric: Schema.NullOr(Enums.Metric),
  normalized: Schema.NullOr(TextValues.Normalized),
  limits: ModelLimits,
}).annotate({ identifier: "SemanticModel.ModelCapability" })
export type ModelCapability = Schema.Schema.Type<typeof ModelCapability>

// ModelValidation carries the probe/eval trust state, provenance, time and eval version (FR30, C16, AC22).
export const ModelValidation = Schema.Struct({
  status: Enums.ValidationStatus,
  provenance: TextValues.Reason,
  validated_at: Schema.NullOr(TextValues.Timestamp),
  eval_version: Schema.NullOr(Values.ConfigVersion),
}).annotate({ identifier: "SemanticModel.ModelValidation" })
export type ModelValidation = Schema.Schema.Type<typeof ModelValidation>

// SemanticModelDescriptor is the SSOT aggregate root of a model; id is its canonical model ref (FR28, C3).
export const SemanticModelDescriptor = Schema.Struct({
  id: Ids.ModelDescriptorId,
  provider_ref: Refs.ProviderRef,
  identity: ModelIdentity,
  capability: ModelCapability,
  validation: ModelValidation,
  enabled: TextValues.Enabled,
}).annotate({ identifier: "SemanticModel.SemanticModelDescriptor" })
export type SemanticModelDescriptor = Schema.Schema.Type<typeof SemanticModelDescriptor>
