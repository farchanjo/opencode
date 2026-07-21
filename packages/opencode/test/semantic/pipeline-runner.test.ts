/**
 * Feature 050 / T017-T018 (FR1, FR2, FR3) — the production pipeline runner.
 *
 * Asserts a ranked outcome over a fake Milvus + fake embed/rerank transport,
 * runner-level agent revalidation dropping dead/unpermitted ids (never stamping
 * a dropped id), a real deadline surfacing a rejection (never a hang), ZERO
 * retries on a transient Milvus fault, and that `runTools` produces a tool
 * outcome (`ToolPass.run`, never `Pipeline.run`).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PipelineRunner } from "@/semantic/pipeline-runner"
import type { EntityRevalidator } from "@/semantic/pipeline-runner"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import type { MandatoryFilters, MilvusPort } from "@/semantic/milvus-adapter"
import type { EmbeddingsHttpPort } from "@/semantic/embedding-client"
import type { NativeRerankHttpPort } from "@/semantic/rerank-client"
import type { ActiveBinding } from "@/semantic/binding-runtime"
import type { RetrievalRequest, SkillChunkRetrievalRequest, ToolRetrievalRequest } from "@opencode-ai/protocol/semantic/commands"

const FILTERS: MandatoryFilters = { projectId: "proj", scope: "project", visibility: "public" }
const EMBEDDING: ActiveBinding = { baseUrl: "https://emb.local", modelRef: "m", secretRef: "", compatibilityMode: "embedding", bindingVersion: 1 }
const RERANKER: ActiveBinding = { baseUrl: "https://rr.local", modelRef: "rr", secretRef: "", compatibilityMode: "native-rerank", bindingVersion: 2 }

const embedHttp: EmbeddingsHttpPort = { postEmbeddings: async () => ({ vectors: [[1, 0]] }) }

const request = {
  profile: { taskId: "t1", queryText: "find", projectId: "proj" },
  retrievalTopK: 10,
  rerankTopK: 10,
  filters: { projectId: "proj" },
} as unknown as RetrievalRequest

async function seededMilvus(collection: "agents" | "tools", rows?: readonly { canonicalId: string; canonicalVersion: string; dense: number[] }[]): Promise<MilvusPort> {
  const milvus = MilvusAdapter.createFakeMilvusAdapter()
  await Effect.runPromise(
    milvus.upsert({
      collection,
      rows: (rows ?? [
        { canonicalId: "cand-a", canonicalVersion: "h1", dense: [1, 0] },
        { canonicalId: "cand-b", canonicalVersion: "h2", dense: [0, 1] },
      ]).map((r) => ({ ...r, terms: [], filters: FILTERS })),
    }),
  )
  return milvus
}

async function seededChunks(): Promise<MilvusPort> {
  const milvus = MilvusAdapter.createFakeMilvusAdapter()
  await Effect.runPromise(
    milvus.upsert({
      collection: "skill_chunks",
      rows: [
        { canonicalId: "skill-a_c0", canonicalVersion: "chash0", dense: [1, 0], terms: [], filters: FILTERS },
        { canonicalId: "skill-a_c1", canonicalVersion: "chash1", dense: [0, 1], terms: [], filters: FILTERS },
      ],
    }),
  )
  return milvus
}

describe("createPipelineRunner — ranking", () => {
  test("returns a ranked agent outcome (dense order, no reranker)", async () => {
    const milvus = await seededMilvus("agents")
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp, bindings: { embedding: EMBEDDING }, latencyBudgetMs: 1000, filters: FILTERS })
    const outcome = await runner.runAgents(request)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["cand-a", "cand-b"])
    expect(outcome.rows[0].canonicalVersion).toBe("h1")
    expect(outcome.effective.embeddingBindingVersion).toBe(1)
    expect(outcome.cacheHit).toBe(false)
  })

  test("reranks per the bound reranker (reverses the dense order)", async () => {
    const milvus = await seededMilvus("agents")
    const rerankNativeHttp: NativeRerankHttpPort = {
      postRerank: async (req) => req.documents.map((d) => ({ canonicalId: d.canonicalId, score: d.canonicalId === "cand-b" ? 0.9 : 0.1 })),
    }
    const runner = PipelineRunner.createPipelineRunner({
      milvus,
      embedHttp,
      rerankNativeHttp,
      bindings: { embedding: EMBEDDING, reranker: RERANKER },
      latencyBudgetMs: 1000,
      filters: FILTERS,
    })
    const outcome = await runner.runAgents(request)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["cand-b", "cand-a"])
    expect(outcome.rows[0].rerank).toBe(0.9)
    expect(outcome.effective.rerankerBindingVersion).toBe(2)
  })
})

describe("createPipelineRunner — revalidation (FR2)", () => {
  test("drops a dead/unpermitted agent id at the runner level", async () => {
    const milvus = await seededMilvus("agents")
    const agents: EntityRevalidator = { get: async (id) => ({ exists: id !== "cand-b", permitted: id !== "cand-a" ? true : true }) }
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp, bindings: { embedding: EMBEDDING }, agents, latencyBudgetMs: 1000, filters: FILTERS })
    const outcome = await runner.runAgents(request)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["cand-a"]) // cand-b dropped (exists=false)
  })

  test("drops an unpermitted agent id", async () => {
    const milvus = await seededMilvus("agents")
    const agents: EntityRevalidator = { get: async (id) => ({ exists: true, permitted: id === "cand-a" }) }
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp, bindings: { embedding: EMBEDDING }, agents, latencyBudgetMs: 1000, filters: FILTERS })
    const outcome = await runner.runAgents(request)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["cand-a"])
  })
})

describe("createPipelineRunner — deadline + no-retry (FR3, FR12)", () => {
  test("a slow surface rejects at the deadline, never hangs", async () => {
    const milvus = await seededMilvus("agents")
    const slowEmbed: EmbeddingsHttpPort = {
      postEmbeddings: () => new Promise((resolve) => setTimeout(() => resolve({ vectors: [[1, 0]] }), 100)),
    }
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp: slowEmbed, bindings: { embedding: EMBEDDING }, latencyBudgetMs: 5, filters: FILTERS })
    await expect(runner.runAgents(request)).rejects.toBeDefined()
  })

  test("a transient Milvus fault is NOT retried (single search call)", async () => {
    let searchCalls = 0
    const failing: MilvusPort = {
      ...MilvusAdapter.createFakeMilvusAdapter(),
      search: () => {
        searchCalls += 1
        return Effect.fail({ type: "milvus_unavailable", reason: "down" })
      },
    }
    const runner = PipelineRunner.createPipelineRunner({ milvus: failing, embedHttp, bindings: { embedding: EMBEDDING }, latencyBudgetMs: 1000, filters: FILTERS })
    await expect(runner.runAgents(request)).rejects.toBeDefined()
    expect(searchCalls).toBe(1)
  })
})

describe("createPipelineRunner — tools (FR1)", () => {
  test("runTools produces a ranked tool outcome over the tools collection", async () => {
    const milvus = await seededMilvus("tools")
    const toolRequest = { ...request, collection: "tools" } as unknown as ToolRetrievalRequest
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp, bindings: { embedding: EMBEDDING }, latencyBudgetMs: 1000, filters: FILTERS })
    const outcome = await runner.runTools(toolRequest)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["cand-a", "cand-b"])
    expect(outcome.rows[0].canonicalVersion).toBe("h1") // content hash carried on the tool row
    expect(outcome.rows[0].source).toBe("native")
  })
})

describe("createPipelineRunner — skill chunks (Feature 052, FR1)", () => {
  const chunkRequest = { ...request, collection: "skill_chunks" } as unknown as SkillChunkRetrievalRequest

  test("runSkillChunks ranks over the skill_chunks collection, carrying the content hash as the ref leg", async () => {
    const milvus = await seededChunks()
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp, bindings: { embedding: EMBEDDING }, latencyBudgetMs: 1000, filters: FILTERS })
    const outcome = await runner.runSkillChunks(chunkRequest)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["skill-a_c0", "skill-a_c1"])
    expect(outcome.rows[0].canonicalVersion).toBe("chash0") // = the spool output_ref
  })

  test("its own revalidation drops a chunk whose parent skill no longer resolves", async () => {
    const milvus = await seededChunks()
    const chunks: EntityRevalidator = { get: async (id) => ({ exists: id === "skill-a_c0", permitted: true }) }
    const runner = PipelineRunner.createPipelineRunner({ milvus, embedHttp, bindings: { embedding: EMBEDDING }, chunks, latencyBudgetMs: 1000, filters: FILTERS })
    const outcome = await runner.runSkillChunks(chunkRequest)
    expect(outcome.rows.map((r) => r.canonicalId)).toEqual(["skill-a_c0"])
  })
})
