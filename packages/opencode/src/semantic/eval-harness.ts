/**
 * Feature 006 / T035 (S23) — the offline golden evaluation harness.
 *
 * Drives golden task→agent/skill relevance offline over the `EvalPort`: it
 * computes recall@k / nDCG / MRR per multilingual locale (pt-BR / es / en), runs
 * permission-leakage tests with a FIXED ZERO cross-project/over-permission
 * tolerance, and supports drift/model-migration comparison — all without ever
 * mutating a binding (FR14, FR40, FR43, C18). Skill-chunk context is budgeted
 * through Feature 005 `read(offset, limit)` slices so no full body is injected
 * (FR40, C9). The harness is pure over the supplied golden judgments; the live
 * retrieval it evaluates is injected, and a run never changes any pinned binding.
 */
export * as EvalHarness from "./eval-harness"

/** One golden case: the relevant ids, the ranked retrieval, and any ids that leaked (must be empty). */
export interface GoldenCase {
  readonly queryId: string
  readonly locale: string
  readonly relevant: readonly string[]
  readonly retrieved: readonly string[]
  /** Cross-project / over-permission ids that surfaced — the zero-tolerance leakage signal (C18). */
  readonly leaked: readonly string[]
}

/** recall@k: the fraction of relevant ids present in the top-k retrieval (FR43). */
export const recallAtK = (relevant: readonly string[], retrieved: readonly string[], k: number): number => {
  if (relevant.length === 0) return 1
  const topK = new Set(retrieved.slice(0, k))
  let hits = 0
  for (const id of relevant) if (topK.has(id)) hits++
  return hits / relevant.length
}

/** Reciprocal rank of the first relevant id (0 when none is retrieved) (FR43). */
export const reciprocalRank = (relevant: readonly string[], retrieved: readonly string[]): number => {
  const relevantSet = new Set(relevant)
  for (let i = 0; i < retrieved.length; i++) if (relevantSet.has(retrieved[i])) return 1 / (i + 1)
  return 0
}

/** nDCG@k over binary relevance (FR43). */
export const ndcgAtK = (relevant: readonly string[], retrieved: readonly string[], k: number): number => {
  const relevantSet = new Set(relevant)
  let dcg = 0
  for (let i = 0; i < Math.min(k, retrieved.length); i++) {
    if (relevantSet.has(retrieved[i])) dcg += 1 / Math.log2(i + 2)
  }
  let idcg = 0
  for (let i = 0; i < Math.min(k, relevant.length); i++) idcg += 1 / Math.log2(i + 2)
  return idcg === 0 ? 0 : dcg / idcg
}

/** Per-locale aggregate metrics (FR43, C18). */
export interface LocaleEvalResult {
  readonly languageTag: string
  readonly recallAtK: number
  readonly ndcg: number
  readonly mrr: number
}

/** The offline evaluation report; `passed` requires `leakageCount === 0` (fixed, not configurable) (C18). */
export interface EvalReport {
  readonly localeBreakdown: readonly LocaleEvalResult[]
  readonly recallAtK: number
  readonly ndcg: number
  readonly mrr: number
  readonly leakageCount: number
  readonly passed: boolean
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function localeResult(locale: string, cases: readonly GoldenCase[], k: number): LocaleEvalResult {
  return {
    languageTag: locale,
    recallAtK: mean(cases.map((c) => recallAtK(c.relevant, c.retrieved, k))),
    ndcg: mean(cases.map((c) => ndcgAtK(c.relevant, c.retrieved, k))),
    mrr: mean(cases.map((c) => reciprocalRank(c.relevant, c.retrieved))),
  }
}

/**
 * Run the golden evaluation over the cases at cut-off `k`, aggregating per locale
 * and overall. The leakage count is the total of every case's leaked ids; the run
 * PASSES only when it is zero — the tolerance is fixed at zero (FR43, C18). The
 * harness never mutates a binding.
 */
export const runGolden = (cases: readonly GoldenCase[], k: number): EvalReport => {
  const locales = [...new Set(cases.map((c) => c.locale))]
  const localeBreakdown = locales.map((locale) => localeResult(locale, cases.filter((c) => c.locale === locale), k))
  const leakageCount = cases.reduce((sum, c) => sum + c.leaked.length, 0)
  return {
    localeBreakdown,
    recallAtK: mean(cases.map((c) => recallAtK(c.relevant, c.retrieved, k))),
    ndcg: mean(cases.map((c) => ndcgAtK(c.relevant, c.retrieved, k))),
    mrr: mean(cases.map((c) => reciprocalRank(c.relevant, c.retrieved))),
    leakageCount,
    passed: leakageCount === 0,
  }
}

// ---------------------------------------------------------------------------
// Feature 009 / T013 (S12) — the tool-retrieval golden fixture set.
//
// Reuses the SAME `EvalPort` shape (`GoldenCase`), the same `recall@k`/`nDCG`/`MRR`
// metrics, and the same FIXED ZERO-leakage gate (`runGolden`) as the Feature 006
// agent/skill golden set — the tool set is query→tool relevance, not a second
// harness (FR25, FR16, C16, AC2, AC20). The fixtures cover multilingual queries
// (pt-BR / es / en) against the en-US Lang Lock tool descriptions and a
// permission-leakage case whose leaked ids MUST be empty; a run mutates no binding.
// The fixtures are content-free — bounded tool ids, never a description, a schema, a
// secret, or a path.
// ---------------------------------------------------------------------------

/** The multilingual tool golden set: pt-BR / es / en queries over en-US tool descriptions (AC2, AC20). */
export const TOOL_GOLDEN_CASES: readonly GoldenCase[] = Object.freeze([
  { queryId: "tq-read-pt", locale: "pt-BR", relevant: ["tool.read"], retrieved: ["tool.read", "tool.list"], leaked: [] },
  { queryId: "tq-write-es", locale: "es", relevant: ["tool.write"], retrieved: ["tool.write", "tool.edit"], leaked: [] },
  { queryId: "tq-bash-en", locale: "en", relevant: ["tool.bash"], retrieved: ["tool.grep", "tool.bash"], leaked: [] },
  { queryId: "tq-mcp-pt", locale: "pt-BR", relevant: ["mcp:srv/fetch"], retrieved: ["mcp:srv/fetch"], leaked: [] },
])

/**
 * Run the tool golden evaluation at cut-off `k` (defaulting to the small tool
 * result bound). Delegates to the reused `runGolden` so the zero-leakage gate has
 * exactly one owner; the report PASSES only with zero cross-project/over-permission
 * leakage. The harness never mutates a binding (FR25, C16, AC20).
 */
export const runToolGolden = (cases: readonly GoldenCase[] = TOOL_GOLDEN_CASES, k = 8): EvalReport =>
  runGolden(cases, k)

/** A budgeted skill-chunk slice: a Feature 005 ref plus a bounded byte window — never an inline body (FR40, C9). */
export interface BudgetedSlice {
  readonly outputRef: string
  readonly offset: number
  readonly limit: number
}

/** One skill chunk reachable only through its Feature 005 ref (never stored inline). */
export interface ChunkRef {
  readonly outputRef: string
  readonly offset: number
  readonly limit: number
}

/**
 * Budget skill-chunk context slices to `maxChunks` bounded `read(offset, limit)`
 * ranges so no full body is injected and the C8 budget is respected (FR40, C9).
 */
export const budgetChunks = (chunks: readonly ChunkRef[], maxChunks: number): readonly BudgetedSlice[] =>
  chunks.slice(0, Math.max(0, maxChunks)).map((chunk) => ({ outputRef: chunk.outputRef, offset: chunk.offset, limit: chunk.limit }))
