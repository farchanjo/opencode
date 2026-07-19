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

import type { DegradationGap, RetrievalMode, ToolRetrievalMode } from "@opencode-ai/schema/semantic/enums-state"

export type { DegradationGap, RetrievalMode, ToolRetrievalMode }

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

// ---------------------------------------------------------------------------
// Feature 009 / T011 (S11) — the tool-search degradation ladder third rung.
//
// Reuses the SAME `HealthConditions`, `GAP_PRECEDENCE`, `GAP_REASON` and
// `firstGap` classifier so the tool ladder never forks a second health model.
// The tool ladder is `full_semantic → lexical_only → full_set_passthrough`,
// distinct from the agent `RetrievalMode` because the tool floor is NOT
// `fail_closed` by default — it is the current unranked full permission-visible
// set (`full_set_passthrough`), so tool availability is never worse than today
// unless an operator opts a surface into fail-closed (FR18, FR19, FR20, C14).
// It NEVER auto-selects or substitutes another embedding/reranker model — the
// binding surfaces `degraded`/`unavailable` and the caller degrades the rung
// only (FR19).
// ---------------------------------------------------------------------------

/**
 * The gaps that drop below lexical-only to the absolute full-set passthrough
 * floor: no pinned binding, a cold/empty index (nothing to rank), or the
 * embedding model down (no dense recall at all). Every other gap still yields a
 * lexical/sparse ranking over the permission-visible set (Milvus recall down,
 * reranker down, index stale, retrieval timed out) — the `lexical_only` rung
 * (FR18, C14, AC5, AC6, AC7). Milvus-down alone stays lexical; embedding-down or
 * embedding+Milvus-down reaches the floor.
 */
const FLOOR_GAPS: ReadonlyArray<Exclude<DegradationGap, "none">> = Object.freeze([
  "no_binding",
  "cold_index",
  "embedding_unavailable",
])

/** The typed tool-ladder outcome mirroring `tool-retrieval.cue` `#ToolDegradationOutcome` (FR18, C14). */
export interface ToolDegradationOutcome {
  readonly mode: ToolRetrievalMode
  readonly gap: DegradationGap
  readonly degraded_reason: string | null
}

/** The healthy tool full-semantic outcome (no gap, no degraded reason). */
export const TOOL_HEALTHY: ToolDegradationOutcome = Object.freeze({
  mode: "full_semantic",
  gap: "none",
  degraded_reason: null,
})

/**
 * Classify the observed health into a TOOL ladder outcome. A healthy set stays
 * `full_semantic`; a floor gap (`no_binding` / `cold_index` /
 * `embedding_unavailable`) drops to the `full_set_passthrough` floor (today's
 * unranked full set); any other gap drops to `lexical_only`. When the surface
 * opted into fail-closed, any gap yields `fail_closed` so the caller returns a
 * typed capability-gap error instead of degrading (FR18, FR19, C12, C14, AC5,
 * AC6, AC7, AC19). Never auto-substitutes a model. Pure and total.
 */
export const classifyTool = (
  conditions: HealthConditions,
  options: { readonly failClosed?: boolean } = {},
): ToolDegradationOutcome => {
  const gap = firstGap(conditions)
  if (gap === null) return TOOL_HEALTHY
  if (options.failClosed) return Object.freeze({ mode: "fail_closed", gap, degraded_reason: GAP_REASON[gap] })
  const mode: ToolRetrievalMode = FLOOR_GAPS.some((floor) => conditions[floor])
    ? "full_set_passthrough"
    : "lexical_only"
  return Object.freeze({ mode, gap, degraded_reason: GAP_REASON[gap] })
}

/**
 * Whether a tool ladder mode still returns a tool set: every rung except the
 * operator opt-in `fail_closed` does — `full_set_passthrough` is a real floor
 * (today's full permission-visible set), never a silent empty result (FR18, C14).
 */
export const toolYieldsTools = (mode: ToolRetrievalMode): boolean => mode !== "fail_closed"
