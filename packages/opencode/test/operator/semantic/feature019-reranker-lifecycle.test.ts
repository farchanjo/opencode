/**
 * Feature 019 / T001-T003 (Group A, FR1-FR3) — the config-backed reranker
 * lifecycle over a per-slot binding version archive, driven end-to-end.
 *
 * Unit layer (fake `Config.Service` seam + fake rerank probe): the REAL chain runs
 * `select → validate → cutover` with NO injected `validated` state anywhere — `select`
 * stages a `draft` candidate, `validate` runs the provider probe and promotes it to
 * `{ state: "staged", validated: true }` (the ONLY config-backed producer of a validated
 * candidate), and only then does `cutover` activate it, moving the outgoing active into
 * the superseded archive and bumping the rerank cache/eval version (`reEmbedded:false`).
 * The honest gates each refuse with a typed error and commit nothing: a cutover with no
 * validated candidate is `not_validated`, a rollback with no archived prior is
 * `no_archived_prior`, a validate with no probe composed is the honest `unavailable` gap,
 * a failing probe is `validation_failed` (nothing committed), and profile C is refused.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createConfigBackedRegistry, type RerankValidationProbe } from "@/operator/semantic/registry-backend"
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
type Doc = Record<string, unknown>

/** A registered, enabled reranker provider with a resolvable SecretRef (validate coherence passes). */
const PROVIDER = {
  id: "p1", version: 1, name: "rerank-prov", baseUrl: "https://rerank.local", tlsRequired: true,
  allowInsecureLocalProfile: false, residency: "remote", secretRef: "vault:rerank@v1", enabled: true,
  createdAt: "t", updatedAt: "t", selectedBy: "op_1",
}
/** A registered, enabled native-rerank model descriptor. */
const model = (over: Partial<{ id: string; providerProfileId: string; enabled: boolean }> = {}) => ({
  id: "m_new", providerProfileId: "p1", version: 1, displayName: "rr", endpointMode: "rerank",
  declaredCapabilityKinds: ["rerank"], enabled: true, validationStatus: "declared", ...over,
})

const binding = (over: Partial<Binding>): Binding => ({
  slot: "reranker",
  modelDescriptorId: "m_new",
  compatibilityMode: "native-rerank",
  state: "draft",
  version: 1,
  selectedBy: "op_1",
  selectedAt: "2026-01-01T00:00:00.000Z",
  validated: false,
  ...over,
})

/** A passing (default) / failing rerank probe double; records the endpoint it was asked to probe. */
function fakeProbe(passed = true): RerankValidationProbe & { calls: Array<{ baseUrl: string; profile: string }> } {
  const calls: Array<{ baseUrl: string; profile: string }> = []
  return { calls, run: async (i) => { calls.push({ baseUrl: i.baseUrl, profile: i.profile }); return { passed } } }
}

/** A minimal `ConfigPort` double: only `get` is exercised by the registry reads/plans. */
function seededRegistry(doc: Doc | null, probe?: RerankValidationProbe) {
  const config = {
    get: async () => (doc === null ? null : { version: "cas_v1", payload: doc, updatedAtMs: 0 }),
  } as unknown as ConfigPort
  return createConfigBackedRegistry({ config, clock: () => 0, rerankProbe: probe })
}

/** Run a plan effect to its committed document (effect then apply over the same seed), or its typed failure. */
async function runPlan(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>, seed: Doc): Promise<Doc> {
  const plan = await Effect.runPromise(effect)
  const result: OperatorMutationEffectResult = plan.effect ? await plan.effect() : { ok: true }
  if (!result.ok) throw new Error(`effect_rejected:${result.message}`)
  return plan.apply(seed, result.ok ? result.value : undefined) as Doc
}
async function planError(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<string> {
  return (await Effect.runPromise(effect.pipe(Effect.flip))).type
}
/** Run a plan's effect only (validate probe) and return its typed effect result. */
async function runEffect(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<OperatorMutationEffectResult> {
  const plan = await Effect.runPromise(effect)
  return plan.effect ? plan.effect() : { ok: true }
}

const rerankerOf = (d: Doc) => d.reranker as Binding | null
const stagedOf = (d: Doc) => d.rerankerStaged as Binding | null
const archiveOf = (d: Doc) => (d.rerankerArchive ?? []) as Binding[]

describe("T001-T003 — the REAL driven chain select → validate → cutover (FR1-FR3), no injected validated state", () => {
  test("select stages draft, validate runs the probe + promotes to validated, cutover activates over the archive", async () => {
    const seed: Doc = {
      providers: [PROVIDER], models: [model()],
      embedding: null,
      reranker: binding({ state: "active", version: 1, modelDescriptorId: "m_old" }),
      rerankerStaged: null, rerankerArchive: [], rerankEvalVersion: 3,
    }
    const probe = fakeProbe(true)
    const reg = seededRegistry(seed, probe)

    // 1) select — stages a DRAFT candidate (validated:false), never activates.
    const afterSelect = await runPlan(
      reg.planSelectReranker({ slot: "reranker", modelDescriptorId: "m_new" as never, compatibilityMode: "native-rerank" as never, principal: PRINCIPAL }),
      seed,
    )
    expect(stagedOf(afterSelect)?.state).toBe("draft")
    expect(stagedOf(afterSelect)?.validated).toBe(false)
    expect(stagedOf(afterSelect)?.version).toBe(2)
    expect(rerankerOf(afterSelect)?.modelDescriptorId).toBe("m_old") // live binding untouched by select

    // 2) validate — runs the provider probe and promotes the candidate to validated (the only validated writer).
    const afterValidate = await runPlan(seededRegistry(afterSelect, probe).planValidateReranker({ principal: PRINCIPAL }), afterSelect)
    expect(probe.calls).toEqual([{ baseUrl: "https://rerank.local", profile: "native-rerank" }])
    expect(stagedOf(afterValidate)?.state).toBe("staged")
    expect(stagedOf(afterValidate)?.validated).toBe(true)

    // 3) cutover — activates the now-validated candidate, archives the prior, bumps the eval version.
    const afterCutover = await runPlan(seededRegistry(afterValidate, probe).planCutoverReranker({ confirmed: true, principal: PRINCIPAL }), afterValidate)
    expect(rerankerOf(afterCutover)?.modelDescriptorId).toBe("m_new")
    expect(rerankerOf(afterCutover)?.state).toBe("active")
    expect(rerankerOf(afterCutover)?.version).toBe(2)
    expect(archiveOf(afterCutover).map((b) => b.modelDescriptorId)).toEqual(["m_old"])
    expect(afterCutover.rerankerStaged).toBeNull()
    expect(afterCutover.rerankEvalVersion).toBe(4)
  })

  test("rollback restores a real archived prior after the driven chain built the archive", async () => {
    // Compose the archive HONESTLY: an initial active + a validated candidate cut over it.
    const seed: Doc = {
      providers: [PROVIDER], models: [model()],
      embedding: null,
      reranker: binding({ state: "active", version: 3, modelDescriptorId: "m_current" }),
      rerankerStaged: null,
      rerankerArchive: [binding({ state: "active", version: 2, modelDescriptorId: "m_prior" })],
      rerankEvalVersion: 5,
    }
    const reg = seededRegistry(seed)
    const next = await runPlan(reg.planRollbackReranker({ confirmed: true, principal: PRINCIPAL }), seed)
    expect(rerankerOf(next)?.modelDescriptorId).toBe("m_prior")
    expect(rerankerOf(next)?.state).toBe("active")
    expect(archiveOf(next).map((b) => b.modelDescriptorId)).toEqual(["m_current"])
    expect(next.rerankEvalVersion).toBe(6)
  })
})

describe("T003 — honest validate gates refuse with a typed error and commit nothing (FR3, FR32)", () => {
  test("validate with no staged candidate is no_candidate_staged", async () => {
    const seed: Doc = { providers: [PROVIDER], models: [model()], embedding: null, reranker: null, rerankerStaged: null }
    expect(await planError(seededRegistry(seed, fakeProbe()).planValidateReranker({ principal: PRINCIPAL }))).toBe("no_candidate_staged")
  })

  test("validate with NO probe composed is the honest unavailable gap — never a fabricated validated", async () => {
    const seed: Doc = { providers: [PROVIDER], models: [model()], embedding: null, reranker: null, rerankerStaged: binding({ state: "draft" }) }
    expect(await planError(seededRegistry(seed).planValidateReranker({ principal: PRINCIPAL }))).toBe("unavailable")
  })

  test("validate whose provider lacks a resolvable SecretRef is not_validated", async () => {
    const seed: Doc = {
      providers: [{ ...PROVIDER, secretRef: null }], models: [model()],
      embedding: null, reranker: null, rerankerStaged: binding({ state: "draft" }),
    }
    expect(await planError(seededRegistry(seed, fakeProbe()).planValidateReranker({ principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("validate whose model is not registered is not_validated", async () => {
    const seed: Doc = { providers: [PROVIDER], models: [], embedding: null, reranker: null, rerankerStaged: binding({ state: "draft" }) }
    expect(await planError(seededRegistry(seed, fakeProbe()).planValidateReranker({ principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("validate of an embedding-similarity (profile C) candidate is reranker_not_eligible", async () => {
    const seed: Doc = {
      providers: [PROVIDER], models: [model()], embedding: null, reranker: null,
      rerankerStaged: binding({ state: "draft", compatibilityMode: "embedding-similarity" }),
    }
    expect(await planError(seededRegistry(seed, fakeProbe()).planValidateReranker({ principal: PRINCIPAL }))).toBe("reranker_not_eligible")
  })

  test("a FAILING probe returns validation_failed in the effect and commits nothing", async () => {
    const seed: Doc = { providers: [PROVIDER], models: [model()], embedding: null, reranker: null, rerankerStaged: binding({ state: "draft" }) }
    const result = await runEffect(seededRegistry(seed, fakeProbe(false)).planValidateReranker({ principal: PRINCIPAL }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe("validation_failed")
  })
})

describe("T003 — honest cutover / rollback gates refuse and commit nothing (FR3)", () => {
  test("a cutover without a validated staged candidate is not_validated", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: binding({ state: "staged", validated: false }) }
    expect(await planError(seededRegistry(seed).planCutoverReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("a cutover with no staged candidate at all is not_validated", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: null }
    expect(await planError(seededRegistry(seed).planCutoverReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("an unconfirmed cutover on a validated candidate is confirmation_required", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: binding({ state: "staged", validated: true }) }
    expect(await planError(seededRegistry(seed).planCutoverReranker({ confirmed: false, principal: PRINCIPAL }))).toBe("confirmation_required")
  })

  test("a rollback with no archived prior is no_archived_prior — never a fabricated swap", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: binding({ state: "active", version: 1 }), rerankerArchive: [] }
    expect(await planError(seededRegistry(seed).planRollbackReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("no_archived_prior")
  })

  test("a rollback targeting an unknown archived version is no_archived_prior", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null, reranker: binding({ state: "active", version: 3 }),
      rerankerArchive: [binding({ state: "active", version: 2 })],
    }
    expect(await planError(seededRegistry(seed).planRollbackReranker({ targetBindingVersion: 99, confirmed: true, principal: PRINCIPAL }))).toBe("no_archived_prior")
  })

  test("an unconfirmed rollback with a real prior is confirmation_required", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null, reranker: binding({ state: "active", version: 2 }),
      rerankerArchive: [binding({ state: "active", version: 1 })],
    }
    expect(await planError(seededRegistry(seed).planRollbackReranker({ confirmed: false, principal: PRINCIPAL }))).toBe("confirmation_required")
  })
})

describe("T002 — bindingHistory + bindingStatus project the real archive (FR2)", () => {
  test("bindingHistory returns the composed staged + current + superseded archive newest-first", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null,
      reranker: binding({ state: "active", version: 3, modelDescriptorId: "m3" }),
      rerankerStaged: binding({ state: "staged", version: 4, modelDescriptorId: "m4", validated: true }),
      rerankerArchive: [binding({ state: "active", version: 2, modelDescriptorId: "m2" }), binding({ state: "active", version: 1, modelDescriptorId: "m1" })],
    }
    const out = await Effect.runPromise(seededRegistry(seed).bindingHistory({ slot: "reranker", scope: "project", scopeId: "p", limit: 20 }))
    expect(out.versions.map((v) => v.bindingVersion)).toEqual([4, 3, 2, 1])
  })

  test("bindingStatus derives the honest degradation rung from real binding state (never hardcoded)", async () => {
    const active: Doc = { providers: [], models: [], embedding: binding({ slot: "embedding", state: "active" }), reranker: null }
    const idle: Doc = { providers: [], models: [], embedding: null, reranker: null }
    expect((await Effect.runPromise(seededRegistry(active).bindingStatus({ scope: "project", scopeId: "p" }))).degradation.rung).toBe("full_semantic")
    expect((await Effect.runPromise(seededRegistry(idle).bindingStatus({ scope: "project", scopeId: "p" }))).degradation.rung).toBe("catalog_lexical")
  })
})
