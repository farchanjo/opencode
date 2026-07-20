/**
 * Feature 019 / T006-T007 (Group B2, FR5) — the config-backed embedding cutover /
 * rollback / reindex composed over a live Milvus port as effectful mutation plans.
 *
 * Unit layer (fake `Config.Service` seam + fake Milvus adapter): a reindex physically
 * builds + validates a blue/green generation before any activation; a cutover swaps the
 * alias across EVERY collection together ONLY after a built+validated generation exists
 * (the cardinal honesty rule — `select`/`reindex` alone never activate), archiving the
 * outgoing binding + generation; a CAS contention swaps nothing; and an unconfigured
 * endpoint (no bound Milvus port) degrades to the EXACT same typed `unavailable`
 * (`milvus_unavailable`) floor as today. Every mutation commits through the plan the
 * dispatcher owns — a rejection persists nothing.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createConfigBackedRegistry } from "@/operator/semantic/registry-backend"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import type { MilvusPort } from "@/semantic/milvus-adapter"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan, OperatorMutationEffectResult } from "@/operator/application/handler"
import type { OperatorPrincipal } from "@opencode-ai/protocol/semantic/commands"

const PRINCIPAL: OperatorPrincipal = { kind: "operator", id: "op_1" }

type Binding = {
  slot: string
  modelDescriptorId: string
  compatibilityMode: string
  state: string
  version: number
  selectedBy: string
  selectedAt: string
  validated?: boolean
}
type Generation = { generationId: string; state: string; dimension: number; metric: string; bindingVersion: number; collections: string[] }
type Doc = Record<string, unknown>

const embedding = (over: Partial<Binding>): Binding => ({
  slot: "embedding",
  modelDescriptorId: "m1",
  compatibilityMode: "embedding",
  state: "staged",
  version: 1,
  selectedBy: "op_1",
  selectedAt: "2026-01-01T00:00:00.000Z",
  validated: true,
  ...over,
})

const generation = (over: Partial<Generation>): Generation => ({
  generationId: "gen_1",
  state: "validated",
  dimension: 4,
  metric: "cosine",
  bindingVersion: 2,
  collections: ["agents", "skills", "skill_chunks", "tools"],
  ...over,
})

function registryWith(doc: Doc | null, milvus?: MilvusPort) {
  const config = { get: async () => (doc === null ? null : { version: "cas_v1", payload: doc, updatedAtMs: 0 }) } as unknown as ConfigPort
  return createConfigBackedRegistry({ config, clock: () => 0, idGen: () => "fixed", milvus, defaultDimension: 4, defaultMetric: "cosine" as never })
}

async function planOf(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<OperatorMutationPlan> {
  return Effect.runPromise(effect)
}
async function planError(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<string> {
  return (await Effect.runPromise(effect.pipe(Effect.flip))).type
}
/** Run the plan's deferred Milvus effect (the physically-built swap) exactly as `mutateAuthority` would. */
async function runEffect(plan: OperatorMutationPlan): Promise<OperatorMutationEffectResult> {
  return plan.effect ? plan.effect() : { ok: true }
}

const embeddingOf = (d: Doc) => d.embedding as Binding | null
const genOf = (d: Doc) => (d.embeddingGenerations ?? []) as Generation[]

describe("T006 — embedding reindex builds + validates a generation (FR5, FR6)", () => {
  test("a validated staged candidate reindex physically builds a generation, recorded validated", async () => {
    const seed: Doc = { providers: [], models: [{ id: "m1", providerProfileId: "p1", version: 1, displayName: "e", endpointMode: "embeddings", declaredCapabilityKinds: [], enabled: true, validationStatus: "validated" }], embedding: null, reranker: null, embeddingStaged: embedding({ version: 2, validated: true }), embeddingGenerations: [] }
    const fake = MilvusAdapter.createFakeMilvusAdapter()
    const reg = registryWith(seed, fake)
    const plan = await planOf(reg.planReindexEmbedding({ principal: PRINCIPAL }))
    // The build effect runs against the (fake) live Milvus — a physical generation, never a config-only flip.
    expect(await runEffect(plan)).toEqual({ ok: true })
    const next = plan.apply(seed) as Doc
    expect(genOf(next)).toHaveLength(1)
    expect(genOf(next)[0]!.state).toBe("validated")
  })

  test("reindex without a validated staged candidate is a typed not_validated, commits nothing", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: false }), embeddingGenerations: [] }
    const reg = registryWith(seed, MilvusAdapter.createFakeMilvusAdapter())
    expect(await planError(reg.planReindexEmbedding({ principal: PRINCIPAL }))).toBe("not_validated")
  })
})

describe("T006/T007 — embedding cutover honors the cardinal honesty rule (FR5)", () => {
  test("cutover with a built+validated generation swaps the alias, promotes to active, archives the prior + generation", async () => {
    const seed: Doc = {
      providers: [], models: [],
      embedding: embedding({ state: "active", version: 1, modelDescriptorId: "m_old" }),
      reranker: null,
      embeddingStaged: embedding({ state: "staged", version: 2, modelDescriptorId: "m_new", validated: true }),
      embeddingArchive: [],
      embeddingGenerations: [generation({ generationId: "gen_1", state: "validated", bindingVersion: 2 })],
      embeddingLiveGeneration: "gen_0",
    }
    const swaps: unknown[] = []
    const fake = MilvusAdapter.createFakeMilvusAdapter()
    const spy: MilvusPort = { ...fake, swapAliases: (i) => { swaps.push(i); return fake.swapAliases(i) } }
    const reg = registryWith(seed, spy)
    const plan = await planOf(reg.planCutoverEmbedding({ generationId: "gen_1", confirmed: true, principal: PRINCIPAL }))
    expect(await runEffect(plan)).toEqual({ ok: true })
    // The alias swap ran across every collection together (all four, never split).
    expect(swaps).toHaveLength(1)
    expect((swaps[0] as { targets: unknown[] }).targets).toHaveLength(4)
    const next = plan.apply(seed) as Doc
    expect(embeddingOf(next)?.state).toBe("active")
    expect(embeddingOf(next)?.modelDescriptorId).toBe("m_new")
    expect((next.embeddingArchive as Binding[])[0]!.modelDescriptorId).toBe("m_old")
    expect(next.embeddingLiveGeneration).toBe("gen_1")
    expect(genOf(next).find((g) => g.generationId === "gen_1")!.state).toBe("live")
  })

  test("cutover with NO built+validated generation is refused — never a config-only alias flip", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, version: 2 }), embeddingGenerations: [], embeddingLiveGeneration: null }
    const reg = registryWith(seed, MilvusAdapter.createFakeMilvusAdapter())
    // No `validated` generation exists — the cardinal honesty gate refuses.
    expect(await planError(reg.planCutoverEmbedding({ confirmed: true, principal: PRINCIPAL }))).toBe("no_candidate_staged")
  })

  test("an unconfirmed cutover returns confirmation_required and commits nothing", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, version: 2 }), embeddingGenerations: [generation({ state: "validated" })] }
    const reg = registryWith(seed, MilvusAdapter.createFakeMilvusAdapter())
    expect(await planError(reg.planCutoverEmbedding({ confirmed: false, principal: PRINCIPAL }))).toBe("confirmation_required")
  })

  test("a CAS contention in the swap effect aborts the commit (swaps nothing)", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, version: 2 }), embeddingGenerations: [generation({ generationId: "gen_1", state: "validated" })], embeddingLiveGeneration: "gen_1" }
    // The fake alias generation moved (casToken mismatch) → swapAliases fails cas_conflict.
    const contended = MilvusAdapter.createFakeMilvusAdapter({ casToken: "moved" })
    const reg = registryWith(seed, contended)
    const plan = await planOf(reg.planCutoverEmbedding({ generationId: "gen_1", confirmed: true, principal: PRINCIPAL }))
    const result = await runEffect(plan)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("conflict")
  })
})

describe("T007 — unconfigured Milvus degrades to the exact typed floor (FR4, FR16)", () => {
  test("cutover/rollback/reindex without a bound Milvus port are the same typed unavailable envelope as today", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, version: 2 }), embeddingGenerations: [generation({ state: "validated" })], embeddingArchive: [embedding({ state: "superseded", version: 1 })] }
    const reg = registryWith(seed) // no milvus port bound
    expect(await planError(reg.planReindexEmbedding({ principal: PRINCIPAL }))).toBe("unavailable")
    expect(await planError(reg.planCutoverEmbedding({ confirmed: true, principal: PRINCIPAL }))).toBe("unavailable")
    expect(await planError(reg.planRollbackEmbedding({ confirmed: true, principal: PRINCIPAL }))).toBe("unavailable")
  })
})

describe("T007 — embedding rollback restores a real archived prior (FR5)", () => {
  test("rollback restores the archived binding + superseded generation under the swap", async () => {
    const seed: Doc = {
      providers: [], models: [],
      embedding: embedding({ state: "active", version: 3, modelDescriptorId: "m_cur" }),
      reranker: null,
      embeddingArchive: [embedding({ state: "superseded", version: 2, modelDescriptorId: "m_prior" })],
      embeddingGenerations: [generation({ generationId: "gen_prior", state: "superseded", bindingVersion: 2 }), generation({ generationId: "gen_cur", state: "live", bindingVersion: 3 })],
      embeddingLiveGeneration: "gen_cur",
    }
    const reg = registryWith(seed, MilvusAdapter.createFakeMilvusAdapter())
    const plan = await planOf(reg.planRollbackEmbedding({ confirmed: true, principal: PRINCIPAL }))
    expect(await runEffect(plan)).toEqual({ ok: true })
    const next = plan.apply(seed) as Doc
    expect(embeddingOf(next)?.modelDescriptorId).toBe("m_prior")
    expect(next.embeddingLiveGeneration).toBe("gen_prior")
  })

  test("rollback with no superseded prior is a typed no_archived_prior", async () => {
    const seed: Doc = { providers: [], models: [], embedding: embedding({ state: "active", version: 1 }), reranker: null, embeddingArchive: [], embeddingGenerations: [] }
    const reg = registryWith(seed, MilvusAdapter.createFakeMilvusAdapter())
    expect(await planError(reg.planRollbackEmbedding({ confirmed: true, principal: PRINCIPAL }))).toBe("no_archived_prior")
  })
})
