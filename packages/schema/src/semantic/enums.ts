export * as Enums from "./enums"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/enums.cue (package semantic.enums) one-to-one
// for the core bounded enums — binding slot, transport/rerank compatibility
// profiles, endpoint mode, consistency level, capability kind, distance metric,
// index type, model source and validation status (FR12, FR28, FR30, C3, C6, C7,
// C16). Rerank profile C (embedding-similarity) is a DISTINCT capability and never
// reranker-eligible (FR30, C16). Every enum is a ValueObject (calisthenics).
// Lifecycle/scope enums live in ./enums-state, event-envelope enums in
// ./enums-event, and the closed semantic.* vocabulary in ./event-types.

// Slot is the operator-pinned binding slot; each slot pins exactly one model (FR6, FR28, C3).
export const Slot = Schema.Literals(["embedding", "reranker"]).annotate({ identifier: "SemanticEnums.Slot" })
export type Slot = typeof Slot.Type

// TransportProfile is the provider transport contract; the OpenAI-compatible client is reused (FR29, C5).
export const TransportProfile = Schema.Literals(["openai-compatible", "custom"]).annotate({
  identifier: "SemanticEnums.TransportProfile",
})
export type TransportProfile = typeof TransportProfile.Type

// RerankProfile is the explicit rerank contract; embedding-similarity is never reranker-eligible (FR30, C16).
export const RerankProfile = Schema.Literals(["native-rerank", "structured-chat", "embedding-similarity"]).annotate({
  identifier: "SemanticEnums.RerankProfile",
})
export type RerankProfile = typeof RerankProfile.Type

// EndpointMode is the invoked endpoint shape of a model descriptor (FR30, C5).
export const EndpointMode = Schema.Literals(["embeddings", "rerank", "chat-completions"]).annotate({
  identifier: "SemanticEnums.EndpointMode",
})
export type EndpointMode = typeof EndpointMode.Type

// Consistency is the search consistency level; bounded-staleness default, strong for admin reads (FR20, C6).
export const Consistency = Schema.Literals(["bounded", "strong"]).annotate({ identifier: "SemanticEnums.Consistency" })
export type Consistency = typeof Consistency.Type

// CapabilityKind is a validated model capability; a ranking signal, never authority (FR30, C16).
export const CapabilityKind = Schema.Literals([
  "embedding",
  "reranker",
  "embedding-similarity",
  "multilingual",
]).annotate({ identifier: "SemanticEnums.CapabilityKind" })
export type CapabilityKind = typeof CapabilityKind.Type

// Metric is the stored distance metric on normalized vectors (cosine / inner-product) (FR12, C7).
export const Metric = Schema.Literals(["cosine", "inner-product"]).annotate({ identifier: "SemanticEnums.Metric" })
export type Metric = typeof Metric.Type

// IndexType is the dense index family; HNSW is the V1 default, IVF a plan-tunable alternative (FR12, C7).
export const IndexType = Schema.Literals(["hnsw", "ivf"]).annotate({ identifier: "SemanticEnums.IndexType" })
export type IndexType = typeof IndexType.Type

// ModelSource records how a descriptor was obtained (FR28, C3).
export const ModelSource = Schema.Literals(["discovered", "manual", "core-catalog"]).annotate({
  identifier: "SemanticEnums.ModelSource",
})
export type ModelSource = typeof ModelSource.Type

// ValidationStatus is the probe/eval trust state; manual declarations are untrusted until validated (FR30, C16, AC22).
export const ValidationStatus = Schema.Literals(["validated", "declared", "failed", "stale"]).annotate({
  identifier: "SemanticEnums.ValidationStatus",
})
export type ValidationStatus = typeof ValidationStatus.Type
