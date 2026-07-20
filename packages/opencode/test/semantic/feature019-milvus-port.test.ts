/**
 * Feature 019 / T005, T008, T009 (Group B, FR6, FR7) — the two new `MilvusPort`
 * methods (`enumerateIndexed`, `buildGeneration`), the agent/skill live-doc builders,
 * and the composed reindex/reconcile index port.
 *
 * `enumerateIndexed` returns the content-free `{canonicalId, contentHash}` pairs a
 * reconcile diffs against; `buildGeneration` materializes a validated blue/green
 * generation apart from the live alias, and a `swapAliases` promotes it live. The
 * `createMilvusIndexPort` composition diffs the bound live-doc source against the
 * enumerated indexed docs via `runReconcile`, reports content-free counts, and carries
 * the pinned binding version UNCHANGED (a reconcile never re-pins). An unbound source
 * keeps the honest `milvus_unavailable` gap.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import { IndexJobs } from "@/semantic/index-jobs"
import { MilvusBinding } from "@/operator/semantic/milvus-binding"
import type { AgentDoc, SkillDoc } from "@opencode-ai/schema/semantic/documents"
import type { CollectionKind } from "@opencode-ai/protocol/semantic/commands"

const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e)
const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

const filters = { projectId: "proj_1", scope: "global", visibility: "public", permissionRef: "perm_1" }
const docRow = (id: string, hash: string) => ({ canonicalId: id, contentHash: hash, row: { canonicalId: id, canonicalVersion: hash, dense: [0.1, 0.2, 0.3, 0.4], terms: [id], filters } })

describe("T005 — enumerateIndexed + buildGeneration on the fake port (FR6)", () => {
  test("enumerateIndexed returns content-free {canonicalId, contentHash} for a project", async () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    await run(port.upsert({ collection: "agents", rows: [docRow("agent:a", "h1").row, docRow("agent:b", "h2").row] }))
    const out = await run(port.enumerateIndexed({ collection: "agents", projectId: "proj_1" }))
    expect(out.docs.map((d) => d.canonicalId).sort()).toEqual(["agent:a", "agent:b"])
    expect(out.docs.find((d) => d.canonicalId === "agent:a")!.contentHash).toBe("h1")
  })

  test("enumerateIndexed without a project partition is invalid_filters", async () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    const exit = await runExit(port.enumerateIndexed({ collection: "agents", projectId: "" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("buildGeneration validates a fresh generation apart from the live alias; swapAliases promotes it", async () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    const build = await run(port.buildGeneration({ collections: ["agents"], generationId: "gen_1", dimension: 4, metric: "cosine" }))
    expect(build.validated).toBe(true)
    expect(build.state).toBe("validated")
    // Populate the generation, not the live alias.
    await run(port.upsert({ collection: "agents", rows: [docRow("agent:x", "h9").row], generationId: "gen_1" }))
    // The live alias is still empty; the generation carries the row.
    expect((await run(port.enumerateIndexed({ collection: "agents", projectId: "proj_1" }))).docs).toHaveLength(0)
    expect((await run(port.enumerateIndexed({ collection: "agents", projectId: "proj_1", generationId: "gen_1" }))).docs).toHaveLength(1)
    // Cutover promotes the generation into the live alias.
    await run(port.swapAliases({ targets: [{ collection: "agents", generationId: "gen_1" }], casToken: "t" }))
    expect((await run(port.enumerateIndexed({ collection: "agents", projectId: "proj_1" }))).docs).toHaveLength(1)
  })

  test("an unbound gRPC client degrades the new methods to milvus_unavailable", async () => {
    const port = MilvusAdapter.createGrpcMilvusAdapter()
    expect(Exit.isFailure(await runExit(port.enumerateIndexed({ collection: "agents", projectId: "proj_1" })))).toBe(true)
    expect(Exit.isFailure(await runExit(port.buildGeneration({ collections: ["agents"], generationId: "g", dimension: 4, metric: "cosine" })))).toBe(true)
  })
})

describe("T008 — agent/skill live-doc builders join the shipped tool builder (FR6)", () => {
  test("agentLiveDoc projects the DocScope filters + content hash, content-free", () => {
    const doc = {
      id: "agent:one",
      identity: { version: "1", content_hash: "hash_a", source: "core" },
      classification: { role: "manager", mode: "auto", description: "d" },
      taxonomy: { domains: [], capabilities: [], tools: [] },
      scope: { project_id: "proj_1", scope: "global", visibility: "public", permission_ref: "perm_1" },
      languages: [],
      availability: { enabled: true, available: true },
    } as unknown as AgentDoc
    const live = IndexJobs.agentLiveDoc(doc, { dense: [0.1, 0.2, 0.3, 0.4], terms: ["one"] })
    expect(live.canonicalId).toBe("agent:one")
    expect(live.contentHash).toBe("hash_a")
    expect(live.row.filters.projectId).toBe("proj_1")
    expect(live.row.filters.permissionRef).toBe("perm_1")
  })

  test("skillLiveDoc carries caller-supplied partition filters (SkillDoc has no DocScope)", () => {
    const doc = { id: "skill:one", identity: { version: "1", content_hash: "hash_s", source: "core" } } as unknown as SkillDoc
    const live = IndexJobs.skillLiveDoc(doc, { dense: [0, 0, 0, 1], terms: ["s"] }, filters)
    expect(live.canonicalId).toBe("skill:one")
    expect(live.contentHash).toBe("hash_s")
    expect(live.row.filters).toEqual(filters)
  })
})

describe("T008/T009 — composed reindex/reconcile over the live port (FR6, FR7)", () => {
  const endpoint = { address: "milvus.internal:19530", ssl: true, timeoutMs: 500 }
  const source = (docs: readonly IndexJobs.LiveDoc[]): MilvusBinding.LiveDocSource => ({ collect: async () => docs })

  test("reconcile diffs the live-doc source against the enumerated indexed docs, content-free counts, version unchanged", async () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    // Prior indexed state: a:h1 (unchanged), b:h2 (will change), c:h3 (removed → tombstone).
    await run(port.upsert({ collection: "agents", rows: [docRow("a", "h1").row, docRow("b", "h2").row, docRow("c", "h3").row] }))
    // Live now: a:h1 (unchanged), b:h2b (changed → upsert), d:h4 (new → upsert); c gone → tombstone.
    const live = [docRow("a", "h1"), docRow("b", "h2b"), docRow("d", "h4")]
    const summaries: unknown[] = []
    const spool: IndexJobs.OutputSpoolSink = { spool: (i) => { summaries.push(i.summary); return Effect.succeed(`ref:${i.collection}`) } }
    const port2 = MilvusBinding.createMilvusIndexPort({
      endpoint,
      probe: async () => ({ reachable: true, latencyMs: 1 }),
      port,
      source: source(live),
      context: async () => ({ projectId: "proj_1", bindingVersion: 7 }),
      spool,
    })
    const out = await run(port2.reconcile({ collection: "agents" }))
    expect(out.upsertedCount).toBe(2) // b changed + d new
    expect(out.tombstonedCount).toBe(1) // c removed
    expect(out.outputRef).toBe("ref:agents")
    // Never re-pins: the pinned binding version is carried through unchanged.
    expect((summaries[0] as { bindingVersion: number }).bindingVersion).toBe(7)
  })

  test("reindex forces a full rebuild (every live doc upserts, indexed treated as empty)", async () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    await run(port.upsert({ collection: "tools", rows: [docRow("a", "h1").row] }))
    const live = [docRow("a", "h1"), docRow("b", "h2")]
    const port2 = MilvusBinding.createMilvusIndexPort({
      endpoint,
      probe: async () => ({ reachable: true, latencyMs: 1 }),
      port,
      source: source(live),
      context: async () => ({ projectId: "proj_1", bindingVersion: 3 }),
    })
    const out = await run(port2.reindex({ collection: "tools", principal: { kind: "operator", id: "op" } }))
    expect(out.upsertedCount).toBe(2) // full rebuild upserts every live doc
    expect(out.tombstonedCount).toBe(0)
  })

  test("without a bound live-doc source, reindex/reconcile keep the honest milvus_unavailable gap", async () => {
    const port2 = MilvusBinding.createMilvusIndexPort({ endpoint, probe: async () => ({ reachable: true, latencyMs: 1 }), port: MilvusAdapter.createFakeMilvusAdapter() })
    const exit = await runExit(port2.reconcile({ collection: "agents" as CollectionKind }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("milvus_unavailable")
  })
})
