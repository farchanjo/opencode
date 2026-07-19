/**
 * Feature 009 / T005 (S3) — the immutable tool-retrieval pass.
 *
 * Framework-free and deterministic, mirroring `pipeline.ts` but scoped to the
 * `tools` collection: it owns the FIXED stage order and threads a context through
 * the injected embedding / recall / rerank / revalidate ports, performing no I/O
 * itself (the Milvus gRPC client, the OpenAI-compatible HTTP calls, and the
 * live-core tool revalidation live behind the injected ports in the
 * `packages/opencode` application layer, C2). It executes pipeline stages
 * **1 profile → 2 filter → 3 recall → 4 reduce → 5 rerank → 6 score → 9 revalidate**
 * and OMITS the agent-only **7 select_agent / 8 skill_pass** — there is no agent
 * selection and no constrained skill pass for a tool query (C2, FR11).
 *
 * The hot logic is pure sequencing: fusion (`hybrid-fusion.ts`) reduces the hybrid
 * recall to the rerank window and the tie-break (`tie-break.ts`) fixes the routing
 * order, both reused verbatim. The tie-break total order is unchanged —
 * `rerank → dense → sparse → canonical id → version` — where the canonical id is
 * the composed tool id; the tool content hash is carried on each row and surfaced
 * as the candidate version leg, while the numeric `version` key stays the
 * projection version (the composed tool id is unique per tool, so the numeric leg
 * never reorders distinct tools; ordering is behavior-identical to the agent pass).
 *
 * The original query text is preserved for embedding with no mandatory translation
 * LLM call (FR16), the query embedding is derived once per Task fingerprint and
 * shared across surfaces via the reused `query-cache.ts` at the application layer
 * (FR14, C8), `retrieval_top_k ≥ rerank_top_k` stays bounded by the reused facade
 * `budgetError` guard (C5), and an empty recall yields NO invented tool — the
 * result stays empty and the reranker is never consulted (FR11, C2, AC1, AC8).
 */
export * as ToolPass from "./tool-pass"

import type { ToolSource } from "@opencode-ai/schema/semantic/enums-state"
import type { Profile } from "@opencode-ai/schema/semantic/profile"
import type { Retrieval } from "@opencode-ai/schema/semantic/retrieval"
import { HybridFusion } from "./hybrid-fusion"
import { TieBreak } from "./tie-break"

/** The seven tool-pass stages, in immutable execution order — 1–6 + 9, omitting the agent-only 7/8 (C2, FR11). */
export const TOOL_STAGES = ["profile", "filter", "recall", "reduce", "rerank", "score", "revalidate"] as const
export type ToolStage = (typeof TOOL_STAGES)[number]

/**
 * One scored tool row reduced to its tie-break keys plus the tool-specific
 * identity carried to the candidate output. `id` is the canonical composed tool
 * id (never an embedded entity, C11); `version` its numeric projection version;
 * `contentHash` the C3 content hash surfaced as the candidate version leg; and
 * `source` the tool provenance (FR6). `rerank` is `null` on reranker outage (AC8).
 */
export interface ToolScored extends TieBreak.Scored {
  readonly contentHash: string
  readonly source: ToolSource
}

/** A tool recall row: a scored tool plus its raw dense/sparse per-signal ranks (FR12). */
export interface ToolRecallRow extends ToolScored {
  readonly dense_rank: number | null
  readonly sparse_rank: number | null
}

/**
 * The injected tool-pass ports. Each is a lightweight async seam owning the actual
 * I/O; the runner only sequences them (C2). Deterministic fakes make the whole
 * pass reproducible in unit tests with no I/O. There is no `selectAgent` and no
 * `retrieveSkills` seam — the tool pass omits the agent-only stages 7/8.
 */
export interface ToolPassPorts {
  /** Stage 1 — derive/reuse the cached query embedding for a fingerprint (FR14, C8). */
  readonly embedQuery: (profile: Profile.TaskProfile) => Promise<void>
  /** Stage 3 — hybrid dense+sparse recall over the current `tools` generation (FR12). */
  readonly recall: (request: Retrieval.RetrievalRequest) => Promise<readonly ToolRecallRow[]>
  /** Stage 5 — the pinned reranker over the reduced set; may return absent rerank (AC8). */
  readonly rerank: (rows: readonly ToolRecallRow[], rerankTopK: number) => Promise<readonly ToolScored[]>
  /** Stage 9 — revalidate candidates against live ToolRegistry/MCP/Permission before injection (FR3, C11). */
  readonly revalidate: (rows: readonly ToolScored[]) => Promise<readonly ToolScored[]>
}

/** The fusion strategy applied at the reduce stage; defaults to weighted (FR12, C7). */
export interface ToolPassOptions {
  readonly fusion?: HybridFusion.FusionStrategy
}

/** The immutable outcome of one tool pass, including the executed stage trace. */
export interface ToolPassRun {
  readonly trace: readonly ToolStage[]
  readonly tools: readonly ToolScored[]
}

/**
 * Stage 4 — reduce the hybrid recall to the rerank window. Fuses dense+sparse
 * deterministically, orders by fused recall score, and slices to `rerankTopK`,
 * preserving the recall rows for the reranker. Pure (FR12, C7).
 */
const reduce = (
  rows: readonly ToolRecallRow[],
  rerankTopK: number,
  strategy: HybridFusion.FusionStrategy,
): readonly ToolRecallRow[] => {
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
 * Run the immutable tool pass over the injected ports. The stage trace is always
 * the fixed seven stages (1–6 + 9) in order regardless of the data, so identical
 * inputs yield identical sequencing; an empty recall never consults the reranker
 * and invents no tool (FR11, C2, AC1, AC8). The final `tools` list is the stable
 * tie-break total order over the revalidated rows.
 */
export const run = async (
  ports: ToolPassPorts,
  request: Retrieval.RetrievalRequest,
  options: ToolPassOptions = {},
): Promise<ToolPassRun> => {
  const strategy = options.fusion ?? "weighted"
  const trace: ToolStage[] = []

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
  const scored = TieBreak.order(reranked)
  trace.push("revalidate")
  const revalidated = await ports.revalidate(scored)

  return Object.freeze({ trace: Object.freeze([...trace]), tools: TieBreak.order(revalidated) })
}
