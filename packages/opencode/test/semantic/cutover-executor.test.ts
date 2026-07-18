/**
 * Feature 006 / T031 (S20) — cutover executor acceptance.
 *
 * A CAS-success cutover of all collections together, a CAS contention reject,
 * rollback, and a reranker cutover with no re-embed (FR12, FR32, C12, AC31,
 * AC32).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CutoverExecutor } from "@/semantic/cutover-executor"
import { MilvusAdapter } from "@/semantic/milvus-adapter"

const ALL: readonly ("agents" | "skills" | "skill_chunks")[] = ["agents", "skills", "skill_chunks"]

describe("activatesAlias / requiresReindex", () => {
  test("only cutover activates the alias", () => {
    expect(CutoverExecutor.activatesAlias("select")).toBe(false)
    expect(CutoverExecutor.activatesAlias("reindex")).toBe(false)
    expect(CutoverExecutor.activatesAlias("cutover")).toBe(true)
  })
  test("a dimension change forces a fresh generation", () => {
    expect(CutoverExecutor.requiresReindex({ dimension: 256, metric: "cosine" }, { dimension: 512, metric: "cosine" })).toBe(true)
    expect(CutoverExecutor.requiresReindex({ dimension: 256, metric: "cosine" }, { dimension: 256, metric: "cosine" })).toBe(false)
  })
})

describe("cutoverEmbedding", () => {
  const base = { collections: ALL, fromGeneration: "g1", toGeneration: "g2", bindingVersion: 3 }

  test("commits all collections together under a matching CAS", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter({ casToken: "cas-1" })
    const outcome = await Effect.runPromise(CutoverExecutor.cutoverEmbedding({ milvus }, {
      ...base, casExpected: "cas-1", casActual: "cas-1", confirmed: true,
    }))
    expect(outcome.kind).toBe("committed")
    if (outcome.kind === "committed") {
      expect(outcome.swapped).toEqual(ALL)
      expect(outcome.invalidatedBindingVersion).toBe(3)
    }
  })

  test("requires confirmation", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    const outcome = await Effect.runPromise(CutoverExecutor.cutoverEmbedding({ milvus }, {
      ...base, casExpected: "cas-1", casActual: "cas-1", confirmed: false,
    }))
    expect(outcome.kind).toBe("confirmation_required")
  })

  test("rejects a CAS contention and swaps none", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    const outcome = await Effect.runPromise(CutoverExecutor.cutoverEmbedding({ milvus }, {
      ...base, casExpected: "cas-1", casActual: "cas-2", confirmed: true,
    }))
    expect(outcome.kind).toBe("cas_conflict")
  })
})

describe("rollbackEmbedding", () => {
  test("reverses under policy with confirmation", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter({ casToken: "cas-9" })
    const outcome = await Effect.runPromise(CutoverExecutor.rollbackEmbedding({ milvus }, {
      collections: ALL, targetGeneration: "g1", casExpected: "cas-9", casActual: "cas-9", confirmed: true, bindingVersion: 2,
    }))
    expect(outcome.kind).toBe("committed")
  })
})

describe("cutoverReranker", () => {
  test("activates with no re-embedding", () => {
    const outcome = CutoverExecutor.cutoverReranker({ confirmed: true, bindingVersion: 5 })
    expect(outcome.kind).toBe("committed")
    if (outcome.kind === "committed") expect(outcome.reEmbedded).toBe(false)
  })
  test("requires confirmation", () => {
    expect(CutoverExecutor.cutoverReranker({ confirmed: false, bindingVersion: 5 }).kind).toBe("confirmation_required")
  })
})
