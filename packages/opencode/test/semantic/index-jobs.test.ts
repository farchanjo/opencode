/**
 * Feature 006 / T030 (S19) — index jobs acceptance.
 *
 * Upsert/tombstone reflect core state, a scheduled reconcile keeps the pinned
 * binding and coalesces triggers, and large outputs are spooled as refs with no
 * LLM turn (FR13, FR40, C22, AC10, AC13).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { IndexJobs } from "@/semantic/index-jobs"
import { MilvusAdapter } from "@/semantic/milvus-adapter"

const filters = { projectId: "p1", scope: "project", visibility: "public" }
const liveDoc = (id: string, hash: string): IndexJobs.LiveDoc => ({
  canonicalId: id,
  contentHash: hash,
  row: { canonicalId: id, canonicalVersion: "1", dense: [1, 0], terms: [id], filters },
})

const spool: IndexJobs.OutputSpoolSink = {
  spool: ({ collection, summary }) => Effect.succeed(`output://semantic/${collection}/${summary.upsertedCount}-${summary.tombstonedCount}`),
}

describe("planMutations (content hash)", () => {
  test("upserts new/changed and tombstones removed, leaves unchanged", () => {
    const plan = IndexJobs.planMutations(
      [liveDoc("a", "h2"), liveDoc("c", "h3")],
      [{ canonicalId: "a", contentHash: "h1" }, { canonicalId: "b", contentHash: "hb" }, { canonicalId: "c", contentHash: "h3" }],
    )
    expect(plan.upserts.map((r) => r.canonicalId)).toEqual(["a"]) // a changed h1->h2
    expect(plan.tombstones).toEqual(["b"]) // b removed from live
    expect(plan.unchanged).toEqual(["c"]) // c same hash
  })
})

describe("coalesceTriggers", () => {
  test("collapses overlapping triggers to one run per collection", () => {
    expect(IndexJobs.coalesceTriggers(["agents", "skills", "agents", "agents"])).toEqual(["agents", "skills"])
  })
})

describe("runReconcile", () => {
  test("applies to Milvus, spools a ref, keeps the pinned binding version", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    const result = await Effect.runPromise(IndexJobs.runReconcile({ milvus, spool }, {
      collection: "agents",
      live: [liveDoc("a", "h1"), liveDoc("b", "h2")],
      indexed: [{ canonicalId: "old", contentHash: "hx" }],
      projectId: "p1",
      bindingVersion: 7,
    }))
    expect(result.summary.upsertedCount).toBe(2)
    expect(result.summary.tombstonedCount).toBe(1)
    expect(result.summary.bindingVersion).toBe(7) // pinned binding unchanged
    expect(result.outputRef.startsWith("output://")).toBe(true)
    // The upserts are now recallable in the fake index.
    const search = await Effect.runPromise(milvus.search({
      collection: "agents", dense: [1, 0], sparseTerms: ["a"], filters, topK: 10, consistency: "bounded", metric: "cosine",
    }))
    expect(search.hits.some((h) => h.canonicalId === "a")).toBe(true)
  })
})
