/**
 * Feature 050 / T017 (FR1, FR2, FR3) — the production `PipelineRunnerPort`.
 *
 * Binds the shipped nine-stage `Pipeline.run` (agents/skills) and seven-stage
 * `ToolPass.run` (tools) over the live Milvus/embedding/rerank seams into the
 * single production runner `createRetrievalFacade` consumes. It embeds the query
 * ONCE per request (`EmbeddingClient.embed`, memoized by task id), recalls over
 * the surface's collection, reranks per the reranker binding's compatibility
 * mode (identity order when no reranker is bound), and — because the pipeline
 * revalidates SKILLS only, never AGENTS (`pipeline.ts:150-157`) — performs the
 * runner-level agent revalidation itself, dropping dead/unpermitted ids before
 * the facade's `revalidated:true` stamp is earned (FR2).
 *
 * Every surface call is wrapped in a REAL deadline (`latencyBudgetMs`): a hung
 * Milvus socket rejects at the deadline, and the facade relabels that rejection
 * `{type:"timeout"}` (FR3). There are ZERO retries in this live-query plane — the
 * data-plane retry policy (FR12) governs the reindex/reconcile write path, never
 * a live retrieval turn.
 */
export * as PipelineRunner from "./pipeline-runner"

import { Effect } from "effect"
import { Pipeline } from "@opencode-ai/core/semantic/pipeline"
import { ToolPass } from "@opencode-ai/core/semantic/tool-pass"
import type { TieBreak } from "@opencode-ai/core/semantic/tie-break"
import type { Retrieval } from "@opencode-ai/schema/semantic/retrieval"
import type {
  QueryFingerprint,
  RetrievalRequest,
  SkillChunkRetrievalRequest,
  SkillRetrievalRequest,
  ToolRetrievalRequest,
  ToolSource,
} from "@opencode-ai/protocol/semantic/commands"
import type {
  PipelineOutcome,
  PipelineRunnerPort,
  RankedRow,
  RetrievalDecisionRecord,
  ToolPipelineOutcome,
  ToolRankedRow,
} from "@/semantic/retrieval-facade"
import type { Hit, MandatoryFilters, MilvusPort } from "@/semantic/milvus-adapter"
import { EmbeddingClient } from "@/semantic/embedding-client"
import type { EmbeddingsHttpPort } from "@/semantic/embedding-client"
import { RerankClient } from "@/semantic/rerank-client"
import type { NativeRerankHttpPort, StructuredChatHttpPort } from "@/semantic/rerank-client"
import type { ActiveBinding } from "@/semantic/binding-runtime"

/** A live-registry existence + permission check for one canonical id (FR2). */
export interface EntityRevalidator {
  readonly get: (id: string) => Promise<{ readonly exists: boolean; readonly permitted: boolean }>
}

export interface PipelineRunnerDeps {
  readonly milvus: MilvusPort
  readonly embedHttp: EmbeddingsHttpPort
  readonly rerankNativeHttp?: NativeRerankHttpPort
  readonly rerankStructuredHttp?: StructuredChatHttpPort
  readonly bindings: { readonly embedding: ActiveBinding; readonly reranker?: ActiveBinding }
  /** The live agent registry check; when present, dead/unpermitted ranked agents are dropped (FR2). */
  readonly agents?: EntityRevalidator
  /** Optional live skill registry check; identity when absent. */
  readonly skills?: EntityRevalidator
  /** Optional live tool registry check; identity when absent (`ToolPass` revalidates internally in production). */
  readonly tools?: EntityRevalidator
  /** Feature 052 — the chunk pass's OWN revalidation: a chunk id is dropped when its parent
   * skill no longer resolves live (`Pipeline.run` revalidates skills only, `pipeline.ts:157`);
   * identity when absent. Provenance eligibility (FR5) is enforced downstream in `live-narrowing.ts`. */
  readonly chunks?: EntityRevalidator
  readonly latencyBudgetMs: number
  readonly filters: MandatoryFilters
}

const RERANK_TOKEN_BUDGET = 256
const EMBED_BATCH_SIZE = 1

/** A recall row carrying the pipeline tie-break keys plus the per-signal ranks the reducer needs. */
type AgentRecallRow = Pipeline.RecallRow
type ToolRecallRow = ToolPass.ToolRecallRow

/**
 * Reject at the deadline so the facade relabels the rejection `{type:"timeout"}` —
 * never a hang (FR3). A `settled` guard makes the deadline and the surface's
 * completion race exactly once: a post-deadline completion is a no-op, and the
 * surface receives an `AbortSignal` it checks before any late shared-state write
 * (e.g. the embed cache), so a losing promise can never mutate runner state.
 */
function withDeadline<A>(run: (signal: AbortSignal) => Promise<A>, budgetMs: number): Promise<A> {
  const controller = new AbortController()
  return new Promise<A>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      controller.abort()
      reject(new Error("pipeline_deadline_exceeded"))
    }, budgetMs)
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        reject(error)
      },
    )
  })
}

/**
 * Build the production runner over the injected seams. `runAgents`/`runSkills`
 * bind `Pipeline.run`; `runTools` binds `ToolPass.run` — never `Pipeline.run`
 * (FR1). Each call embeds once, recalls, reranks, runs the pass, revalidates at
 * the runner level, and returns under a real deadline (FR2, FR3).
 */
export function createPipelineRunner(deps: PipelineRunnerDeps): PipelineRunnerPort {
  const embedCache = new Map<string, readonly number[]>()

  const embedQueryVector = async (taskId: string, queryText: string, signal: AbortSignal): Promise<readonly number[]> => {
    const cached = embedCache.get(taskId)
    if (cached !== undefined) return cached
    const vectors = await EmbeddingClient.embed(
      { http: deps.embedHttp },
      { baseUrl: deps.bindings.embedding.baseUrl, model: deps.bindings.embedding.modelRef, texts: [queryText], maxBatchSize: EMBED_BATCH_SIZE },
    )
    const vector = vectors[0] ?? []
    // Never mutate shared runner state after the deadline aborted this surface (m5).
    if (!signal.aborted) embedCache.set(taskId, vector)
    return vector
  }

  const recallHits = async (
    collection: "agents" | "skills" | "tools" | "skill_chunks",
    dense: readonly number[],
    topK: number,
  ): Promise<readonly Hit[]> => {
    const result = await Effect.runPromise(
      deps.milvus.search({
        collection,
        dense: [...dense],
        sparseTerms: [],
        filters: deps.filters,
        topK,
        consistency: "bounded",
        metric: "cosine",
      }),
    )
    return result.hits
  }

  /** Score the reduced rows through the bound reranker; identity (rerank absent) when none is bound (FR1). */
  const rerankScores = async (
    queryText: string,
    documents: ReadonlyArray<{ readonly id: string }>,
    topK: number,
  ): Promise<Map<string, number> | null> => {
    const reranker = deps.bindings.reranker
    if (reranker === undefined) return null
    const structured = reranker.compatibilityMode === "structured-chat"
    if (structured && deps.rerankStructuredHttp === undefined) return null
    if (!structured && deps.rerankNativeHttp === undefined) return null
    const request = {
      baseUrl: reranker.baseUrl,
      model: reranker.modelRef,
      query: queryText,
      documents: documents.map((d) => ({ canonicalId: d.id, text: d.id })),
      topK,
    }
    const outcome = structured
      ? await RerankClient.rerankStructured({ http: deps.rerankStructuredHttp! }, { ...request, tokenBudget: RERANK_TOKEN_BUDGET })
      : await RerankClient.rerankNative({ http: deps.rerankNativeHttp! }, request)
    if (!outcome.ok) return null
    return new Map(outcome.results.map((row) => [row.canonicalId, row.score]))
  }

  const revalidateRows = async <T extends { readonly canonicalId: string }>(
    rows: readonly T[],
    checker: EntityRevalidator | undefined,
  ): Promise<readonly T[]> => {
    if (checker === undefined) return rows
    const checked = await Promise.all(rows.map(async (row) => ({ row, result: await checker.get(row.canonicalId) })))
    return checked.filter((entry) => entry.result.exists && entry.result.permitted).map((entry) => entry.row)
  }

  /** Minimal schema request — `Pipeline.run`/`ToolPass.run` read only `rerank_top_k`; the ports own the rest. */
  const toSchemaRequest = (retrievalTopK: number, rerankTopK: number): Retrieval.RetrievalRequest =>
    ({
      retrieval_top_k: retrievalTopK,
      rerank_top_k: rerankTopK,
      collection: "agents",
      consistency: "bounded",
      mode: "full_semantic",
      profile: {},
    }) as unknown as Retrieval.RetrievalRequest

  const decisionRecord = (languageTag: string | undefined): RetrievalDecisionRecord => ({
    embeddingBindingVersion: deps.bindings.embedding.bindingVersion,
    rerankerBindingVersion: deps.bindings.reranker?.bindingVersion ?? null,
    languageTag: languageTag ?? null,
  })

  const fingerprintOf = (taskId: string): QueryFingerprint =>
    ({ fingerprint: taskId, bindingVersion: deps.bindings.embedding.bindingVersion, configHash: "" }) as unknown as QueryFingerprint

  const runEntitySurface = async (
    request: RetrievalRequest,
    collection: "agents" | "skills" | "skill_chunks",
    revalidator: EntityRevalidator | undefined,
    signal: AbortSignal,
  ): Promise<PipelineOutcome> => {
    const dense = await embedQueryVector(request.profile.taskId, request.profile.queryText, signal)
    const versionById = new Map<string, string>()
    const ports: Pipeline.PipelinePorts = {
      embedQuery: async () => {},
      recall: async (): Promise<readonly AgentRecallRow[]> => {
        const hits = await recallHits(collection, dense, request.retrievalTopK)
        return hits.map((hit, index) => {
          versionById.set(hit.canonicalId, hit.canonicalVersion)
          return { id: hit.canonicalId, version: 0, rerank: null, dense: hit.dense, sparse: hit.sparse, dense_rank: index, sparse_rank: index }
        })
      },
      rerank: async (rows, rerankTopK): Promise<readonly TieBreak.Scored[]> => {
        const scores = await rerankScores(request.profile.queryText, rows, rerankTopK)
        return rows.map((row) => ({ id: row.id, version: row.version, rerank: scores?.get(row.id) ?? null, dense: row.dense, sparse: row.sparse }))
      },
      selectAgent: (ordered) => (ordered.length === 0 ? null : { id: ordered[0].id, rank: 0 }),
      retrieveSkills: async () => [],
      revalidate: async (rows) => rows,
    }
    const run = await Pipeline.run(ports, toSchemaRequest(request.retrievalTopK, request.rerankTopK))
    const ranked: readonly RankedRow[] = run.agents.map((scored) => ({
      canonicalId: scored.id,
      canonicalVersion: versionById.get(scored.id) ?? "",
      rerank: scored.rerank,
      dense: scored.dense,
      sparse: scored.sparse,
    }))
    const rows = await revalidateRows(ranked, revalidator)
    return {
      rows,
      degradation: { rung: "full_semantic" },
      queryFingerprint: fingerprintOf(request.profile.taskId),
      cacheHit: false,
      effective: decisionRecord(request.profile.languageTag),
    }
  }

  const runToolSurface = async (request: ToolRetrievalRequest, signal: AbortSignal): Promise<ToolPipelineOutcome> => {
    const dense = await embedQueryVector(request.profile.taskId, request.profile.queryText, signal)
    const versionById = new Map<string, string>()
    const ports: ToolPass.ToolPassPorts = {
      embedQuery: async () => {},
      recall: async (): Promise<readonly ToolRecallRow[]> => {
        const hits = await recallHits("tools", dense, request.retrievalTopK)
        return hits.map((hit, index) => {
          versionById.set(hit.canonicalId, hit.canonicalVersion)
          return {
            id: hit.canonicalId,
            version: 0,
            rerank: null,
            dense: hit.dense,
            sparse: hit.sparse,
            dense_rank: index,
            sparse_rank: index,
            contentHash: hit.canonicalVersion,
            source: "native" as ToolSource,
          }
        })
      },
      rerank: async (rows, rerankTopK): Promise<readonly ToolPass.ToolScored[]> => {
        const scores = await rerankScores(request.profile.queryText, rows, rerankTopK)
        return rows.map((row) => ({ ...row, rerank: scores?.get(row.id) ?? null }))
      },
      revalidate: async (rows) => rows,
    }
    const run = await ToolPass.run(ports, toSchemaRequest(request.retrievalTopK, request.rerankTopK))
    const ranked: readonly ToolRankedRow[] = run.tools.map((tool) => ({
      canonicalId: tool.id,
      canonicalVersion: tool.contentHash,
      source: tool.source,
      rerank: tool.rerank,
      dense: tool.dense,
      sparse: tool.sparse,
    }))
    const rows = await revalidateRows(ranked, deps.tools)
    return {
      rows,
      degradation: { rung: "full_semantic" },
      queryFingerprint: fingerprintOf(request.profile.taskId),
      cacheHit: false,
      effective: decisionRecord(request.profile.languageTag),
    }
  }

  return {
    runAgents: (request: RetrievalRequest) => withDeadline((signal) => runEntitySurface(request, "agents", deps.agents, signal), deps.latencyBudgetMs),
    runSkills: (request: SkillRetrievalRequest) => withDeadline((signal) => runEntitySurface(request, "skills", deps.skills, signal), deps.latencyBudgetMs),
    runTools: (request: ToolRetrievalRequest) => withDeadline((signal) => runToolSurface(request, signal), deps.latencyBudgetMs),
    runSkillChunks: (request: SkillChunkRetrievalRequest) =>
      withDeadline((signal) => runEntitySurface(request, "skill_chunks", deps.chunks, signal), deps.latencyBudgetMs),
  }
}
