/**
 * Feature 009 / T013 (S12) — the tool-retrieval golden eval acceptance (FR25,
 * FR16, C16, AC2, AC20).
 *
 * The tool golden set records per-locale recall/nDCG/MRR over multilingual
 * (pt-BR / es / en) queries against the en-US Lang Lock tool descriptions, reuses
 * the same fixed ZERO-leakage gate as the Feature 006 harness, and mutates no
 * binding. The fixtures are content-free — bounded tool ids, never a description,
 * a schema, a secret, or a path.
 */
import { describe, expect, test } from "bun:test"
import { EvalHarness } from "@/semantic/eval-harness"

describe("T013 tool golden set — per-locale metrics, zero-leakage gate (AC2, AC20)", () => {
  test("records recall/nDCG/MRR per multilingual locale and passes with zero leakage", () => {
    const report = EvalHarness.runToolGolden()
    expect(report.localeBreakdown.map((l) => l.languageTag).sort()).toEqual(["en", "es", "pt-BR"])
    for (const locale of report.localeBreakdown) {
      expect(locale.recallAtK).toBeGreaterThan(0)
      expect(locale.ndcg).toBeGreaterThan(0)
      expect(locale.mrr).toBeGreaterThan(0)
    }
    expect(report.leakageCount).toBe(0)
    expect(report.passed).toBe(true)
  })

  test("reuses the same GoldenCase EvalPort shape as the agent/skill set (no second harness)", () => {
    for (const golden of EvalHarness.TOOL_GOLDEN_CASES) {
      expect(Object.keys(golden).sort()).toEqual(["leaked", "locale", "queryId", "relevant", "retrieved"])
      // Content-free: only bounded tool ids, never a description/schema/path.
      for (const id of [...golden.relevant, ...golden.retrieved]) expect(id).not.toContain("/etc/")
    }
  })

  test("fails on any permission leakage (fixed zero tolerance)", () => {
    const leaky = [
      ...EvalHarness.TOOL_GOLDEN_CASES,
      { queryId: "tq-leak", locale: "en", relevant: ["tool.read"], retrieved: ["tool.read"], leaked: ["mcp:other-project/secret"] },
    ]
    const report = EvalHarness.runToolGolden(leaky)
    expect(report.leakageCount).toBe(1)
    expect(report.passed).toBe(false)
  })

  test("a multilingual pt-BR query matches the en-US tool with a perfect reciprocal rank", () => {
    const ptCase = EvalHarness.TOOL_GOLDEN_CASES.find((c) => c.queryId === "tq-mcp-pt")!
    expect(EvalHarness.reciprocalRank(ptCase.relevant, ptCase.retrieved)).toBe(1)
  })
})
