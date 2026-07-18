/**
 * Feature 006 / T015 (S6) — the immutable nine-stage retrieval pipeline
 * orchestrator.
 *
 * Framework-free and deterministic: the orchestrator owns the FIXED stage order
 * and threads a context through the injected embedding / recall / rerank /
 * core-state / clock ports, but performs no I/O itself — the Milvus gRPC client,
 * the OpenAI-compatible HTTP calls, and the live-core revalidation live behind the
 * injected ports in the `packages/opencode` application layer (C2). The hot logic
 * is pure sequencing: fusion (`hybrid-fusion.ts`) reduces the hybrid recall, the
 * tie-break (`tie-break.ts`) fixes the routing order, and nothing here invents a
 * candidate.
 *
 * The nine stages mirror the C2 pipeline contract and `plan.md` "Native retrieval
 * ports" (FR3, FR4, FR5, FR15, FR21, C2):
 *   1 profile      — structured TaskProfile/QueryFingerprint; cached query embed
 *   2 filter       — mandatory scalar predicates before search
 *   3 recall       — hybrid dense+sparse recall over the current generation
 *   4 reduce       — deterministic fusion order, sliced to rerank_top_k
 *   5 rerank       — pinned reranker profile over the reduced set
 *   6 score        — deterministic routing score + tie-break total order
 *   7 select_agent — the selected Agent (Feature 001 policy; never the reranker)
 *   8 skill_pass   — constrained skill retrieval/rerank for the selected agent
 *   9 revalidate   — post-retrieval revalidation against live AgentV2/SkillV2/Permission
 *
 * The stage order is immutable and identical inputs yield an identical stage
 * sequence; the original query text is preserved for embedding with no mandatory
 * translation LLM call (FR15), and an empty recall yields NO invented agent — the
 * selection stays `null` and the reranker is never consulted (FR5, C2, AC2, AC18).
 */
export * as Pipeline from "./pipeline"

import type { Profile } from "@opencode-ai/schema/semantic/profile"
import type { Retrieval } from "@opencode-ai/schema/semantic/retrieval"
import { HybridFusion } from "./hybrid-fusion"
import { TieBreak } from "./tie-break"

/** The nine pipeline stages, in immutable execution order (C2, FR3). */
export const STAGES = [
  "profile",
  "filter",
  "recall",
  "reduce",
  "rerank",
  "score",
  "select_agent",
  "skill_pass",
  "revalidate",
] as const
export type Stage = (typeof STAGES)[number]

/** A recall row: a candidate ranking pointer plus its raw dense/sparse signals. */
export interface RecallRow extends TieBreak.Scored {
  readonly dense_rank: number | null
  readonly sparse_rank: number | null
}

/** The selected agent for the second (skill) pass; `null` when nothing was recalled. */
export interface AgentSelection {
  readonly id: string
  readonly rank: number
}

/**
 * The injected pipeline ports. Each is a lightweight async seam owning the actual
 * I/O; the orchestrator only sequences them (C2). Deterministic fakes make the
 * whole pipeline reproducible in unit tests with no I/O.
 */
export interface PipelinePorts {
  /** Stage 1 — derive/reuse the cached query embedding for a fingerprint (FR18, C10). */
  readonly embedQuery: (profile: Profile.TaskProfile) => Promise<void>
  /** Stage 3 — hybrid dense+sparse recall over the current generation (FR19). */
  readonly recall: (request: Retrieval.RetrievalRequest) => Promise<readonly RecallRow[]>
  /** Stage 5 — the pinned reranker over the reduced set; may return absent rerank (AC8). */
  readonly rerank: (rows: readonly RecallRow[], rerankTopK: number) => Promise<readonly TieBreak.Scored[]>
  /** Stage 7 — select the routed agent from the ordered candidates (Feature 001 policy). */
  readonly selectAgent: (ordered: readonly TieBreak.Scored[]) => AgentSelection | null
  /** Stage 8 — constrained skill retrieval/rerank for the selected agent (FR21). */
  readonly retrieveSkills: (
    selection: AgentSelection,
    request: Retrieval.RetrievalRequest,
  ) => Promise<readonly TieBreak.Scored[]>
  /** Stage 9 — revalidate candidates against live core before injection (FR20, C11). */
  readonly revalidate: (rows: readonly TieBreak.Scored[]) => Promise<readonly TieBreak.Scored[]>
}

/** The fusion strategy applied at the reduce stage; defaults to weighted (FR19, C7). */
export interface PipelineOptions {
  readonly fusion?: HybridFusion.FusionStrategy
}

/** The immutable outcome of one pipeline run, including the executed stage trace. */
export interface PipelineRun {
  readonly trace: readonly Stage[]
  readonly agents: readonly TieBreak.Scored[]
  readonly selection: AgentSelection | null
  readonly skills: readonly TieBreak.Scored[]
}

/**
 * Stage 4 — reduce the hybrid recall to the rerank window. Fuses dense+sparse
 * deterministically, orders by fused recall score, and slices to `rerankTopK`,
 * preserving the recall rows for the reranker. Pure (FR19, C7).
 */
const reduce = (
  rows: readonly RecallRow[],
  rerankTopK: number,
  strategy: HybridFusion.FusionStrategy,
): readonly RecallRow[] => {
  const inputs = rows.map((row) => ({
    id: row.id,
    dense: row.dense,
    sparse: row.sparse,
    dense_rank: row.dense_rank,
    sparse_rank: row.sparse_rank,
  }))
  const fusedOrder = HybridFusion.fuseRank(strategy, inputs)
  const byId = new Map(rows.map((row) => [row.id, row]))
  return fusedOrder.slice(0, rerankTopK).flatMap((fused) => {
    const row = byId.get(fused.id)
    return row ? [row] : []
  })
}

/**
 * Run the immutable nine-stage pipeline over the injected ports. The stage trace
 * is always the fixed nine stages in order regardless of the data, so identical
 * inputs yield identical sequencing; an empty recall leaves the selection `null`
 * and never consults the reranker or invents an agent (FR3, FR5, C2, AC2, AC18).
 */
export const run = async (
  ports: PipelinePorts,
  request: Retrieval.RetrievalRequest,
  options: PipelineOptions = {},
): Promise<PipelineRun> => {
  const strategy = options.fusion ?? "weighted"
  const trace: Stage[] = []

  trace.push("profile")
  await ports.embedQuery(request.profile)
  trace.push("filter")
  trace.push("recall")
  const recalled = await ports.recall(request)
  trace.push("reduce")
  const reduced = reduce(recalled, request.rerank_top_k, strategy)

  trace.push("rerank")
  const reranked = reduced.length === 0 ? [] : await ports.rerank(reduced, request.rerank_top_k)
  trace.push("score")
  const agents = TieBreak.order(reranked)
  trace.push("select_agent")
  const selection = agents.length === 0 ? null : ports.selectAgent(agents)

  trace.push("skill_pass")
  const skills = selection === null ? [] : await ports.retrieveSkills(selection, request)
  trace.push("revalidate")
  const revalidated = await ports.revalidate(skills)

  return Object.freeze({ trace: Object.freeze([...trace]), agents, selection, skills: TieBreak.order(revalidated) })
}
