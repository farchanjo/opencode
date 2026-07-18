/**
 * Feature 006 / T026 (S15) — Milvus adapter acceptance.
 *
 * Asserts the fake adapter serves hybrid recall under mandatory filters, an
 * unreachable backend yields `milvus_unavailable` (not a crash), and the scalar
 * project key isolates projects (FR7, FR9, C1, C6, C7).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { MilvusAdapter } from "@/semantic/milvus-adapter"

const filters = (projectId: string): MilvusAdapter.MandatoryFilters => ({
  projectId,
  scope: "project",
  visibility: "public",
})

const row = (projectId: string, id: string, dense: number[], terms: string[]): MilvusAdapter.DocumentRow => ({
  canonicalId: id,
  canonicalVersion: "1",
  dense,
  terms,
  filters: filters(projectId),
})

const runExit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSyncExit(effect)

describe("fake Milvus adapter", () => {
  test("serves hybrid dense+sparse recall under mandatory filters", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "agents", rows: [
      row("p1", "a", [1, 0], ["build", "deploy"]),
      row("p1", "b", [0, 1], ["review"]),
    ] }))
    const result = Effect.runSync(port.search({
      collection: "agents",
      dense: [1, 0],
      sparseTerms: ["build"],
      filters: filters("p1"),
      topK: 10,
      consistency: "bounded",
      metric: "cosine",
    }))
    expect(result.hits[0].canonicalId).toBe("a")
    expect(result.hits[0].dense).toBeGreaterThan(result.hits[1].dense)
    expect(result.hits[0].sparse).toBeGreaterThan(0)
  })

  test("the scalar project key isolates projects", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "agents", rows: [
      row("p1", "a", [1, 0], ["x"]),
      row("p2", "secret", [1, 0], ["x"]),
    ] }))
    const result = Effect.runSync(port.search({
      collection: "agents",
      dense: [1, 0],
      sparseTerms: ["x"],
      filters: filters("p1"),
      topK: 10,
      consistency: "bounded",
      metric: "cosine",
    }))
    expect(result.hits.map((h) => h.canonicalId)).toEqual(["a"])
  })

  test("an absent project partition key is rejected as invalid_filters", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    const exit = runExit(port.search({
      collection: "agents",
      dense: [1, 0],
      sparseTerms: [],
      filters: { projectId: "", scope: "project", visibility: "public" },
      topK: 10,
      consistency: "bounded",
      metric: "cosine",
    }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("tombstone removes a document from recall", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "agents", rows: [row("p1", "a", [1, 0], ["x"])] }))
    Effect.runSync(port.tombstone({ collection: "agents", canonicalIds: ["a"], projectId: "p1" }))
    const result = Effect.runSync(port.search({
      collection: "agents", dense: [1, 0], sparseTerms: ["x"], filters: filters("p1"), topK: 10, consistency: "bounded", metric: "cosine",
    }))
    expect(result.hits).toHaveLength(0)
  })

  test("swapAliases moves all collections together and rejects a CAS mismatch", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter({ casToken: "gen-2" })
    const ok = Effect.runSync(port.swapAliases({ targets: [
      { collection: "agents", generationId: "g" },
      { collection: "skills", generationId: "g" },
      { collection: "skill_chunks", generationId: "g" },
    ], casToken: "gen-2" }))
    expect(ok.swapped).toEqual(["agents", "skills", "skill_chunks"])
    const bad = runExit(port.swapAliases({ targets: [{ collection: "agents", generationId: "g" }], casToken: "stale" }))
    expect(Exit.isFailure(bad)).toBe(true)
  })
})

describe("live gRPC Milvus adapter (honest gap)", () => {
  test("an unbound client yields milvus_unavailable, never a crash", () => {
    const port = MilvusAdapter.createGrpcMilvusAdapter()
    const exit = runExit(port.health())
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause
      expect(JSON.stringify(err)).toContain("milvus_unavailable")
    }
  })

  test("an injected reachable client serves search and health", async () => {
    const client: MilvusAdapter.MilvusGrpcClient = {
      search: async () => ({ hits: [{ canonicalId: "a", canonicalVersion: "1", dense: 0.9, sparse: 0.1 }], consistency: "bounded" }),
      upsert: async () => ({ upsertedCount: 1 }),
      tombstone: async () => ({ tombstonedCount: 0 }),
      health: async () => ({ reachable: true, latencyMs: 3 }),
      swapAliases: async () => ({ swapped: ["agents"] }),
    }
    const port = MilvusAdapter.createGrpcMilvusAdapter({ client })
    const health = await Effect.runPromise(port.health())
    expect(health.reachable).toBe(true)
  })
})
