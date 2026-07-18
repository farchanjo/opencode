// DDD role: ValueObject
// Package: semantic.model
// Cohesive sub-objects composed by the SemanticModelDescriptor aggregate (FR28). A
// dimension, normalization and metric are captured from the deterministic
// `/v1/embeddings` probe and stored, never inferred (FR12, FR30, C5, C7). Rerank
// profile C (embedding-similarity) is a DISTINCT capability kind and never
// reranker-eligible (FR30, C16). Limits are server-capped probe outputs (FR30, C5, AC23).

package semantic.model

import (
	"semantic/enums"
	"semantic/ids"
	"semantic/values"
)

// ModelIdentity carries the display name, source, endpoint mode and any rerank profile (FR28, FR30).
#ModelIdentity: {
	display_name:   ids.#DisplayName
	source:         enums.#ModelSource
	endpoint_mode:  enums.#EndpointMode
	rerank_profile: enums.#RerankProfile | null
}

// CapabilityKindSet is the first-class collection of validated capability kinds (FR30, C16).
#CapabilityKindSet: [...enums.#CapabilityKind]

// ModelLimits carries the server-capped probe limits; null when unknown (FR30, C5, AC23).
#ModelLimits: {
	batch_size:   values.#BatchSize | null
	vector_count: values.#VectorCount | null
	token_limit:  values.#TokenBudget | null
}

// ModelCapability carries the capability kinds, stored dimension, metric and limits (FR12, FR30, C7).
#ModelCapability: {
	kinds:      #CapabilityKindSet
	dimension:  values.#Dimension | null
	metric:     enums.#Metric | null
	normalized: ids.#Normalized | null
	limits:     #ModelLimits
}

// ModelValidation carries the probe/eval trust state, provenance, time and eval version (FR30, C16, AC22).
#ModelValidation: {
	status:       enums.#ValidationStatus
	provenance:   ids.#Reason
	validated_at: ids.#Timestamp | null
	eval_version: values.#ConfigVersion | null
}
