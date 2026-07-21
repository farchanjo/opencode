/**
 * Feature 051 / T019 (FR9) — the live retrieval mount composition.
 *
 * Exercises `composeLiveRetrievalPort` (the pure seam the `effect/app-runtime.ts`
 * composition root feeds the effective config + operator environment):
 *  - no Milvus endpoint (or no active embedding binding) → the SAME honest degraded
 *    facade the shipped default layer ships; its surfaces reject, and `narrowForTurn`
 *    absorbs that into a `{}` passthrough with exactly one content-free warning — the
 *    mount never introduces a boot failure (FR9, FR7).
 *  - a Milvus port + a registry document that joins an active embedding binding → the
 *    LIVE facade, whose `retrieveAgents` recalls the seeded index (not the degraded
 *    "unavailable" rejection), proving the override actually swaps the runner.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { SemanticRetrieval } from "@/semantic/retrieval-service"
import { LiveNarrowing } from "@/semantic/live-narrowing"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import type { MandatoryFilters } from "@/semantic/milvus-adapter"
import type { BindingRuntime } from "@/semantic/binding-runtime"
import type { EmbeddingsHttpPort } from "@/semantic/embedding-client"
import type { NarrowedSetsMemo } from "@/session/routing-state"
import type { SessionID } from "@/session/schema"
import type { RetrievalRequest } from "@opencode-ai/protocol/semantic/commands"

const FILTERS: MandatoryFilters = { projectId: "opencodedev", scope: "project", visibility: "project" }
const embedHttp: EmbeddingsHttpPort = { postEmbeddings: async () => ({ vectors: [[1, 0]] }) }

const REGISTRY_DOC: BindingRuntime.RegistryDocumentView = {
  providers: [{ id: "prov", baseUrl: "https://emb.local", secretRef: null }],
  models: [{ id: "mdl", providerProfileId: "prov", modelRef: "m" }],
  embedding: { modelDescriptorId: "mdl", compatibilityMode: "embedding", version: 1 },
  reranker: null,
}

const request = {
  profile: { taskId: "t1", queryText: "how do I configure kubernetes ingress mTLS", projectId: "opencodedev" },
  retrievalTopK: 10,
  rerankTopK: 10,
  filters: { projectId: "opencodedev" },
} as unknown as RetrievalRequest

const memo = (initial: NarrowedSetsMemo | null = null) => {
  let value = initial
  return {
    readMemo: (_s: SessionID) => value,
    writeMemo: (_s: SessionID, key: string, sets: NarrowedSetsMemo["sets"]) => {
      value = { key, sets }
    },
  } satisfies LiveNarrowing.NarrowingStateAccessors
}

describe("composeLiveRetrievalPort — degraded fallback (FR9)", () => {
  test("no Milvus endpoint falls open to a rejecting facade", async () => {
    const port = SemanticRetrieval.composeLiveRetrievalPort({
      registryDocument: REGISTRY_DOC,
      milvus: undefined,
      embedHttp,
      projectId: "opencodedev",
      latencyBudgetMs: 300,
    })
    const exit = await Effect.runPromiseExit(port.retrieveAgents(request))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("no active embedding binding (empty document) falls open to a rejecting facade", async () => {
    const emptyDoc: BindingRuntime.RegistryDocumentView = { providers: [], models: [], embedding: null, reranker: null }
    const port = SemanticRetrieval.composeLiveRetrievalPort({
      registryDocument: emptyDoc,
      milvus: MilvusAdapter.createFakeMilvusAdapter(),
      embedHttp,
      projectId: "opencodedev",
      latencyBudgetMs: 300,
    })
    const exit = await Effect.runPromiseExit(port.retrieveAgents(request))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("narrowForTurn fail-opens to {} over the degraded facade, warning exactly once", async () => {
    const port = SemanticRetrieval.composeLiveRetrievalPort({
      registryDocument: undefined,
      milvus: undefined,
      embedHttp,
      projectId: "opencodedev",
      latencyBudgetMs: 300,
    })
    let warnings = 0
    const sets = await LiveNarrowing.narrowForTurn(
      {
        gates: { agents: true, skills: true, tools: true, minPromptLength: 8, latencyBudgetMs: 300, debugLog: false },
        retrieval: port,
        state: memo(),
        warn: () => {
          warnings++
        },
      },
      {
        sessionID: "ses_mount" as SessionID,
        promptText: "how do I configure kubernetes ingress mTLS",
        lastUserID: "msg_1",
        agent: "build",
        isOrchestrationChild: false,
      },
    )
    expect(sets).toEqual({})
    expect(warnings).toBe(1)
  })
})

describe("composeLiveRetrievalPort — live facade (FR9)", () => {
  test("a Milvus port + active embedding binding composes the live runner (recalls the seeded index)", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    await Effect.runPromise(
      milvus.upsert({
        collection: "agents",
        rows: [
          { canonicalId: "cand-a", canonicalVersion: "h1", dense: [1, 0], terms: [], filters: FILTERS },
          { canonicalId: "cand-b", canonicalVersion: "h2", dense: [0, 1], terms: [], filters: FILTERS },
        ],
      }),
    )
    const port = SemanticRetrieval.composeLiveRetrievalPort({
      registryDocument: REGISTRY_DOC,
      milvus,
      embedHttp,
      projectId: "opencodedev",
      latencyBudgetMs: 1000,
    })
    const result = await Effect.runPromise(port.retrieveAgents(request))
    expect(result.candidates.map((c) => c.canonicalId)).toEqual(["cand-a", "cand-b"])
  })
})
