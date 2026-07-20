// DDD role: ValueObject
// Package: semantic_lifecycle.generation
// The Milvus-composed embedding cutover/rollback and blue/green generation build
// (Feature 019, Group B). The cutover executor is already complete — cutover-executor.ts
// cutoverEmbedding/rollbackEmbedding are pure CAS decisions that then call
// deps.milvus.swapAliases — but the operator runtime binds createGrpcMilvusAdapter({})
// with NO gRPC client (stack-live.ts, every op reachable:false). Feature 019 binds a
// real MilvusPort and persisted generation/alias/CAS state when the endpoint is
// configured. CARDINAL HONESTY RULE (Feature 006 FR12/FR32): an embedding cutover is
// NEVER a config-only alias flip — a generation is physically built and validated in
// Milvus before the alias swaps. Unconfigured degrades to the exact typed
// milvus_unavailable floor. CUE packages are not cross-resolved by the structural reader.

package semantic_lifecycle.generation

import (
	"semantic-lifecycle/enums"
	"semantic-lifecycle/shared"
	"semantic-lifecycle/flags"
)

// MilvusEndpointBinding is the operator-runtime binding to a live Milvus endpoint; unconfigured yields the milvus_unavailable readiness and the typed gap floor (Group B).
#MilvusEndpointBinding: {
	address:   shared.#EndpointAddress
	secretRef?: shared.#SecretRef
	readiness: enums.#MilvusReadiness
	reason?:   shared.#ReasonText
}

// GenerationCollections is the first-class collection of Milvus collections a generation spans; they swap together under one CAS, never split across generations (Group B, Feature 006 C12).
#GenerationCollections: [...shared.#CollectionKind]

// IndexGeneration is one blue/green collection generation spanning every collection together; it walks building -> validated -> live under one CAS, never split across generations (Group B, Feature 006 C12).
#IndexGeneration: {
	generationId: shared.#GenerationId
	collections:  #GenerationCollections
	state:        enums.#GenerationState
}

// GenerationBuild is the physical build that must complete and validate in Milvus BEFORE an embedding alias swaps; a config-only flip is never a cutover (Group B, Feature 006 FR12/FR32).
#GenerationBuild: {
	generationId: shared.#GenerationId
	built:        flags.#GenerationBuilt
	validated:    flags.#CandidateValidated
	reason?:      shared.#ReasonText
}

// EmbeddingCutover is the honest embedding activation outcome: activated only after a built+validated generation and an operator-confirmed CAS swap, else a typed gate refusal (Group B).
#EmbeddingCutover: {
	slot:                     shared.#Slot & "embedding"
	generationId:             shared.#GenerationId
	casToken:                 shared.#CasToken
	confirmed:                flags.#OperatorConfirmed
	gate:                     enums.#CutoverGate
	invalidatedBindingVersion?: shared.#BindingVersion
	reason?:                  shared.#ReasonText
}
