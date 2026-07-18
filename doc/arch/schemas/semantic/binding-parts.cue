// DDD role: ValueObject
// Package: semantic.binding
// Cohesive sub-objects composed by the SemanticModelBinding aggregate, plus the
// runtime BindingStatus read model (FR28, FR31). The capability contract stores the
// effective dimension/metric so incompatible vectors are never mixed in one search
// space (FR12, C12). Selection records the operator, time and config version/hash
// that invalidate caches (FR25, C10). BindingStatus carries the degraded/unavailable
// state with a typed reason and never auto-substitutes a model (FR24, FR31, C20).

package semantic.binding

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// BindingRefs carries the provider ref, model ref and rerank compatibility mode (FR28, FR30).
#BindingRefs: {
	provider_ref:   ids.#ProviderRef
	model_ref:      ids.#ModelRef
	rerank_profile: enums.#RerankProfile | null
}

// CapabilityContract carries the effective capability kind, dimension, metric and normalization (FR12, FR30, C7).
#CapabilityContract: {
	kind:       enums.#CapabilityKind
	dimension:  values.#Dimension | null
	metric:     enums.#Metric | null
	normalized: ids.#Normalized | null
}

// BindingSelection carries the selecting operator, selection time and config version/hash (FR28, FR31, C10).
#BindingSelection: {
	selected_by:    ids.#OperatorRef
	selected_at:    ids.#Timestamp
	config_version: values.#ConfigVersion
	config_hash:    ids.#ConfigHash
}

// BindingGeneration carries the bound index generation, its aliases and generation state (FR12, C12).
#BindingGeneration: {
	generation_id: ids.#GenerationId
	aliases:       ids.#AliasRefSet
	state:         enums.#GenerationState
}

// BindingStatus is the runtime read model of a slot; degraded/unavailable never auto-substitutes (FR24, FR31, C20).
#BindingStatus: {
	slot:            enums.#Slot
	state:           enums.#BindingState
	version:         values.#BindingVersion
	degraded_reason: ids.#DegradedReason | null
}
