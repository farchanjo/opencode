import { describe, expect, test } from "bun:test"
import { TieBreak } from "@opencode-ai/core/semantic/tie-break"
import { HybridFusion } from "@opencode-ai/core/semantic/hybrid-fusion"

// Feature 006 / T016 (S7) — the deterministic tie-break total order and the
// hybrid dense+sparse fusion (FR4, FR19, C2, C7, AC1, AC17).

const row = (over: Partial<TieBreak.Scored> & { id: string }): TieBreak.Scored => ({
  version: 1,
  rerank: null,
  dense: 0,
  sparse: 0,
  ...over,
})

describe("TieBreak — total order rerank -> dense -> sparse -> id -> version", () => {
  test("rerank score is the first key (higher first)", () => {
    const ordered = TieBreak.order([row({ id: "b", rerank: 0.1 }), row({ id: "a", rerank: 0.9 })])
    expect(ordered.map((r) => r.id)).toEqual(["a", "b"])
  })

  test("rerank absence falls through to dense -> sparse -> id", () => {
    const rows = [
      row({ id: "x", dense: 0.5, sparse: 0.2 }),
      row({ id: "y", dense: 0.5, sparse: 0.9 }),
      row({ id: "z", dense: 0.9, sparse: 0.0 }),
    ]
    expect(TieBreak.order(rows).map((r) => r.id)).toEqual(["z", "y", "x"])
    expect(TieBreak.isRerankAbsent(rows)).toBe(true)
  })

  test("a present rerank ranks above an absent one", () => {
    const ordered = TieBreak.order([row({ id: "absent" }), row({ id: "present", rerank: -5 })])
    expect(ordered[0]!.id).toBe("present")
  })

  test("colliding scores resolve down to canonical id then version — a strict total order", () => {
    const rows = [
      row({ id: "same", version: 2, rerank: 0.5, dense: 0.5, sparse: 0.5 }),
      row({ id: "same", version: 1, rerank: 0.5, dense: 0.5, sparse: 0.5 }),
      row({ id: "alpha", version: 9, rerank: 0.5, dense: 0.5, sparse: 0.5 }),
    ]
    const ordered = TieBreak.order(rows)
    expect(ordered.map((r) => `${r.id}:${r.version}`)).toEqual(["alpha:9", "same:1", "same:2"])
  })

  test("identical inputs yield identical ordering and never mutate the input", () => {
    const rows = [row({ id: "b", dense: 0.3 }), row({ id: "a", dense: 0.3 }), row({ id: "c", dense: 0.7 })]
    const snapshot = rows.map((r) => r.id)
    expect(TieBreak.order(rows).map((r) => r.id)).toEqual(TieBreak.order(rows).map((r) => r.id))
    expect(rows.map((r) => r.id)).toEqual(snapshot)
  })

  test("all-null rerank set is NaN-free (no infinity arithmetic)", () => {
    const ordered = TieBreak.order([row({ id: "a", dense: 1 }), row({ id: "b", dense: 2 })])
    expect(ordered.map((r) => r.id)).toEqual(["b", "a"])
  })
})

describe("HybridFusion — deterministic dense+sparse fusion before tie-break", () => {
  test("weighted fusion is a normalized weighted sum", () => {
    const fused = HybridFusion.fuseWeighted({ id: "a", dense: 1, sparse: 0, dense_rank: 0, sparse_rank: null })
    expect(fused).toBeCloseTo(HybridFusion.DEFAULT_WEIGHTS.dense)
  })

  test("RRF fusion sums reciprocal rank terms; absent rank contributes zero", () => {
    const both = HybridFusion.fuseRrf({ id: "a", dense: 0, sparse: 0, dense_rank: 0, sparse_rank: 0 })
    const one = HybridFusion.fuseRrf({ id: "b", dense: 0, sparse: 0, dense_rank: 0, sparse_rank: null })
    expect(both).toBeGreaterThan(one)
    expect(one).toBeCloseTo(1 / (HybridFusion.RRF_K + 1))
  })

  test("fuseRank orders by fused score desc then id, deterministically", () => {
    const inputs = [
      { id: "b", dense: 0.2, sparse: 0.2, dense_rank: 2, sparse_rank: 2 },
      { id: "a", dense: 0.9, sparse: 0.9, dense_rank: 0, sparse_rank: 0 },
    ]
    expect(HybridFusion.fuseRank("weighted", inputs).map((f) => f.id)).toEqual(["a", "b"])
    expect(HybridFusion.fuseRank("rrf", inputs).map((f) => f.id)).toEqual(["a", "b"])
  })
})
