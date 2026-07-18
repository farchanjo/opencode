import { describe, expect, test } from "bun:test"
import { IndexGeneration } from "@opencode-ai/core/semantic/index-generation"

// Feature 006 / T018 (S9) — the blue/green index-generation lifecycle: select/
// reindex leave the alias inactive, cutover moves all aliases atomically, a
// dimension change forces a new generation, and vectors are never mixed (FR12,
// C12, C21, AC9, AC31, AC41).

type State = IndexGeneration.GenerationState

const expectTo = (state: State, trigger: IndexGeneration.Trigger, to: State) => {
  const r = IndexGeneration.apply(state, trigger)
  expect(r.kind).toBe("transition")
  if (r.kind === "transition") expect(r.to).toBe(to)
}

describe("IndexGeneration — lifecycle", () => {
  test("exposes exactly the five generation states with retired terminal", () => {
    expect(IndexGeneration.GENERATION_STATES).toEqual(["building", "validated", "live", "superseded", "retired"])
    expect(IndexGeneration.isTerminal("retired")).toBe(true)
    expect(IndexGeneration.isTerminal("live")).toBe(false)
  })
  test("reindex builds; validate then cutover goes live; supersede then retire", () => {
    expect(IndexGeneration.create("reindex").ok).toBe(true)
    expectTo("building", "validate", "validated")
    expectTo("validated", "cutover", "live")
    expectTo("live", "supersede", "superseded")
    expectTo("superseded", "retire", "retired")
    expectTo("live", "rollback", "validated")
    expectTo("building", "abort", "retired")
  })
})

describe("IndexGeneration — only cutover activates the live alias (AC41)", () => {
  test("select/reindex/validate do not activate the alias", () => {
    expect(IndexGeneration.activatesAlias("cutover")).toBe(true)
    expect(IndexGeneration.activatesAlias("reindex")).toBe(false)
    expect(IndexGeneration.activatesAlias("validate")).toBe(false)
    expect(IndexGeneration.activatesAlias("rollback")).toBe(false)
  })
})

describe("IndexGeneration — vectors are never mixed (AC9)", () => {
  test("a dimension or metric change forces a new generation", () => {
    const base = { dimension: 1024, metric: "cosine" } as const
    expect(IndexGeneration.vectorsCompatible(base, { dimension: 1024, metric: "cosine" })).toBe(true)
    expect(IndexGeneration.requiresNewGeneration(base, { dimension: 768, metric: "cosine" })).toBe(true)
    expect(IndexGeneration.requiresNewGeneration(base, { dimension: 1024, metric: "inner-product" })).toBe(true)
    expect(IndexGeneration.requiresNewGeneration(base, { dimension: 1024, metric: "cosine" })).toBe(false)
  })
})

describe("IndexGeneration — atomic all-collections cutover (AC31, AC32)", () => {
  const swaps = [
    { collection: "agents", from_generation: "g1", to_generation: "g2" },
    { collection: "skills", from_generation: "g1", to_generation: "g2" },
    { collection: "skill_chunks", from_generation: "g1", to_generation: "g2" },
    { collection: "tools", from_generation: "g1", to_generation: "g2" },
  ] as const

  test("a CAS match commits every collection together", () => {
    const r = IndexGeneration.cutoverAll(swaps, "cas-1", "cas-1")
    expect(r.kind).toBe("committed")
    if (r.kind === "committed") expect(r.swaps).toHaveLength(4)
  })
  test("a CAS mismatch swaps none (contention)", () => {
    const r = IndexGeneration.cutoverAll(swaps, "cas-1", "cas-2")
    expect(r.kind).toBe("contended")
  })
})
