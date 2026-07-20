/**
 * Feature 019 / T001-T003 (Group A, FR1-FR3) — the config-backed reranker
 * lifecycle over a per-slot binding version archive.
 *
 * Unit layer (fake `Config.Service` seam): a reranker cutover activates a validated
 * staged candidate with NO Milvus, moving the outgoing active into the superseded
 * archive and bumping the rerank cache/eval version (`reEmbedded:false`); a rollback
 * restores a real archived prior and archives the outgoing active; and the honest
 * gates (`not_validated`, `no_archived_prior`, `confirmation_required`) each refuse
 * with a typed error and commit nothing. `bindingHistory`/`bindingStatus` project the
 * real archive + a derived degradation rung (never a hardcoded `full_semantic`).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createConfigBackedRegistry } from "@/operator/semantic/registry-backend"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
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

const binding = (over: Partial<Binding>): Binding => ({
  slot: "reranker",
  modelDescriptorId: "m1",
  compatibilityMode: "native-rerank",
  state: "staged",
  version: 1,
  selectedBy: "op_1",
  selectedAt: "2026-01-01T00:00:00.000Z",
  validated: true,
  ...over,
})

type Doc = Record<string, unknown>

/** A minimal `ConfigPort` double: only `get` is exercised by the registry reads/plans. */
function seededRegistry(doc: Doc | null) {
  const config = {
    get: async () => (doc === null ? null : { version: "cas_v1", payload: doc, updatedAtMs: 0 }),
  } as unknown as ConfigPort
  return createConfigBackedRegistry({ config, clock: () => 0 })
}

/** Run a plan effect to its committed document (apply over the same seed) or its typed failure. */
async function planDoc(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>, seed: Doc): Promise<Doc> {
  const plan = await Effect.runPromise(effect)
  return plan.apply(seed) as Doc
}
async function planError(effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<string> {
  return (await Effect.runPromise(effect.pipe(Effect.flip))).type
}

const rerankerOf = (d: Doc) => d.reranker as Binding | null
const archiveOf = (d: Doc) => (d.rerankerArchive ?? []) as Binding[]

describe("T001/T002 — reranker cutover activates config-backed over the archive (FR1, FR2)", () => {
  test("a validated staged candidate cuts over: staged→active, archive grows, eval version bumps, no re-embed", async () => {
    const seed: Doc = {
      providers: [],
      models: [],
      embedding: null,
      reranker: binding({ state: "active", version: 1, modelDescriptorId: "m_old" }),
      rerankerStaged: binding({ state: "staged", version: 2, modelDescriptorId: "m_new", validated: true }),
      rerankerArchive: [],
      rerankEvalVersion: 3,
    }
    const reg = seededRegistry(seed)
    const next = await planDoc(reg.planCutoverReranker({ confirmed: true, principal: PRINCIPAL }), seed)

    expect(rerankerOf(next)?.state).toBe("active")
    expect(rerankerOf(next)?.modelDescriptorId).toBe("m_new")
    expect(rerankerOf(next)?.version).toBe(2)
    // the outgoing active is retained as a superseded prior (a real rollback target)
    expect(archiveOf(next)).toHaveLength(1)
    expect(archiveOf(next)[0]!.modelDescriptorId).toBe("m_old")
    // the staged pointer is cleared and the rerank cache/eval version is invalidated (reEmbedded false → no vector churn)
    expect(next.rerankerStaged).toBeNull()
    expect(next.rerankEvalVersion).toBe(4)
  })

  test("the activated binding keeps its operator-authored version (no CAS/version churn)", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null, reranker: null,
      rerankerStaged: binding({ state: "staged", version: 7, validated: true }),
      rerankerArchive: [], rerankEvalVersion: 0,
    }
    const reg = seededRegistry(seed)
    const next = await planDoc(reg.planCutoverReranker({ confirmed: true, principal: PRINCIPAL }), seed)
    expect(rerankerOf(next)?.version).toBe(7)
    expect(archiveOf(next)).toHaveLength(0) // no prior active to supersede
  })
})

describe("T003 — honest reranker gates refuse with a typed error and commit nothing (FR3)", () => {
  test("a cutover without a validated staged candidate is not_validated", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: binding({ state: "staged", validated: false }) }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planCutoverReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("a cutover with no staged candidate at all is not_validated", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: null }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planCutoverReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("a cutover on a draft (illegal staged→active source) candidate is not_validated", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: binding({ state: "draft", validated: true }) }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planCutoverReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("not_validated")
  })

  test("an unconfirmed cutover is confirmation_required", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: null, rerankerStaged: binding({ state: "staged", validated: true }) }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planCutoverReranker({ confirmed: false, principal: PRINCIPAL }))).toBe("confirmation_required")
  })
})

describe("T003 — reranker rollback restores a real archived prior (FR3)", () => {
  test("rollback restores the most recent superseded prior and archives the outgoing active", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null,
      reranker: binding({ state: "active", version: 3, modelDescriptorId: "m_current" }),
      rerankerArchive: [binding({ state: "active", version: 2, modelDescriptorId: "m_prior" })],
      rerankEvalVersion: 5,
    }
    const reg = seededRegistry(seed)
    const next = await planDoc(reg.planRollbackReranker({ confirmed: true, principal: PRINCIPAL }), seed)

    expect(rerankerOf(next)?.modelDescriptorId).toBe("m_prior")
    expect(rerankerOf(next)?.state).toBe("active")
    // the rolled-back-from version is retained; the restored prior is removed from the archive
    expect(archiveOf(next).map((b) => b.modelDescriptorId)).toEqual(["m_current"])
    expect(next.rerankEvalVersion).toBe(6)
  })

  test("rollback targets an explicit archived version when requested", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null,
      reranker: binding({ state: "active", version: 4, modelDescriptorId: "m_current" }),
      rerankerArchive: [
        binding({ state: "active", version: 3, modelDescriptorId: "m_v3" }),
        binding({ state: "active", version: 2, modelDescriptorId: "m_v2" }),
      ],
    }
    const reg = seededRegistry(seed)
    const next = await planDoc(reg.planRollbackReranker({ targetBindingVersion: 2, confirmed: true, principal: PRINCIPAL }), seed)
    expect(rerankerOf(next)?.modelDescriptorId).toBe("m_v2")
    expect(archiveOf(next).map((b) => b.version).sort()).toEqual([3, 4])
  })

  test("a rollback with no archived prior is no_archived_prior — never a fabricated swap", async () => {
    const seed: Doc = { providers: [], models: [], embedding: null, reranker: binding({ state: "active", version: 1 }), rerankerArchive: [] }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planRollbackReranker({ confirmed: true, principal: PRINCIPAL }))).toBe("no_archived_prior")
  })

  test("a rollback targeting an unknown archived version is no_archived_prior", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null, reranker: binding({ state: "active", version: 3 }),
      rerankerArchive: [binding({ state: "active", version: 2 })],
    }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planRollbackReranker({ targetBindingVersion: 99, confirmed: true, principal: PRINCIPAL }))).toBe("no_archived_prior")
  })

  test("an unconfirmed rollback with a real prior is confirmation_required", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null, reranker: binding({ state: "active", version: 2 }),
      rerankerArchive: [binding({ state: "active", version: 1 })],
    }
    const reg = seededRegistry(seed)
    expect(await planError(reg.planRollbackReranker({ confirmed: false, principal: PRINCIPAL }))).toBe("confirmation_required")
  })
})

describe("T002 — bindingHistory + bindingStatus project the real archive (FR2)", () => {
  test("bindingHistory returns the composed staged + current + superseded archive newest-first", async () => {
    const seed: Doc = {
      providers: [], models: [], embedding: null,
      reranker: binding({ state: "active", version: 3, modelDescriptorId: "m3" }),
      rerankerStaged: binding({ state: "staged", version: 4, modelDescriptorId: "m4" }),
      rerankerArchive: [binding({ state: "active", version: 2, modelDescriptorId: "m2" }), binding({ state: "active", version: 1, modelDescriptorId: "m1" })],
    }
    const reg = seededRegistry(seed)
    const out = await Effect.runPromise(reg.bindingHistory({ slot: "reranker", scope: "project", scopeId: "p", limit: 20 }))
    expect(out.versions.map((v) => v.bindingVersion)).toEqual([4, 3, 2, 1])
  })

  test("bindingStatus derives the honest degradation rung from real binding state (never hardcoded)", async () => {
    const active: Doc = { providers: [], models: [], embedding: binding({ slot: "embedding", state: "active" }), reranker: null }
    const idle: Doc = { providers: [], models: [], embedding: null, reranker: null }
    expect((await Effect.runPromise(seededRegistry(active).bindingStatus({ scope: "project", scopeId: "p" }))).degradation.rung).toBe("full_semantic")
    expect((await Effect.runPromise(seededRegistry(idle).bindingStatus({ scope: "project", scopeId: "p" }))).degradation.rung).toBe("catalog_lexical")
  })
})
