// DDD role: ValueObject
// Package: semantic.retrieval
// RetrievalRequest, Candidate and SemanticScore — the request and result value objects
// of the immutable nine-stage pipeline (FR3, C2). Hybrid recall uses retrieval_top_k
// and rerank runs only on the reduced rerank_top_k set (FR19). Ties break by the stable
// total order rerank -> dense -> sparse -> canonical id (FR19, C2). A candidate carries
// a ranking pointer into live core state, never an embedded Entity, and is revalidated
// after retrieval (FR20, C11). The semantic score stays separate from Feature 001
// quality inputs (FR22).

package semantic.retrieval

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
	"semantic/profile"
)

// RetrievalRequest carries the profile, target collection, top_k windows and consistency (FR3, FR19, C8).
#RetrievalRequest: {
	profile:          profile.#TaskProfile
	collection:       enums.#Collection
	retrieval_top_k:  values.#TopK
	rerank_top_k:     values.#TopK
	consistency:      enums.#Consistency
	mode:             enums.#RetrievalMode
}

// ScoreComponents carries the rerank (nullable on outage), dense and sparse components (FR19, C2, AC8).
#ScoreComponents: {
	rerank: values.#RerankScore | null
	dense:  values.#DenseScore
	sparse: values.#SparseScore
}

// ScoreProvenance carries the degradation mode, gap and effective binding/generation (FR22, C20).
#ScoreProvenance: {
	mode:            enums.#RetrievalMode
	gap:             enums.#DegradationGap
	binding_version: values.#BindingVersion
	generation_id:   ids.#GenerationId
}

// SemanticScore carries the composite score, components, confidence and provenance (FR22).
#SemanticScore: {
	composite:  values.#Score
	components: #ScoreComponents
	confidence: values.#Confidence
	provenance: #ScoreProvenance
}

// Candidate carries a ranking pointer, collection, score, rank and freshness bucket (FR20, FR22, C11).
#Candidate: {
	candidate_ref: ids.#AgentRef | ids.#SkillRef
	collection:    enums.#Collection
	score:         #SemanticScore
	rank:          values.#TopK
	freshness:     enums.#FreshnessBucket
}

// CandidateList is the first-class collection of ranked candidates bounded by top_k (FR19, NFR3, C8).
#CandidateList: [...#Candidate]
