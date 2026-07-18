export * as Values from "./values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/values.cue, budget-values.cue and
// score-values.cue one-to-one. Version/dimension/budget counters keep primitive
// obsession out of the aggregates; an embedding dimension/normalization/metric is
// stored with the collection generation and never inferred (FR12, C12), and
// budget windows are consumed from the Feature 001 budget, never free-form (FR38,
// C8). Bounds are provisional plan constants (C7, C8).
//
// Each integer counter is built on the PLAIN `Schema.Number` base, annotated
// BEFORE any check, with `Schema.isInt()` folded into the check chain alongside the
// bound check. The score domain is deliberately REAL-valued: `Score`/`RerankScore`/
// `DenseScore`/`SparseScore` carry NO `isInt`, and `Confidence` is bounded to
// `[0,1]` (FR22, FR27). Annotating an already-checked schema drops the root
// identifier, so base(plain)-then-check is load-bearing for contract hygiene.

// --- values.cue: version/dimension/window counters ---------------------------

// BindingVersion is the immutable version counter of a SemanticModelBinding (FR28, FR31, C12).
export const BindingVersion = Schema.Number.annotate({ identifier: "SemanticValues.BindingVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type BindingVersion = typeof BindingVersion.Type

// SchemaVersion mirrors the EventV2 durable.version counter on a semantic.* event (C22).
export const SchemaVersion = Schema.Number.annotate({ identifier: "SemanticValues.SchemaVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type SchemaVersion = typeof SchemaVersion.Type

// ConfigVersion is the config generation a binding/cache was resolved under (FR25, C10).
export const ConfigVersion = Schema.Number.annotate({ identifier: "SemanticValues.ConfigVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type ConfigVersion = typeof ConfigVersion.Type

// Dimension is the stored embedding dimensionality of a collection generation (FR12, C7).
export const Dimension = Schema.Number.annotate({ identifier: "SemanticValues.Dimension" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type Dimension = typeof Dimension.Type

// Sequence is per-aggregate ordering of a durable semantic.* event; no global order (C22).
export const Sequence = Schema.Number.annotate({ identifier: "SemanticValues.Sequence" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type Sequence = typeof Sequence.Type

// ByteOffset is a zero-based offset into a Feature 005 chunk body ref (FR40, C9).
export const ByteOffset = Schema.Number.annotate({ identifier: "SemanticValues.ByteOffset" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ByteOffset = typeof ByteOffset.Type

// ByteLimit is the bounded page length read from a Feature 005 chunk body ref (FR40, C9).
export const ByteLimit = Schema.Number.annotate({ identifier: "SemanticValues.ByteLimit" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type ByteLimit = typeof ByteLimit.Type

// ChunkIndex is the zero-based position of a chunk within its parent skill body (FR11, C9).
export const ChunkIndex = Schema.Number.annotate({ identifier: "SemanticValues.ChunkIndex" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ChunkIndex = typeof ChunkIndex.Type

// ChunkOverlap is the fixed token overlap between adjacent chunks; plan constant (FR11, C9, AC12).
export const ChunkOverlap = Schema.Number.annotate({ identifier: "SemanticValues.ChunkOverlap" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ChunkOverlap = typeof ChunkOverlap.Type

// --- budget-values.cue: budget/probe-bound counters --------------------------

// TopK bounds a hybrid-recall or rerank window; consumed from the Feature 001 budget (FR19, FR38, C8).
export const TopK = Schema.Number.annotate({ identifier: "SemanticValues.TopK" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type TopK = typeof TopK.Type

// ChunkBudget is max_skill_chunks from the Feature 001 budget (FR38, FR39, C8).
export const ChunkBudget = Schema.Number.annotate({ identifier: "SemanticValues.ChunkBudget" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type ChunkBudget = typeof ChunkBudget.Type

// TokenBudget is the skill token budget from the Feature 001 budget (FR38, C8).
export const TokenBudget = Schema.Number.annotate({ identifier: "SemanticValues.TokenBudget" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type TokenBudget = typeof TokenBudget.Type

// BatchSize is the server-capped embedding-probe batch size; plan constant (FR30, C5, AC23).
export const BatchSize = Schema.Number.annotate({ identifier: "SemanticValues.BatchSize" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type BatchSize = typeof BatchSize.Type

// VectorCount is the server-capped per-request vector count for embedding (FR30, C5, AC23).
export const VectorCount = Schema.Number.annotate({ identifier: "SemanticValues.VectorCount" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type VectorCount = typeof VectorCount.Type

// LatencyBudgetMs is the retrieval latency budget; timeout triggers the C20 fallback (NFR1, C8).
export const LatencyBudgetMs = Schema.Number.annotate({ identifier: "SemanticValues.LatencyBudgetMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type LatencyBudgetMs = typeof LatencyBudgetMs.Type

// --- score-values.cue: REAL-valued score/component/confidence domain ---------

// Score is a normalized composite retrieval score; provenance is carried alongside (FR22).
export const Score = Schema.Number.annotate({ identifier: "SemanticValues.Score" }).check(
  Schema.isGreaterThanOrEqualTo(0),
)
export type Score = typeof Score.Type

// RerankScore is the cross-encoder rerank component; the first tie-break key (FR19, C2).
export const RerankScore = Schema.Number.annotate({ identifier: "SemanticValues.RerankScore" })
export type RerankScore = typeof RerankScore.Type

// DenseScore is the dense-recall component; the second tie-break key (FR19, C2, C7).
export const DenseScore = Schema.Number.annotate({ identifier: "SemanticValues.DenseScore" })
export type DenseScore = typeof DenseScore.Type

// SparseScore is the sparse/lexical (BM25) component; the third tie-break key (FR19, C2, C7).
export const SparseScore = Schema.Number.annotate({ identifier: "SemanticValues.SparseScore" })
export type SparseScore = typeof SparseScore.Type

// Confidence is a bounded [0,1] retrieval confidence gating stale-score contribution (FR27, C11).
export const Confidence = Schema.Number.annotate({ identifier: "SemanticValues.Confidence" }).check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
)
export type Confidence = typeof Confidence.Type

// FreshnessAgeMs is the projection staleness age feeding the freshness bucket (FR27, C11, AC5).
export const FreshnessAgeMs = Schema.Number.annotate({ identifier: "SemanticValues.FreshnessAgeMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type FreshnessAgeMs = typeof FreshnessAgeMs.Type
