/**
 * Feature 019 / T006-T007 (Group B2, FR5) — the config-backed embedding lifecycle
 * (select → reindex → validate → cutover / rollback) composed over a live Milvus port,
 * driven end-to-end with NO injected `validated` state.
 *
 * Unit layer (fake `Config.Service` seam + fake Milvus adapter): `select` stages a
 * `draft` candidate; `reindex` physically builds + validates a blue/green generation for
 * it (the candidate is NOT yet validated — reindex PRECEDES validate); `validate`, under
 * the cardinal honesty rule, promotes the candidate to `{ state: "staged", validated:
 * true }` ONLY because a matching validated generation exists (reindex-first); and only
 * then does `cutover` swap the alias across EVERY collection together, archiving the
 * outgoing binding + generation. A CAS contention swaps nothing; a validate/cutover/
 * reindex/rollback with no bound Milvus port degrades to the EXACT typed `unavailable`
 * (`milvus_unavailable`) floor. Every mutation commits through the plan the dispatcher
 * owns — a rejection persists nothing.
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

/** A registered, enabled embedding provider + model (validate coherence passes). */
const PROVIDER = {
  id: "p1", version: 1, name: "emb-prov", baseUrl: "https://emb.local", tlsRequired: true,
  allowInsecureLocalProfile: false, residency: "remote", secretRef: "vault:emb@v1", enabled: true,
  createdAt: "t", updatedAt: "t", selectedBy: "op_1",
}
const MODEL = {
  id: "m_new", providerProfileId: "p1", version: 1, displayName: "emb", endpointMode: "embeddings",
  declaredCapabilityKinds: ["embedding"], enabled: true, validationStatus: "declared",
}

const embedding = (over: Partial<Binding>): Binding => ({
  slot: "embedding",
  modelDescriptorId: "m_new",
  compatibilityMode: "embedding",
  state: "draft",
  version: 1,
  selectedBy: "op_1",
  selectedAt: "2026-01-01T00:00:00.000Z",
  validated: false,
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

async function planError(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<string> {
  return (await Effect.runPromise(effect.pipe(Effect.flip))).type
}
/** Run a plan's deferred Milvus effect (physical build/swap) then apply over the seed, as `mutateAuthority` would. */
async function runPlan(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>, seed: Doc): Promise<Doc> {
  const plan = await Effect.runPromise(effect)
  const result: OperatorMutationEffectResult = plan.effect ? await plan.effect() : { ok: true }
  if (!result.ok) throw new Error(`effect_rejected:${result.message}`)
  return plan.apply(seed, result.ok ? result.value : undefined) as Doc
}
async function runEffect(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<OperatorMutationEffectResult> {
  const plan = await Effect.runPromise(effect)
  return plan.effect ? plan.effect() : { ok: true }
}

const embeddingOf = (d: Doc) => d.embedding as Binding | null
const stagedOf = (d: Doc) => d.embeddingStaged as Binding | null
const genOf = (d: Doc) => (d.embeddingGenerations ?? []) as Generation[]

describe("T006-T007 — the REAL driven chain select → reindex → validate → cutover (FR5, FR6), no injected validated state", () => {
  test("select stages draft, reindex builds a generation, validate promotes it, cutover swaps the alias + archives the prior", async () => {
    const seed: Doc = {
      providers: [PROVIDER], models: [MODEL],
      embedding: embedding({ state: "active", version: 1, modelDescriptorId: "m_old" }),
      reranker: null, embeddingStaged: null, embeddingArchive: [],
      embeddingGenerations: [], embeddingLiveGeneration: "gen_0",
    }
    const swaps: unknown[] = []
    const fake = MilvusAdapter.createFakeMilvusAdapter()
    const spy: MilvusPort = { ...fake, swapAliases: (i) => { swaps.push(i); return fake.swapAliases(i) } }

    // 1) select — stages a DRAFT candidate (validated:false), never activates.
    const afterSelect = await runPlan(
      registryWith(seed, spy).planSelectEmbedding({ slot: "embedding", modelDescriptorId: "m_new" as never, compatibilityMode: "embedding" as never, principal: PRINCIPAL }),
      seed,
    )
    expect(stagedOf(afterSelect)?.state).toBe("draft")
    expect(stagedOf(afterSelect)?.validated).toBe(false)
    expect(stagedOf(afterSelect)?.version).toBe(2)

    // 2) reindex — physically builds + validates a generation for the DRAFT candidate (reindex precedes validate).
    const afterReindex = await runPlan(registryWith(afterSelect, spy).planReindexEmbedding({ principal: PRINCIPAL }), afterSelect)
    expect(genOf(afterReindex)).toHaveLength(1)
    expect(genOf(afterReindex)[0]!.state).toBe("validated")
    expect(genOf(afterReindex)[0]!.bindingVersion).toBe(2)
    expect(stagedOf(afterReindex)?.validated).toBe(false) // still not validated — the generation is, the binding is not

    // 3) validate — cardinal honesty: promotes the candidate ONLY because a matching validated generation exists.
    const afterValidate = await runPlan(registryWith(afterReindex, spy).planValidateEmbedding({ principal: PRINCIPAL }), afterReindex)
    expect(stagedOf(afterValidate)?.state).toBe("staged")
    expect(stagedOf(afterValidate)?.validated).toBe(true)

    // 4) cutover — swaps the alias across ALL four collections together, promotes to active, archives the prior.
    const afterCutover = await runPlan(
      registryWith(afterValidate, spy).planCutoverEmbedding({ generationId: "gen_fixed", confirmed: true, principal: PRINCIPAL }),
      afterValidate,
    )
    expect(swaps).toHaveLength(1)
    expect((swaps[0] as { targets: unknown[] }).targets).toHaveLength(4)
    expect(embeddingOf(afterCutover)?.state).toBe("active")
    expect(embeddingOf(afterCutover)?.modelDescriptorId).toBe("m_new")
    expect((afterCutover.embeddingArchive as Binding[])[0]!.modelDescriptorId).toBe("m_old")
    expect(afterCutover.embeddingLiveGeneration).toBe("gen_fixed")
    expect(genOf(afterCutover).find((g) => g.generationId === "gen_fixed")!.state).toBe("live")
  })
})

describe("T006 — reindex builds for a selected candidate, refuses an empty slot (FR5, FR6)", () => {
  test("reindex with no staged candidate is no_candidate_staged, commits nothing", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: null, embeddingGenerations: [] }
    expect(await planError(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planReindexEmbedding({ principal: PRINCIPAL }))).toBe("no_candidate_staged")
  })
})

describe("T006 — validate honors the cardinal honesty rule: reindex-first (FR5)", () => {
  test("validate BEFORE reindex (no matching validated generation) is not_validated — reindex-first", async () => {
    const seed: Doc = { providers: [PROVIDER], models: [MODEL], embedding: null, reranker: null, embeddingStaged: embedding({ state: "draft", version: 2 }), embeddingGenerations: [] }
    expect(await planError(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planValidateEmbedding({ principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("validate with no staged candidate is no_candidate_staged", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: null, embeddingGenerations: [] }
    expect(await planError(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planValidateEmbedding({ principal: PRINCIPAL }))).toBe("no_candidate_staged")
  })
})

describe("T006/T007 — embedding cutover honors the cardinal honesty rule (FR5)", () => {
  test("cutover with NO built+validated generation is refused — never a config-only alias flip", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, state: "staged", version: 2 }), embeddingGenerations: [], embeddingLiveGeneration: null }
    expect(await planError(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planCutoverEmbedding({ confirmed: true, principal: PRINCIPAL }))).toBe("no_candidate_staged")
  })

  test("an unconfirmed cutover returns confirmation_required and commits nothing", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, state: "staged", version: 2 }), embeddingGenerations: [generation({ state: "validated" })] }
    expect(await planError(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planCutoverEmbedding({ confirmed: false, principal: PRINCIPAL }))).toBe("confirmation_required")
  })

  test("a CAS contention in the swap effect aborts the commit (swaps nothing)", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, state: "staged", version: 2 }), embeddingGenerations: [generation({ generationId: "gen_1", state: "validated" })], embeddingLiveGeneration: "gen_1" }
    const contended = MilvusAdapter.createFakeMilvusAdapter({ casToken: "moved" })
    const result = await runEffect(registryWith(seed, contended).planCutoverEmbedding({ generationId: "gen_1", confirmed: true, principal: PRINCIPAL }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("conflict")
  })
})

describe("T007 — unconfigured Milvus degrades to the exact typed floor (FR4, FR16)", () => {
  test("validate/cutover/rollback/reindex without a bound Milvus port are the same typed unavailable envelope as today", async () => {
    const seed: Doc = { providers: [PROVIDER], models: [MODEL], embedding: null, reranker: null, embeddingStaged: embedding({ validated: true, state: "staged", version: 2 }), embeddingGenerations: [generation({ state: "validated" })], embeddingArchive: [embedding({ state: "superseded", version: 1 })] }
    const reg = registryWith(seed) // no milvus port bound
    expect(await planError(reg.planReindexEmbedding({ principal: PRINCIPAL }))).toBe("unavailable")
    expect(await planError(reg.planValidateEmbedding({ principal: PRINCIPAL }))).toBe("unavailable")
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
    const next = await runPlan(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planRollbackEmbedding({ confirmed: true, principal: PRINCIPAL }), seed)
    expect(embeddingOf(next)?.modelDescriptorId).toBe("m_prior")
    expect(next.embeddingLiveGeneration).toBe("gen_prior")
  })

  test("rollback with no superseded prior is a typed no_archived_prior", async () => {
    const seed: Doc = { providers: [], models: [], embedding: embedding({ state: "active", version: 1 }), reranker: null, embeddingArchive: [], embeddingGenerations: [] }
    expect(await planError(registryWith(seed, MilvusAdapter.createFakeMilvusAdapter()).planRollbackEmbedding({ confirmed: true, principal: PRINCIPAL }))).toBe("no_archived_prior")
  })
})
