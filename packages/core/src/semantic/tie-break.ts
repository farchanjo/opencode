/**
 * Feature 006 / T016 (S7) — the deterministic candidate tie-break total order.
 *
 * Framework-free, deterministic, zero I/O. Encodes the stable total order
 * **rerank score → dense score → sparse/lexical score → canonical id → version**
 * drawn in `plan.md` "Testing matrix" and `retrieval.cue`/`data-model.md` (FR4,
 * FR19, C2, C7). Identical inputs always yield identical ordering: every key is
 * compared descending by relevance (higher first) except the final canonical
 * `id`/`version` pair, compared ascending so the order is a strict total order
 * with no residual ambiguity. The reranker never chooses the final route — it is
 * only the first sort key (FR4, C2).
 *
 * Rerank absence (a `null` component on reranker outage, AC8) is treated as the
 * lowest possible rerank score, so a present rerank ranks above an absent one and
 * a fully rerank-absent set falls straight through to `dense → sparse → id`
 * without any `NaN` from infinity arithmetic. The comparator is pure and total;
 * `order` performs a stable sort over a copy and never mutates its input.
 */
export * as TieBreak from "./tie-break"

/**
 * One scored candidate row reduced to its tie-break keys. `id` is the canonical
 * agent/skill id (never an embedded entity, C11) and `version` its projection
 * version; `rerank` is `null` when the reranker is unavailable (FR24, AC8).
 */
export interface Scored {
  readonly id: string
  readonly version: number
  readonly rerank: number | null
  readonly dense: number
  readonly sparse: number
}

/** The lowest-possible rerank key for an absent (`null`) rerank component (AC8). */
const rerankKey = (value: number | null): number => (value ?? Number.NEGATIVE_INFINITY)

/** Descending numeric comparison (higher relevance first); NaN-free for ±Infinity. */
const descNum = (a: number, b: number): number => (a < b ? 1 : a > b ? -1 : 0)

/** Ascending string comparison for the canonical id (stable final key). */
const ascStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Ascending numeric comparison for the projection version (last resolving key). */
const ascNum = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The stable total order over two scored rows: rerank → dense → sparse →
 * canonical id → version. Returns a negative number when `a` ranks before `b`,
 * positive when after, and `0` only when the two rows are the same candidate
 * identity at the same version. Pure and total (FR4, FR19, C2).
 */
export const compare = (a: Scored, b: Scored): number =>
  descNum(rerankKey(a.rerank), rerankKey(b.rerank)) ||
  descNum(a.dense, b.dense) ||
  descNum(a.sparse, b.sparse) ||
  ascStr(a.id, b.id) ||
  ascNum(a.version, b.version)

/**
 * Return a new array ordered by the stable total order. Never mutates the input;
 * identical inputs always yield an identical ordering (FR4, FR19, C2, AC17).
 */
export const order = <T extends Scored>(rows: readonly T[]): readonly T[] => [...rows].sort(compare)

/** Whether a set of rows carries no rerank component at all (full reranker outage, AC8). */
export const isRerankAbsent = (rows: readonly Scored[]): boolean => rows.every((row) => row.rerank === null)
