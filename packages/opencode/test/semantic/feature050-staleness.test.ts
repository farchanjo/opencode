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
 *       `Projection.decideMutation` call `live-doc-source.ts` guards its
 *       embed call with) never fires for an unchanged hash.
 *
 * Also covers the disk-seeded LiveDocSource e2e (T019/T020 landed): write a
 * skill file under a tmpdir, collect→reconcile, then delete/edit/no-change the
 * file and re-run — no live solaris required.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Projection } from "@opencode-ai/core/semantic/projection"
import { IndexJobs } from "@/semantic/index-jobs"
import { LiveDocSource } from "@/semantic/live-doc-source"
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

// ---------------------------------------------------------------------------
// Disk-seeded LiveDocSource e2e (T028-T030 extension — no live solaris)
// ---------------------------------------------------------------------------

/** Minimal SKILL.md frontmatter + body written to disk for LiveDocSource.skills(). */
function writeSkillFile(root: string, name: string, description: string, body: string): string {
  const dir = path.join(root, ".opencode", "skill", name)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "SKILL.md")
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, "utf8")
  return file
}

/** Read on-disk skills under root into LiveDocSource SkillSourceInput rows (content-hash seed). */
async function loadSkillsFromDisk(root: string): Promise<readonly LiveDocSource.SkillSourceInput[]> {
  const skillRoot = path.join(root, ".opencode", "skill")
  const names = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: skillRoot, onlyFiles: false }))
  const out: LiveDocSource.SkillSourceInput[] = []
  for (const name of names) {
    const file = path.join(skillRoot, name, "SKILL.md")
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text()
    const fm = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (!fm) continue
    const description = fm[1]!.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? name
    out.push({ name, description, slash: false, content: fm[2]!.trim() })
  }
  return out
}

function createDiskSeedSource(root: string, embedCalls: string[][]) {
  const { writer, reader } = createFakeSpool()
  const spool = OutputSpoolStore.createOutputSpoolStore({ writer, reader })
  return LiveDocSource.createLiveDocSource({
    agents: async () => [],
    skills: async () => loadSkillsFromDisk(root),
    embed: async (texts) => {
      embedCalls.push([...texts])
      return texts.map((_, i) => [i + 1, 0])
    },
    spool,
    chunking: { maxChunks: 4, chunkSizeTokens: 40, overlapTokens: 5 },
    filters: (projectId) => ({ projectId, scope: "project", visibility: "public" }),
  })
}

describe("Staleness e2e — disk-seeded LiveDocSource (T028-T030)", () => {
  test("delete: seed skill on disk → index → delete file → reconcile tombstones (AC3)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "f050-stale-del-"))
    try {
      writeSkillFile(root, "deploy-helper", "helps deploy things", "# Deploy\n\nDeploy reliably.")
      const embedCalls: string[][] = []
      const source = createDiskSeedSource(root, embedCalls)
      const milvus = MilvusAdapter.createFakeMilvusAdapter()

      const live1 = await source.collect({ collection: "skills", projectId: "p1", full: true })
      expect(live1.length).toBe(1)
      expect(live1[0]!.canonicalId).toBe("deploy-helper")
      expect(embedCalls.length).toBe(1)

      const index1 = await Effect.runPromise(
        IndexJobs.runReconcile(
          { milvus, spool: noopSpool },
          {
            collection: "skills",
            live: live1,
            indexed: [],
            projectId: "p1",
            bindingVersion: 1,
          },
        ),
      )
      expect(index1.summary.upsertedCount).toBe(1)

      // Delete the skill file on disk (live source becomes empty).
      rmSync(path.join(root, ".opencode", "skill", "deploy-helper"), { recursive: true, force: true })
      const live2 = await source.collect({ collection: "skills", projectId: "p1" })
      expect(live2).toEqual([])

      const del = await Effect.runPromise(
        IndexJobs.runReconcile(
          { milvus, spool: noopSpool },
          {
            collection: "skills",
            live: live2,
            indexed: [{ canonicalId: live1[0]!.canonicalId, contentHash: live1[0]!.contentHash }],
            projectId: "p1",
            bindingVersion: 1,
          },
        ),
      )
      expect(del.summary.tombstonedCount).toBe(1)
      expect(del.summary.upsertedCount).toBe(0)

      const search = await Effect.runPromise(
        milvus.search({
          collection: "skills",
          dense: [1, 0],
          sparseTerms: [],
          filters,
          topK: 10,
          consistency: "bounded",
          metric: "cosine",
        }),
      )
      expect(search.hits.some((h) => h.canonicalId === "deploy-helper")).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("edit: seed skill → index → edit body on disk → reconcile supersedes (AC4)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "f050-stale-edit-"))
    try {
      writeSkillFile(root, "edit-skill", "original description", "# V1 body")
      const embedCalls: string[][] = []
      const source = createDiskSeedSource(root, embedCalls)
      const milvus = MilvusAdapter.createFakeMilvusAdapter()

      const live1 = await source.collect({ collection: "skills", projectId: "p1", full: true })
      await Effect.runPromise(
        IndexJobs.runReconcile(
          { milvus, spool: noopSpool },
          { collection: "skills", live: live1, indexed: [], projectId: "p1", bindingVersion: 1 },
        ),
      )
      const priorHash = live1[0]!.contentHash
      embedCalls.length = 0

      // Edit description (embed text) so content hash changes.
      writeSkillFile(root, "edit-skill", "edited description", "# V2 body with more detail")
      // Wire indexedHashes so embed-skip uses prior generation.
      const sourceWithPrior = LiveDocSource.createLiveDocSource({
        agents: async () => [],
        skills: async () => loadSkillsFromDisk(root),
        embed: async (texts) => {
          embedCalls.push([...texts])
          return texts.map(() => [0, 1])
        },
        spool: OutputSpoolStore.createOutputSpoolStore(createFakeSpool()),
        indexedHashes: async () => new Map([["edit-skill", priorHash]]),
        chunking: { maxChunks: 4, chunkSizeTokens: 40, overlapTokens: 5 },
        filters: (projectId) => ({ projectId, scope: "project", visibility: "public" }),
      })
      const liveEdited = await sourceWithPrior.collect({ collection: "skills", projectId: "p1" })
      expect(liveEdited.length).toBe(1)
      expect(liveEdited[0]!.contentHash).not.toBe(priorHash)
      expect(embedCalls.length).toBe(1) // changed hash embeds once

      const result = await Effect.runPromise(
        IndexJobs.runReconcile(
          { milvus, spool: noopSpool },
          {
            collection: "skills",
            live: liveEdited,
            indexed: [{ canonicalId: "edit-skill", contentHash: priorHash }],
            projectId: "p1",
            bindingVersion: 1,
          },
        ),
      )
      expect(result.summary.upsertedCount).toBe(1)
      expect(result.summary.tombstonedCount).toBe(0)

      const search = await Effect.runPromise(
        milvus.search({
          collection: "skills",
          dense: [0, 1],
          sparseTerms: [],
          filters,
          topK: 10,
          consistency: "bounded",
          metric: "cosine",
        }),
      )
      const matches = search.hits.filter((h) => h.canonicalId === "edit-skill")
      expect(matches.length).toBe(1)
      expect(matches[0]!.canonicalVersion).toBe(liveEdited[0]!.contentHash)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("no-change: re-collect same disk skill → zero embeds and zero mutations (AC5)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "f050-stale-noop-"))
    try {
      writeSkillFile(root, "stable-skill", "stable description", "# Stable body")
      const embedCalls: string[][] = []
      const milvus = MilvusAdapter.createFakeMilvusAdapter()

      const sourceFull = createDiskSeedSource(root, embedCalls)
      const live1 = await sourceFull.collect({ collection: "skills", projectId: "p1", full: true })
      await Effect.runPromise(
        IndexJobs.runReconcile(
          { milvus, spool: noopSpool },
          { collection: "skills", live: live1, indexed: [], projectId: "p1", bindingVersion: 1 },
        ),
      )
      const priorHash = live1[0]!.contentHash
      embedCalls.length = 0

      const sourceIncremental = LiveDocSource.createLiveDocSource({
        agents: async () => [],
        skills: async () => loadSkillsFromDisk(root),
        embed: async (texts) => {
          embedCalls.push([...texts])
          return texts.map(() => [1, 0])
        },
        spool: OutputSpoolStore.createOutputSpoolStore(createFakeSpool()),
        indexedHashes: async () => new Map([["stable-skill", priorHash]]),
        chunking: { maxChunks: 4, chunkSizeTokens: 40, overlapTokens: 5 },
        filters: (projectId) => ({ projectId, scope: "project", visibility: "public" }),
      })
      const live2 = await sourceIncremental.collect({ collection: "skills", projectId: "p1" })
      expect(embedCalls.length).toBe(0) // unchanged hash → ZERO embed calls
      expect(live2[0]!.row.dense).toEqual([])

      const result = await Effect.runPromise(
        IndexJobs.runReconcile(
          { milvus, spool: noopSpool },
          {
            collection: "skills",
            live: live2,
            indexed: [{ canonicalId: "stable-skill", contentHash: priorHash }],
            projectId: "p1",
            bindingVersion: 1,
          },
        ),
      )
      expect(result.summary.upsertedCount).toBe(0)
      expect(result.summary.tombstonedCount).toBe(0)
      expect(result.summary.unchangedCount).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
