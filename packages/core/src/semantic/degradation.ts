/**
 * Feature 006 / T019 (S10) — the typed capability-gap degradation ladder.
 *
 * Framework-free, deterministic, zero I/O. Encodes the three-rung ladder
 * `full_semantic → catalog_lexical → fail_closed` drawn in `plan.md` "State
 * machines" and `data-model.md` (FR7, FR24, FR25, FR26, FR38, C14, C20). Any
 * binding/Milvus/embedding/reranker outage, staleness, timeout, cold index, or
 * unpinned binding drops retrieval to the `catalog_lexical` floor with a stable
 * typed gap code; the classifier NEVER auto-selects another model and NEVER
 * yields a silent empty result — `catalog_lexical` is a real routing floor
 * (Feature 001 catalog + lexical), and `fail_closed` is reached only on explicit
 * operator opt-in (FR24, C20, AC7, AC8, AC29).
 *
 * A bounded breaker/retry targets the SAME pinned binding (`nextRetry`): a
 * transient fault is retried up to a bounded attempt cap against the same binding
 * version — never a different model — before the ladder degrades (FR26, AC29).
 */
export * as Degradation from "./degradation"

import type { DegradationGap, RetrievalMode } from "@opencode-ai/schema/semantic/enums-state"

export type { DegradationGap, RetrievalMode }

/** The observed health conditions feeding the ladder; all `false` means healthy. */
export interface HealthConditions {
  readonly no_binding: boolean
  readonly milvus_unavailable: boolean
  readonly embedding_unavailable: boolean
  readonly cold_index: boolean
  readonly index_stale: boolean
  readonly retrieval_timeout: boolean
  readonly reranker_unavailable: boolean
}

/**
 * The gap-code precedence, most fundamental first. When several conditions hold
 * at once the ladder reports the single most severe gap so the operator sees the
 * root cause (FR24, C20).
 */
export const GAP_PRECEDENCE: ReadonlyArray<Exclude<DegradationGap, "none">> = Object.freeze([
  "no_binding",
  "cold_index",
  "milvus_unavailable",
  "embedding_unavailable",
  "index_stale",
  "retrieval_timeout",
  "reranker_unavailable",
])

/** The stable, content-free reason string for each gap code (FR24, C20, AC29). */
const GAP_REASON: Readonly<Record<Exclude<DegradationGap, "none">, string>> = Object.freeze({
  no_binding: "no embedding/reranker binding is pinned",
  cold_index: "the index generation is empty or cold",
  milvus_unavailable: "the Milvus backend is unreachable",
  embedding_unavailable: "the pinned embedding model is unavailable",
  index_stale: "the index projection is stale beyond the freshness bound",
  retrieval_timeout: "retrieval exceeded the latency budget",
  reranker_unavailable: "the pinned reranker model is unavailable",
})

/** The typed degradation outcome mirroring `retrieval.cue` `#DegradationOutcome` (FR24, C20). */
export interface DegradationOutcome {
  readonly mode: RetrievalMode
  readonly gap: DegradationGap
  readonly degraded_reason: string | null
}

/** Whether any health condition is failing (i.e. a non-`none` gap applies). */
const firstGap = (conditions: HealthConditions): Exclude<DegradationGap, "none"> | null =>
  GAP_PRECEDENCE.find((gap) => conditions[gap]) ?? null

/** The healthy full-semantic outcome (no gap, no degraded reason). */
export const HEALTHY: DegradationOutcome = Object.freeze({ mode: "full_semantic", gap: "none", degraded_reason: null })

/**
 * Classify the observed health into a ladder outcome. A healthy set stays
 * `full_semantic`; any gap drops to `catalog_lexical` with the most-severe stable
 * gap code and its reason — unless the operator opted into fail-closed, in which
 * case the rung is `fail_closed`. Never auto-substitutes a model and never a
 * silent empty result (FR24, C20, AC7, AC8, AC29). Pure and total.
 */
export const classify = (conditions: HealthConditions, options: { readonly failClosed?: boolean } = {}): DegradationOutcome => {
  const gap = firstGap(conditions)
  if (gap === null) return HEALTHY
  const mode: RetrievalMode = options.failClosed ? "fail_closed" : "catalog_lexical"
  return Object.freeze({ mode, gap, degraded_reason: GAP_REASON[gap] })
}

/**
 * Whether a mode still returns routing candidates: `full_semantic` and the
 * `catalog_lexical` floor do; only the opt-in `fail_closed` withholds results,
 * and never silently — the outcome carries the gap (FR24, C20, AC29).
 */
export const yieldsCandidates = (mode: RetrievalMode): boolean => mode !== "fail_closed"

/** A bounded breaker/retry policy targeting the same pinned binding (FR26). */
export interface RetryPolicy {
  readonly maxAttempts: number
}

/** The next breaker decision: retry the SAME binding, or degrade after the cap (FR26, AC29). */
export type RetryDecision =
  | { readonly kind: "retry"; readonly attempt: number; readonly binding_version: number }
  | { readonly kind: "degrade"; readonly gap: Exclude<DegradationGap, "none"> }

/**
 * Decide the next breaker action for a transient fault. Retries target the same
 * pinned `binding_version` — never a substitute model — up to the bounded cap,
 * after which the ladder degrades with the observed gap (FR26, C20, AC29). Pure.
 */
export const nextRetry = (
  attempt: number,
  policy: RetryPolicy,
  binding_version: number,
  gap: Exclude<DegradationGap, "none">,
): RetryDecision =>
  attempt < policy.maxAttempts
    ? Object.freeze({ kind: "retry", attempt: attempt + 1, binding_version })
    : Object.freeze({ kind: "degrade", gap })
