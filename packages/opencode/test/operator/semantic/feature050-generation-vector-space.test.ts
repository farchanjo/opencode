/**
 * Feature 050 / T021 (FR6) — model-driven generation vector space.
 *
 * Asserts `generationVectorSpace` DISCOVERS the real dimension/metric from the
 * injected embedding probe and stamps it on the built generation (never a
 * hardcoded 1024/default), fails the reindex plan CLOSED with a typed capability
 * gap when the probe fails (no silent default dimension), and preserves the
 * `defaultDimension` test seam when no probe is configured.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createConfigBackedRegistry } from "@/operator/semantic/registry-backend"
import { SemanticBackendLive } from "@/operator/semantic/backend-live"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import type { ProbeFailed, ProbedVectorSpace } from "@/semantic/dimension-probe"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { OperatorPrincipal } from "@opencode-ai/protocol/semantic/commands"

const PRINCIPAL: OperatorPrincipal = { kind: "operator", id: "op_1" }

const PROVIDER = {
  id: "p1", version: 1, name: "emb-prov", baseUrl: "https://emb.local", tlsRequired: true,
  allowInsecureLocalProfile: false, residency: "remote", secretRef: "keychain:emb@v1", enabled: true,
  createdAt: "t", updatedAt: "t", selectedBy: "op_1",
}
const MODEL = {
  id: "m_new", providerProfileId: "p1", version: 1, displayName: "emb", endpointMode: "embeddings",
  declaredCapabilityKinds: ["embedding"], enabled: true, validationStatus: "declared",
}
const STAGED = {
  slot: "embedding", modelDescriptorId: "m_new", compatibilityMode: "embedding", state: "draft",
  version: 2, selectedBy: "op_1", selectedAt: "2026-01-01T00:00:00.000Z", validated: false,
}
const SEED: Record<string, unknown> = {
  providers: [PROVIDER], models: [MODEL], embedding: null, reranker: null,
  embeddingStaged: STAGED, embeddingGenerations: [],
}

type ProbeFn = (input: { baseUrl: string; modelRef: string; secretRef: string }) => Promise<ProbedVectorSpace | ProbeFailed>

function registry(over: { embeddingProbe?: ProbeFn; defaultDimension?: number }) {
  const config = { get: async () => ({ version: "cas_v1", payload: SEED, updatedAtMs: 0 }) } as unknown as ConfigPort
  return createConfigBackedRegistry({
    config,
    clock: () => 0,
    idGen: () => "fixed",
    milvus: MilvusAdapter.createFakeMilvusAdapter(),
    ...over,
  })
}

async function reindexGeneration(plan: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<{ dimension: number; metric: string }> {
  const built = await Effect.runPromise(plan)
  const applied = built.apply(SEED, undefined) as { embeddingGenerations: Array<{ dimension: number; metric: string }> }
  return applied.embeddingGenerations[0]
}

describe("generationVectorSpace (Feature 050)", () => {
  test("stamps the probed dimension/metric on the built generation", async () => {
    const probe: ProbeFn = async () => ({ dimension: 2560, metric: "cosine", normalized: true, probedAt: "t", source: "live-probe" })
    const generation = await reindexGeneration(registry({ embeddingProbe: probe }).planReindexEmbedding({ principal: PRINCIPAL }))
    expect(generation.dimension).toBe(2560)
    expect(generation.metric).toBe("cosine")
  })

  test("passes the resolved provider coordinate to the probe", async () => {
    const seen: Array<{ baseUrl: string; modelRef: string; secretRef: string }> = []
    const probe: ProbeFn = async (input) => {
      seen.push(input)
      return { dimension: 8, metric: "cosine", normalized: true, probedAt: "t", source: "live-probe" }
    }
    await reindexGeneration(registry({ embeddingProbe: probe }).planReindexEmbedding({ principal: PRINCIPAL }))
    expect(seen[0]).toEqual({ baseUrl: "https://emb.local", modelRef: "m_new", secretRef: "keychain:emb@v1" })
  })

  test("fails the reindex plan CLOSED with a typed gap when the probe fails", async () => {
    const probe: ProbeFn = async () => ({ type: "probe_failed", detail: "unreachable" })
    const error = await Effect.runPromise(
      registry({ embeddingProbe: probe }).planReindexEmbedding({ principal: PRINCIPAL }).pipe(Effect.flip),
    )
    expect(error.type).toBe("not_validated")
  })

  test("preserves the defaultDimension test seam when no probe is configured", async () => {
    const generation = await reindexGeneration(registry({ defaultDimension: 4 }).planReindexEmbedding({ principal: PRINCIPAL }))
    expect(generation.dimension).toBe(4)
  })
})

describe("createLiveSemanticBackend threads the embedding probe (C1 regression)", () => {
  const config = { get: async () => ({ version: "cas_v1", payload: SEED, updatedAtMs: 0 }) } as unknown as ConfigPort

  test("a threaded probe drives the built generation's dimension end-to-end", async () => {
    const backend = SemanticBackendLive.createLiveSemanticBackend({
      config,
      milvusPort: MilvusAdapter.createFakeMilvusAdapter(),
      embeddingProbe: async () => ({ dimension: 2560, metric: "cosine", normalized: true, probedAt: "t", source: "live-probe" }),
    })
    const built = await Effect.runPromise(backend.registry!.planReindexEmbedding({ principal: PRINCIPAL }))
    const applied = built.apply(SEED, undefined) as { embeddingGenerations: Array<{ dimension: number }> }
    expect(applied.embeddingGenerations[0].dimension).toBe(2560)
  })

  test("with no probe and no default dimension wired, the build fails closed", async () => {
    const backend = SemanticBackendLive.createLiveSemanticBackend({
      config,
      milvusPort: MilvusAdapter.createFakeMilvusAdapter(),
    })
    const error = await Effect.runPromise(backend.registry!.planReindexEmbedding({ principal: PRINCIPAL }).pipe(Effect.flip))
    expect(error.type).toBe("not_validated")
  })
})
