/**
 * Feature 006 / T035 (S23) — offline golden eval harness acceptance.
 *
 * Records per-locale recall/nDCG/MRR, fails on any leakage, injects only budgeted
 * chunk ranges, and mutates no binding (FR14, FR40, FR43, C18).
 */
import { describe, expect, test } from "bun:test"
import { EvalHarness } from "@/semantic/eval-harness"

describe("metrics", () => {
  test("recall@k", () => {
    expect(EvalHarness.recallAtK(["a", "b"], ["a", "x", "b"], 3)).toBe(1)
    expect(EvalHarness.recallAtK(["a", "b"], ["a", "x"], 3)).toBe(0.5)
  })
  test("reciprocal rank", () => {
    expect(EvalHarness.reciprocalRank(["b"], ["a", "b", "c"])).toBe(1 / 2)
    expect(EvalHarness.reciprocalRank(["z"], ["a", "b"])).toBe(0)
  })
  test("nDCG@k is 1 for a perfectly ranked result", () => {
    expect(EvalHarness.ndcgAtK(["a", "b"], ["a", "b", "c"], 3)).toBeCloseTo(1)
    expect(EvalHarness.ndcgAtK(["a"], ["x", "a"], 3)).toBeLessThan(1)
  })
})

describe("runGolden", () => {
  const cases: EvalHarness.GoldenCase[] = [
    { queryId: "q1", locale: "pt-BR", relevant: ["a"], retrieved: ["a", "b"], leaked: [] },
    { queryId: "q2", locale: "es", relevant: ["c"], retrieved: ["c"], leaked: [] },
    { queryId: "q3", locale: "en", relevant: ["e"], retrieved: ["x", "e"], leaked: [] },
  ]

  test("records per-locale recall/nDCG/MRR and passes with zero leakage", () => {
    const report = EvalHarness.runGolden(cases, 5)
    expect(report.localeBreakdown.map((l) => l.languageTag).sort()).toEqual(["en", "es", "pt-BR"])
    expect(report.leakageCount).toBe(0)
    expect(report.passed).toBe(true)
  })

  test("fails on any leakage (zero tolerance)", () => {
    const leaky = [...cases, { queryId: "q4", locale: "en", relevant: ["z"], retrieved: ["z"], leaked: ["other-project-doc"] }]
    const report = EvalHarness.runGolden(leaky, 5)
    expect(report.leakageCount).toBe(1)
    expect(report.passed).toBe(false)
  })
})

describe("budgetChunks", () => {
  test("injects only budgeted read(offset,limit) ranges, never a full body", () => {
    const chunks = [
      { outputRef: "output://s/1", offset: 0, limit: 100 },
      { outputRef: "output://s/2", offset: 100, limit: 100 },
      { outputRef: "output://s/3", offset: 200, limit: 100 },
    ]
    const budgeted = EvalHarness.budgetChunks(chunks, 2)
    expect(budgeted).toHaveLength(2)
    expect(budgeted[0]).toEqual({ outputRef: "output://s/1", offset: 0, limit: 100 })
    // Only refs + ranges, never inline body text.
    expect(Object.keys(budgeted[0])).toEqual(["outputRef", "offset", "limit"])
  })
})
