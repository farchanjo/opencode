/**
 * Feature 050 / T028-T030 (AC3, AC4, AC5) — staleness: delete, edit, no-change.
 *
 * Exercises `IndexJobs.planMutations`/`runReconcile` — the shipped
 * content-hash incremental-mutation engine (`index-jobs.ts:52-65`,
 * `Projection.decideMutation`) — against
 * `MilvusAdapter.createFakeMilvusAdapter()` for the three staleness scenarios
 * FR9/AC3-5 describe:
 *
 *   (a) delete — a doc present in `indexed` but absent from `live` is
 *       tombstoned and drift is 0 (AC3); for `skill_chunks`, the tombstoned
 *       chunk's `OutputSpoolStore` entry is superseded alongside the doc,
 *       composed over the Wave-1 `output-spool-store.ts` façade.
 *   (b) edit — a changed content hash supersedes via `upsert`, never a
 *       tombstone+reinsert and never a duplicate row for the same canonical
 *       id (AC4).
 *   (c) no-change — identical hashes yield zero upserts/tombstones via
 *       `runReconcile` (AC5), and the embed-skip DECISION itself (the same
 *       `Projection.decideMutation` call `live-doc-source.ts` — T019, still
 *       in flight on a concurrent slice of this feature — will guard its
 *       embed call with) never fires for an unchanged hash. The full
 *       `AgentV2.Service`/`SkillV2.Service` live-read wiring behind that
 *       decision is T019/T020's own test file — deferred here, not
 *       reimplemented.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Projection } from "@opencode-ai/core/semantic/projection"
import { IndexJobs } from "@/semantic/index-jobs"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import { OutputSpoolStore } from "@/semantic/output-spool-store"
import type { ChannelKey, IngestOutcome } from "@/session/output-spool-writer"
import type { OutputSpoolBackend } from "@/operator/outputspool/outputspool-port"

const filters = { projectId: "p1", scope: "project", visibility: "public" }

const liveDoc = (id: string, hash: string, dense: readonly number[] = [1, 0]): IndexJobs.LiveDoc => ({
  canonicalId: id,
  contentHash: hash,
  row: { canonicalId: id, canonicalVersion: hash, dense: [...dense], terms: [id], filters },
})

const noopSpool: IndexJobs.OutputSpoolSink = {
  spool: ({ collection, summary }) =>
    Effect.succeed(`output://semantic/${collection}/${summary.upsertedCount}-${summary.tombstonedCount}`),
}

interface FakeRecord {
  bytes: Buffer
  sealed: boolean
}

/** An in-memory writer + reader pair standing in for the real Feature 005 subsystem (mirrors output-spool-store.test.ts's fixture). */
const createFakeSpool = () => {
  const store = new Map<string, FakeRecord>()

  const writer = {
    ingest: async (key: ChannelKey, text: string): Promise<IngestOutcome> => {
      const bytes = Buffer.from(text, "utf8")
      store.set(key.outputRef, { bytes, sealed: false })
      return { kind: "appended", committedBytes: bytes.length }
    },
    seal: async (outputRef: string): Promise<void> => {
      const record = store.get(outputRef)
      if (record) record.sealed = true
    },
  }

  const reader: Pick<OutputSpoolBackend, "stat" | "read"> = {
    stat: (input) => {
      const record = store.get(input.outputRef)
      if (!record) return Effect.fail({ type: "not_found", outputRef: input.outputRef })
      return Effect.succeed({
        stat: {
          outputRef: input.outputRef,
          channel: "artifact",
          state: record.sealed ? "sealed" : "open",
          committedBytes: record.bytes.length,
          fsyncTier: "durable",
          updatedAt: new Date(0).toISOString(),
        },
      })
    },
    read: (input) => {
      const record = store.get(input.outputRef)
      if (!record) return Effect.fail({ type: "not_found", outputRef: input.outputRef })
      const bytes = record.bytes.subarray(input.offset, input.offset + input.limit)
      return Effect.succeed({ page: { bytes, nextOffset: input.offset + bytes.length, committedBytes: record.bytes.length, caughtUp: true, eof: true } })
    },
  }

  return { writer, reader, store }
}

describe("Staleness — delete (AC3)", () => {
  test("a doc present in indexed but absent from live is tombstoned; drift is 0", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    await Effect.runPromise(milvus.upsert({ collection: "skills", rows: [liveDoc("skill-x", "h1").row] }))

    const result = await Effect.runPromise(
      IndexJobs.runReconcile(
        { milvus, spool: noopSpool },
        { collection: "skills", live: [], indexed: [{ canonicalId: "skill-x", contentHash: "h1" }], projectId: "p1", bindingVersion: 1 },
      ),
    )
    expect(result.summary.tombstonedCount).toBe(1)
    expect(result.summary.upsertedCount).toBe(0)

    const search = await Effect.runPromise(
      milvus.search({ collection: "skills", dense: [1, 0], sparseTerms: [], filters, topK: 10, consistency: "bounded", metric: "cosine" }),
    )
    expect(search.hits.some((h) => h.canonicalId === "skill-x")).toBe(false) // drift 0 — gone from live search
  })

  test("skill_chunks: the tombstoned chunk's spool entry is superseded (never left resolvable) alongside the doc", async () => {
    const { writer, reader, store: backing } = createFakeSpool()
    const spoolStore = OutputSpoolStore.createOutputSpoolStore({ writer, reader })

    const put = await Effect.runPromise(
      spoolStore.put({ parentSkillId: "skill-x", chunkIndex: 0, contentHash: "chunk-h1", sanitizedBody: "chunk body" }),
    )

    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    await Effect.runPromise(milvus.upsert({ collection: "skill_chunks", rows: [liveDoc("skill-x_c0", "chunk-h1").row] }))

    const result = await Effect.runPromise(
      IndexJobs.runReconcile(
        { milvus, spool: noopSpool },
        {
          collection: "skill_chunks",
          live: [],
          indexed: [{ canonicalId: "skill-x_c0", contentHash: "chunk-h1" }],
          projectId: "p1",
          bindingVersion: 1,
        },
      ),
    )
    expect(result.summary.tombstonedCount).toBe(1)

    // Composed alongside `runReconcile`'s tombstone plan: the caller (T023's composition
    // root, out of this slice) carries a canonicalId -> outputRef map for skill_chunks and
    // supersedes each tombstoned chunk's spool entry. Modeled directly here since planMutations
    // itself only ever returns bounded canonical-id strings, never a body/ref (C22).
    const refByCanonicalId = new Map([["skill-x_c0", put.outputRef]])
    const ref = refByCanonicalId.get("skill-x_c0")
    expect(ref).toBeDefined()
    await Effect.runPromise(spoolStore.supersede(ref!))
    expect(backing.get(put.outputRef)?.sealed).toBe(true)
  })
})

describe("Staleness — edit (AC4)", () => {
  test("a changed content hash supersedes via upsert; never a duplicate row for the same id", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    await Effect.runPromise(milvus.upsert({ collection: "skills", rows: [liveDoc("skill-y", "h1", [1, 0]).row] }))

    const result = await Effect.runPromise(
      IndexJobs.runReconcile(
        { milvus, spool: noopSpool },
        {
          collection: "skills",
          live: [liveDoc("skill-y", "h2", [0, 1])],
          indexed: [{ canonicalId: "skill-y", contentHash: "h1" }],
          projectId: "p1",
          bindingVersion: 1,
        },
      ),
    )
    expect(result.summary.upsertedCount).toBe(1)
    expect(result.summary.tombstonedCount).toBe(0)

    const search = await Effect.runPromise(
      milvus.search({ collection: "skills", dense: [0, 1], sparseTerms: [], filters, topK: 10, consistency: "bounded", metric: "cosine" }),
    )
    const matches = search.hits.filter((h) => h.canonicalId === "skill-y")
    expect(matches.length).toBe(1) // superseded in place, never duplicated
    expect(matches[0]!.canonicalVersion).toBe("h2")
  })

  test("planMutations alone: an edited hash always decides upsert, never tombstone+reinsert", () => {
    const plan = IndexJobs.planMutations([liveDoc("skill-y", "h2")], [{ canonicalId: "skill-y", contentHash: "h1" }])
    expect(plan.upserts.map((r) => r.canonicalId)).toEqual(["skill-y"])
    expect(plan.tombstones).toEqual([])
    expect(plan.unchanged).toEqual([])
  })
})

describe("Staleness — no-change (AC5)", () => {
  test("identical hashes: runReconcile issues zero upserts and zero tombstones", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    await Effect.runPromise(milvus.upsert({ collection: "agents", rows: [liveDoc("agent-z", "hz").row] }))

    const result = await Effect.runPromise(
      IndexJobs.runReconcile(
        { milvus, spool: noopSpool },
        {
          collection: "agents",
          live: [liveDoc("agent-z", "hz")],
          indexed: [{ canonicalId: "agent-z", contentHash: "hz" }],
          projectId: "p1",
          bindingVersion: 1,
        },
      ),
    )
    expect(result.summary.upsertedCount).toBe(0)
    expect(result.summary.tombstonedCount).toBe(0)
    expect(result.summary.unchangedCount).toBe(1)
  })

  test(
    "embed-skip decision: an unchanged hash never decides 'upsert' (the SAME " +
      "Projection.decideMutation live-doc-source.ts (T019) guards its embed call with) " +
      "— a changed or new hash always does",
    () => {
      const indexedHashes = new Map([
        ["agent-z", "hz"],
        ["skill-y", "hs1"],
      ])
      const embedSpy = { calls: 0 }
      const embedIfChanged = (id: string, hash: string): Projection.MutationKind => {
        const decision = Projection.decideMutation(indexedHashes.get(id) ?? null, hash)
        if (decision !== "unchanged") embedSpy.calls++
        return decision
      }

      expect(embedIfChanged("agent-z", "hz")).toBe("unchanged") // identical hash -> zero embed calls
      expect(embedSpy.calls).toBe(0)

      expect(embedIfChanged("skill-y", "hs2")).toBe("upsert") // changed hash -> embeds
      expect(embedSpy.calls).toBe(1)

      expect(embedIfChanged("new-agent", "hn")).toBe("upsert") // brand-new doc -> embeds
      expect(embedSpy.calls).toBe(2)
    },
  )
})
