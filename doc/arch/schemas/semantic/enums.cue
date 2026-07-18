// DDD role: ValueObject
// Package: semantic.enums
// Core bounded enums for the Feature 006 semantic stack — binding slot, transport and
// rerank compatibility profiles, endpoint mode, consistency level, capability kind,
// distance metric, index type, model source and validation status (FR12, FR28, FR30,
// C3, C6, C7, C16). Rerank profile C (embedding-similarity) is a DISTINCT capability
// and never reranker-eligible (FR30, C16). Every enum is a ValueObject (calisthenics).

package semantic.enums

// Slot is the operator-pinned binding slot; each slot pins exactly one model (FR6, FR28, C3).
#Slot: "embedding" | "reranker"

// TransportProfile is the provider transport contract; the OpenAI-compatible client is reused (FR29, C5).
#TransportProfile: "openai-compatible" | "custom"

// RerankProfile is the explicit rerank contract; embedding-similarity is never reranker-eligible (FR30, C16).
#RerankProfile: "native-rerank" | "structured-chat" | "embedding-similarity"

// EndpointMode is the invoked endpoint shape of a model descriptor (FR30, C5).
#EndpointMode: "embeddings" | "rerank" | "chat-completions"

// Consistency is the search consistency level; bounded-staleness default, strong for admin reads (FR20, C6).
#Consistency: "bounded" | "strong"

// CapabilityKind is a validated model capability; a ranking signal, never authority (FR30, C16).
#CapabilityKind: "embedding" | "reranker" | "embedding-similarity" | "multilingual"

// Metric is the stored distance metric on normalized vectors (cosine / inner-product) (FR12, C7).
#Metric: "cosine" | "inner-product"

// IndexType is the dense index family; HNSW is the V1 default, IVF a plan-tunable alternative (FR12, C7).
#IndexType: "hnsw" | "ivf"

// ModelSource records how a descriptor was obtained (FR28, C3).
#ModelSource: "discovered" | "manual" | "core-catalog"

// ValidationStatus is the probe/eval trust state; manual declarations are untrusted until validated (FR30, C16, AC22).
#ValidationStatus: "validated" | "declared" | "failed" | "stale"
