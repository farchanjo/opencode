/**
 * Feature 006 / T016 (S7) — deterministic dense + sparse hybrid-recall fusion.
 *
 * Framework-free, deterministic, zero I/O. Fuses the dense (embedding) and sparse
 * (BM25/lexical) recall signals into one reproducible recall score BEFORE the
 * tie-break total order runs (FR4, FR19, C2, C7, AC1, AC17). Two strategies are
 * offered, both pure and order-independent:
 *   - `weighted`: a normalized weighted sum `w_dense*dense + w_sparse*sparse`.
 *   - `rrf`: Reciprocal Rank Fusion `Σ 1/(k + rank)` over the per-signal ranks,
 *     the rank-based fusion that is robust to incomparable score scales.
 *
 * Fusion never invents a candidate: it maps each input row to a `fused` score and
 * `fuseRank` orders a set deterministically (fused score desc, canonical id asc as
 * the stable final key) so identical inputs always yield an identical recall
 * ordering. The fusion weights and the RRF `k` are provisional plan constants
 * (`fusion_weights`, `data-model.md` tuning table, FR19, C7).
 */
export * as HybridFusion from "./hybrid-fusion"

/** The fusion strategy: a normalized weighted sum or Reciprocal Rank Fusion (FR19, C7). */
export type FusionStrategy = "weighted" | "rrf"

/** The provisional default RRF dampening constant (`fusion_weights`, C7). */
export const RRF_K = 60

/** The provisional default weighted-fusion weights; they sum to 1 (`fusion_weights`, C7). */
export const DEFAULT_WEIGHTS: FusionWeights = Object.freeze({ dense: 0.6, sparse: 0.4 })

/** Normalized dense/sparse blend weights for the `weighted` strategy (C7). */
export interface FusionWeights {
  readonly dense: number
  readonly sparse: number
}

/**
 * One candidate's recall signals. `dense`/`sparse` are the raw per-signal scores
 * (weighted strategy); `dense_rank`/`sparse_rank` are the zero-based per-signal
 * ranks (RRF strategy). A candidate absent from a signal carries a `null` rank so
 * it contributes no reciprocal term for that signal (FR19, C7).
 */
export interface FusionInput {
  readonly id: string
  readonly dense: number
  readonly sparse: number
  readonly dense_rank: number | null
  readonly sparse_rank: number | null
}

/** A candidate with its fused recall score, carried forward to the tie-break (FR19). */
export interface Fused {
  readonly id: string
  readonly fused: number
}

/** The weighted-sum fusion of one row's dense and sparse scores (pure, FR19, C7). */
export const fuseWeighted = (input: FusionInput, weights: FusionWeights = DEFAULT_WEIGHTS): number =>
  weights.dense * input.dense + weights.sparse * input.sparse

/** The single reciprocal-rank term for a zero-based rank, or `0` when absent (RRF). */
const reciprocal = (rank: number | null, k: number): number => (rank === null ? 0 : 1 / (k + rank + 1))

/** The Reciprocal Rank Fusion of one row's dense and sparse ranks (pure, FR19, C7). */
export const fuseRrf = (input: FusionInput, k: number = RRF_K): number =>
  reciprocal(input.dense_rank, k) + reciprocal(input.sparse_rank, k)

/** Fuse one row under the chosen strategy; deterministic and pure (FR19, C7). */
export const fuse = (strategy: FusionStrategy, input: FusionInput, weights: FusionWeights = DEFAULT_WEIGHTS): number =>
  strategy === "rrf" ? fuseRrf(input) : fuseWeighted(input, weights)

/** Descending fused score, then ascending canonical id — the stable fusion order. */
const byFused = (a: Fused, b: Fused): number =>
  b.fused - a.fused || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Fuse and deterministically order a candidate set by fused recall score. Never
 * mutates the input; identical inputs always yield an identical ordering, so the
 * hybrid recall handed to the tie-break is reproducible (FR19, C7, AC1, AC17).
 */
export const fuseRank = (
  strategy: FusionStrategy,
  inputs: readonly FusionInput[],
  weights: FusionWeights = DEFAULT_WEIGHTS,
): readonly Fused[] =>
  inputs.map((input) => Object.freeze({ id: input.id, fused: fuse(strategy, input, weights) })).sort(byFused)
