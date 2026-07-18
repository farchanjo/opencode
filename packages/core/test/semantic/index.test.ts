import { describe, expect, test } from "bun:test"
import * as Semantic from "@opencode-ai/core/semantic/index"

// Feature 006 / T024 (S6–S14) — the domain engine barrel imports without a
// duplicate-export error and re-exports every module namespace.

describe("Semantic barrel", () => {
  test("re-exports all ten domain module namespaces", () => {
    for (const name of [
      "BindingLifecycle",
      "Degradation",
      "FreshnessGate",
      "HybridFusion",
      "IndexGeneration",
      "Pipeline",
      "Projection",
      "QueryCache",
      "SemanticInstruments",
      "TieBreak",
    ]) {
      expect(Semantic).toHaveProperty(name)
    }
  })

  test("the re-exported namespaces carry their domain surface", () => {
    expect(Semantic.Pipeline.STAGES).toHaveLength(9)
    expect(Semantic.TieBreak.order).toBeInstanceOf(Function)
    expect(Semantic.Degradation.classify).toBeInstanceOf(Function)
    expect(Semantic.BindingLifecycle.BINDING_STATES).toHaveLength(5)
    expect(Semantic.IndexGeneration.GENERATION_STATES).toHaveLength(5)
  })
})
