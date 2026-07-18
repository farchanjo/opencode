// DDD role: ValueObject
// Package: semantic.shared
// Score, component and confidence numeric ValueObjects. Exposed scores carry
// provenance/components/confidence without chain-of-thought (FR22); the semantic
// score stays separate from Feature 001 quality/telemetry score inputs (FR22). The
// rerank component is null when the reranker is unavailable and ranking proceeds
// without it (FR24, AC8). Fusion weights and edges are plan constants (C7, AC1, AC17).

package semantic.shared

// Score is a normalized composite retrieval score; provenance is carried alongside (FR22).
#Score: number & >=0.0

// RerankScore is the cross-encoder rerank component; the first tie-break key (FR19, C2).
#RerankScore: number

// DenseScore is the dense-recall component; the second tie-break key (FR19, C2, C7).
#DenseScore: number

// SparseScore is the sparse/lexical (BM25) component; the third tie-break key (FR19, C2, C7).
#SparseScore: number

// Confidence is a bounded retrieval confidence gating stale-score contribution (FR27, C11).
#Confidence: number & >=0.0 & <=1.0

// FreshnessAgeMs is the projection staleness age feeding the freshness bucket (FR27, C11, AC5).
#FreshnessAgeMs: uint & >=0
