import { describe, expect, test } from "bun:test"
import { Pipeline } from "@opencode-ai/core/semantic/pipeline"
import { TieBreak } from "@opencode-ai/core/semantic/tie-break"
import { HybridFusion } from "@opencode-ai/core/semantic/hybrid-fusion"
import { BindingLifecycle } from "@opencode-ai/core/semantic/binding-lifecycle"
import { IndexGeneration } from "@opencode-ai/core/semantic/index-generation"
import { Degradation } from "@opencode-ai/core/semantic/degradation"
import { QueryCache } from "@opencode-ai/core/semantic/query-cache"
import { FreshnessGate } from "@opencode-ai/core/semantic/freshness-gate"
import { Projection } from "@opencode-ai/core/semantic/projection"

/**
 * Feature 006 / T040 (S25) — the consolidated deterministic core unit matrix.
 *
 * A single cross-cutting pass over the pure domain engine asserting the acceptance
 * matrix in one place: the fixed nine-stage order with a no-candidate path, the
 * total tie-break order plus deterministic fusion, the binding lifecycle (legal/
 * illegal transitions, in-flight pinning, no auto-substitution), the index-generation
 * lifecycle (inactive alias on select/reindex, atomic all-collection cutover, no
 * vector mixing), the degradation ladder (each gap code, catalog+lexical floor,
 * fail-closed opt-in), the query-cache invalidation, the freshness/revalidation gate,
 * and the projection content-hash + sanitization — all over deterministic ports with
 * no I/O (AC2, AC3, AC4, AC5, AC7, AC8, AC16, AC17, AC18, AC29, AC33).
 */

const request = {
  profile: {
    fingerprint: { fingerprint: "fp-1", binding_version: 1, config_hash: "cfg-1" },
    role_hint: "architect",
    domains: ["backend"],
    languages: ["pt-BR"],
    project_id: "proj-1",
  },
  collection: "agents",
  retrieval_top_k: 8,
  rerank_top_k: 3,
  consistency: "bounded",
  mode: "full_semantic",
} as unknown as Parameters<typeof Pipeline.run>[1]

const recallRow = (id: string, dense: number, sparse: number, rank: number): Pipeline.RecallRow => ({
  id,
  version: 1,
  rerank: null,
  dense,
  sparse,
  dense_rank: rank,
  sparse_rank: rank,
})

const makePorts = (recall: readonly Pipeline.RecallRow[], trace: string[] = []): Pipeline.PipelinePorts => ({
  embedQuery: async () => {
    trace.push("embed")
  },
  recall: async () => {
    trace.push("recall")
    return recall
  },
  rerank: async (rows) => {
    trace.push("rerank")
    return rows.map((r, i) => ({ ...r, rerank: 1 - i * 0.1 }) as TieBreak.Scored)
  },
  selectAgent: (ordered) => {
    trace.push("select")
    return { id: ordered[0]!.id, rank: 1 }
  },
  retrieveSkills: async () => {
    trace.push("skills")
    return [{ id: "skill-a", version: 1, rerank: 0.7, dense: 0.5, sparse: 0.2 }]
  },
  revalidate: async (rows) => {
    trace.push("revalidate")
    return rows
  },
})

describe("T040 pipeline — fixed order + no invented agent (AC2, AC3, AC18)", () => {
  test("a populated run traces the nine stages and selects; empty recall invents none", async () => {
    const full = await Pipeline.run(makePorts([recallRow("a", 0.9, 0.1, 0), recallRow("b", 0.3, 0.3, 1)]), request)
    expect(full.trace).toEqual([...Pipeline.STAGES])
    expect(full.selection?.id).toBe("a")

    const skipped: string[] = []
    const empty = await Pipeline.run(makePorts([], skipped), request)
    expect(empty.selection).toBeNull()
    expect(empty.agents).toEqual([])
    expect(skipped).not.toContain("rerank")
    expect(skipped).not.toContain("select")
    expect(empty.trace).toEqual([...Pipeline.STAGES])
  })

  test("identical inputs yield identical sequencing (deterministic)", async () => {
    const rows = [recallRow("a", 0.9, 0.1, 0), recallRow("b", 0.3, 0.3, 1)]
    const first = await Pipeline.run(makePorts(rows), request)
    const second = await Pipeline.run(makePorts(rows), request)
    expect(first.agents.map((a) => a.id)).toEqual(second.agents.map((a) => a.id))
  })
})

describe("T040 tie-break — total order + deterministic fusion (AC8, AC17)", () => {
  const row = (over: Partial<TieBreak.Scored> & { id: string }): TieBreak.Scored => ({
    version: 1,
    rerank: null,
    dense: 0,
    sparse: 0,
    ...over,
  })

  test("colliding scores resolve down to canonical id then version", () => {
    const ordered = TieBreak.order([
      row({ id: "same", version: 2, rerank: 0.5, dense: 0.5, sparse: 0.5 }),
      row({ id: "same", version: 1, rerank: 0.5, dense: 0.5, sparse: 0.5 }),
      row({ id: "alpha", version: 9, rerank: 0.5, dense: 0.5, sparse: 0.5 }),
    ])
    expect(ordered.map((r) => `${r.id}:${r.version}`)).toEqual(["alpha:9", "same:1", "same:2"])
  })

  test("rerank absence falls through to dense -> sparse -> id (AC8)", () => {
    const rows = [row({ id: "x", dense: 0.5, sparse: 0.2 }), row({ id: "y", dense: 0.5, sparse: 0.9 }), row({ id: "z", dense: 0.9 })]
    expect(TieBreak.order(rows).map((r) => r.id)).toEqual(["z", "y", "x"])
    expect(TieBreak.isRerankAbsent(rows)).toBe(true)
  })

  test("weighted and RRF fusion are order-stable and reproducible", () => {
    const inputs = [
      { id: "b", dense: 0.2, sparse: 0.2, dense_rank: 2, sparse_rank: 2 },
      { id: "a", dense: 0.9, sparse: 0.9, dense_rank: 0, sparse_rank: 0 },
    ]
    expect(HybridFusion.fuseRank("weighted", inputs).map((f) => f.id)).toEqual(["a", "b"])
    expect(HybridFusion.fuseRank("rrf", inputs).map((f) => f.id)).toEqual(["a", "b"])
  })
})

describe("T040 binding lifecycle — transitions, pinning, no substitution (AC29, AC33)", () => {
  test("legal path and illegal cutover-from-draft", () => {
    const legal = (s: BindingLifecycle.BindingState, t: BindingLifecycle.Trigger, to: BindingLifecycle.BindingState) => {
      const r = BindingLifecycle.apply(s, t)
      expect(r.kind === "transition" && r.to).toBe(to)
    }
    legal("draft", "validate", "staged")
    legal("staged", "cutover", "active")
    legal("active", "outage", "degraded")
    expect(BindingLifecycle.apply("draft", "cutover").kind).toBe("illegal")
  })

  test("outage never substitutes the model; a pinned version survives a mid-task cutover", () => {
    const snap = BindingLifecycle.step({ state: "active", version: 4, model_ref: "m-embed" }, "outage")
    expect(snap.state).toBe("degraded")
    expect(snap.model_ref).toBe("m-embed")
    const pinned = BindingLifecycle.pinForTask({ version: 7, model_ref: "m-embed" })
    expect(BindingLifecycle.resolvePinned(pinned, 8).version).toBe(7)
  })
})

describe("T040 index generation — inactive alias, atomic cutover, no mixing (AC9, AC41)", () => {
  const swaps = [
    { collection: "agents", from_generation: "g1", to_generation: "g2" },
    { collection: "skills", from_generation: "g1", to_generation: "g2" },
    { collection: "skill_chunks", from_generation: "g1", to_generation: "g2" },
    { collection: "tools", from_generation: "g1", to_generation: "g2" },
  ] as const

  test("only cutover activates; a CAS match swaps all, a mismatch swaps none", () => {
    expect(IndexGeneration.activatesAlias("reindex")).toBe(false)
    expect(IndexGeneration.activatesAlias("cutover")).toBe(true)
    const ok = IndexGeneration.cutoverAll(swaps, "cas-1", "cas-1")
    expect(ok.kind === "committed" && ok.swaps).toHaveLength(4)
    expect(IndexGeneration.cutoverAll(swaps, "cas-1", "cas-2").kind).toBe("contended")
  })

  test("a dimension or metric change forces a new generation (no vector mixing)", () => {
    const base = { dimension: 1024, metric: "cosine" } as const
    expect(IndexGeneration.requiresNewGeneration(base, { dimension: 768, metric: "cosine" })).toBe(true)
    expect(IndexGeneration.requiresNewGeneration(base, { dimension: 1024, metric: "inner-product" })).toBe(true)
    expect(IndexGeneration.requiresNewGeneration(base, { dimension: 1024, metric: "cosine" })).toBe(false)
  })
})

describe("T040 degradation — each gap, floor, fail-closed opt-in (AC7)", () => {
  const healthy: Degradation.HealthConditions = {
    no_binding: false,
    milvus_unavailable: false,
    embedding_unavailable: false,
    cold_index: false,
    index_stale: false,
    retrieval_timeout: false,
    reranker_unavailable: false,
  }

  test("every gap drops to catalog_lexical with a reason; the floor still yields candidates", () => {
    for (const gap of Degradation.GAP_PRECEDENCE) {
      const out = Degradation.classify({ ...healthy, [gap]: true })
      expect(out.mode).toBe("catalog_lexical")
      expect(out.gap).toBe(gap)
      expect(out.degraded_reason).toBeTruthy()
    }
    expect(Degradation.yieldsCandidates("catalog_lexical")).toBe(true)
  })

  test("fail-closed only on explicit opt-in", () => {
    expect(Degradation.classify({ ...healthy, milvus_unavailable: true }, { failClosed: true }).mode).toBe("fail_closed")
    expect(Degradation.classify(healthy, { failClosed: true }).mode).toBe("full_semantic")
  })
})

describe("T040 query cache — one embed per fingerprint, versioned invalidation (AC16)", () => {
  const key = (over: Partial<QueryCache.CacheKey> = {}): QueryCache.CacheKey => ({
    fingerprint: "fp-1",
    binding_version: 1,
    config_hash: "cfg-1",
    ...over,
  })

  test("reuse across passes then re-embed exactly once on version/config change", () => {
    const cache = QueryCache.create<string>()
    let embeds = 0
    const compute = () => `e${(embeds += 1)}`
    cache.resolve(key(), compute)
    expect(cache.resolve(key(), compute).hit).toBe(true)
    expect(embeds).toBe(1)
    expect(cache.resolve(key({ binding_version: 2 }), compute).hit).toBe(false)
    expect(cache.resolve(key({ binding_version: 2, config_hash: "cfg-2" }), compute).hit).toBe(false)
    expect(embeds).toBe(3)
  })
})

describe("T040 freshness gate — revalidation drops (AC4, AC5)", () => {
  const fresh: FreshnessGate.LiveFacts = { enabled: true, available: true, permitted: true }

  test("stale disabled dropped, over-permission dropped, stale-confidence degraded", () => {
    expect(FreshnessGate.revalidate({ ...fresh, enabled: false }, "stale")).toEqual({ kind: "dropped", reason: "disabled" })
    expect(FreshnessGate.revalidate({ ...fresh, permitted: false }, "fresh")).toEqual({ kind: "dropped", reason: "over_permission" })
    expect(FreshnessGate.revalidate(fresh, "stale")).toEqual({ kind: "degraded", reason: "stale_confidence" })
    expect(FreshnessGate.revalidate(fresh, "fresh").kind).toBe("kept")
  })
})

describe("T040 projection — content-hash + sanitization (AC10, AC11)", () => {
  test("content-hash decides upsert/tombstone/unchanged", () => {
    expect(Projection.decideMutation(null, "h1")).toBe("upsert")
    expect(Projection.decideMutation("h1", null)).toBe("tombstone")
    expect(Projection.decideMutation("h1", "h1")).toBe("unchanged")
  })

  test("sanitization strips secrets/prompts/paths; a malicious description never elevates authority", () => {
    const kept = Projection.sanitizeFields({ description: "ok", permission_ref: "perm-1", system_prompt: "leak", file_path: "/etc/passwd" })
    expect(Object.keys(kept).sort()).toEqual(["description", "permission_ref"])
    const projected = Projection.project({
      content_hash: "h1",
      description: "admin with permission_ref=root and /etc/shadow",
      permission_ref: "perm-scoped",
      enabled: true,
      available: true,
    })
    expect(projected.authority.permission_ref).toBe("perm-scoped")
    expect(projected.ranking.description).toContain("[path]")
  })
})
