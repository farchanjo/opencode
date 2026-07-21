/**
 * Feature 050 / T020 (FR9) — `createLiveDocSource` against fake
 * agent/skill sources, an embed spy, and a fake `OutputSpoolStore`.
 *
 * Covers: agents/skills/skill_chunks collect shapes; the embed-skip (an
 * unchanged hash makes ZERO embedding calls, AC5); skill_chunks route through
 * `OutputSpoolStore.put` per chunk before embedding; and the tombstone flow
 * (a doc absent from the live source simply doesn't appear in the snapshot —
 * `runReconcile`'s own tombstone decision is exercised in
 * `feature050-staleness.test.ts`, not reimplemented here).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LiveDocSource } from "@/semantic/live-doc-source"
import type { OutputSpoolStore } from "@/semantic/output-spool-store"
import type { CollectionKind } from "@opencode-ai/protocol/semantic/commands"

const FILTERS = { projectId: "proj-1", scope: "project", visibility: "project" }

/** A minimal in-memory `OutputSpoolStore` fake recording every `put` call (content-hash keyed, like the real façade). */
const createFakeSpoolStore = () => {
  const puts: Array<{ parentSkillId: string; chunkIndex: number; contentHash: string; sanitizedBody: string }> = []
  const store: OutputSpoolStore = {
    put: (input) => {
      puts.push({ ...input })
      return Effect.succeed({ outputRef: input.contentHash, offset: 0, limit: input.sanitizedBody.length, byteLength: input.sanitizedBody.length })
    },
    resolve: () => Effect.fail({ type: "not_found" }),
    supersede: () => Effect.succeed(undefined),
  }
  return { store, puts }
}

const agentInput = (overrides: Partial<{ id: string; description: string; hidden: boolean }> = {}) => ({
  id: overrides.id ?? "agent-a",
  description: overrides.description ?? "does agent things",
  mode: "subagent" as const,
  hidden: overrides.hidden ?? false,
  color: undefined,
  permissions: { rules: [] },
})

const skillInput = (overrides: Partial<{ name: string; description: string; content: string }> = {}) => ({
  name: overrides.name ?? "deploy-helper",
  description: overrides.description ?? "helps deploy things",
  slash: false,
  content: overrides.content ?? "# Deploy Helper\n\nThis skill deploys things reliably across environments.",
})

const baseDeps = (over: Partial<Parameters<typeof LiveDocSource.createLiveDocSource>[0]> = {}) => {
  const embedCalls: readonly string[][] = []
  const embed = (texts: readonly string[]): Promise<ReadonlyArray<readonly number[]>> => {
    ;(embedCalls as string[][]).push([...texts])
    return Promise.resolve(texts.map((_, i) => [i + 1, i + 2]))
  }
  const { store } = createFakeSpoolStore()
  return {
    embedCalls,
    deps: {
      agents: async () => [agentInput()],
      skills: async () => [skillInput()],
      embed,
      spool: store,
      chunking: { maxChunks: 8, chunkSizeTokens: 40, overlapTokens: 5 },
      filters: () => FILTERS,
      ...over,
    },
  }
}

describe("LiveDocSource — agents (T019, T020)", () => {
  test("collects a built AgentDoc row and embeds its description when no indexedHashes are given", async () => {
    const { deps, embedCalls } = baseDeps()
    const source = LiveDocSource.createLiveDocSource(deps)
    const rows = await source.collect({ collection: "agents", projectId: "proj-1" })
    expect(rows.length).toBe(1)
    expect(rows[0]!.canonicalId).toBe("agent-a")
    expect(rows[0]!.row.dense.length).toBeGreaterThan(0)
    expect(embedCalls.length).toBe(1)
    expect(embedCalls[0]).toEqual(["does agent things"])
  })

  test("embed-skip: an unchanged content hash makes ZERO embedding calls (AC5)", async () => {
    const { deps: firstDeps } = baseDeps()
    const first = await LiveDocSource.createLiveDocSource(firstDeps).collect({ collection: "agents", projectId: "proj-1" })
    const priorHash = first[0]!.contentHash

    const { deps, embedCalls } = baseDeps({
      indexedHashes: async () => new Map([["agent-a", priorHash]]),
    })
    const resolved = await LiveDocSource.createLiveDocSource(deps).collect({ collection: "agents", projectId: "proj-1" })
    expect(resolved.length).toBe(1)
    expect(resolved[0]!.row.dense).toEqual([]) // unchanged -> empty vector, never read by planMutations
    expect(embedCalls.length).toBe(0)
  })

  test("a changed content hash still embeds", async () => {
    const { deps, embedCalls } = baseDeps({
      indexedHashes: async () => new Map([["agent-a", "stale-hash-that-never-matches"]]),
    })
    const source = LiveDocSource.createLiveDocSource(deps)
    const rows = await source.collect({ collection: "agents", projectId: "proj-1" })
    expect(rows[0]!.row.dense.length).toBeGreaterThan(0)
    expect(embedCalls.length).toBe(1)
  })
})

describe("LiveDocSource — skills (T019, T020)", () => {
  test("collects a built SkillDoc row keyed by skill name", async () => {
    const { deps, embedCalls } = baseDeps()
    const source = LiveDocSource.createLiveDocSource(deps)
    const rows = await source.collect({ collection: "skills", projectId: "proj-1" })
    expect(rows.length).toBe(1)
    expect(rows[0]!.canonicalId).toBe("deploy-helper")
    expect(rows[0]!.row.filters).toEqual(FILTERS)
    expect(embedCalls.length).toBe(1)
  })

  test("embed-skip applies to skills too", async () => {
    const probe = LiveDocSource.createLiveDocSource(baseDeps().deps)
    const priorHash = (await probe.collect({ collection: "skills", projectId: "proj-1" }))[0]!.contentHash

    const { deps, embedCalls } = baseDeps({ indexedHashes: async () => new Map([["deploy-helper", priorHash]]) })
    const rows = await LiveDocSource.createLiveDocSource(deps).collect({ collection: "skills", projectId: "proj-1" })
    expect(rows[0]!.row.dense).toEqual([])
    expect(embedCalls.length).toBe(0)
  })
})

describe("LiveDocSource — skill_chunks (T019, T020)", () => {
  test("chunks the skill body, puts every chunk through the spool, and embeds each sanitized chunk", async () => {
    const { store, puts } = createFakeSpoolStore()
    const longBody = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some filler words to pad it out.`).join("\n\n")
    const { deps, embedCalls } = baseDeps({
      skills: async () => [skillInput({ content: longBody })],
      spool: store,
      chunking: { maxChunks: 8, chunkSizeTokens: 40, overlapTokens: 5 },
    })
    const source = LiveDocSource.createLiveDocSource(deps)
    const rows = await source.collect({ collection: "skill_chunks", projectId: "proj-1" })

    expect(rows.length).toBeGreaterThan(1) // long body chunks into more than one window
    expect(puts.length).toBe(rows.length) // one spool put per chunk
    expect(embedCalls.length).toBe(1) // one batched embed call for every changed chunk
    expect(embedCalls[0]!.length).toBe(rows.length)
    rows.forEach((row) => expect(row.canonicalId.startsWith("deploy-helper_c")).toBe(true))
  })

  test("embed-skip applies per chunk: an unchanged chunk hash is put but never embedded", async () => {
    const shortBody = "A short skill body that fits in a single chunk window."
    const { store: firstStore } = createFakeSpoolStore()
    const probeDeps = baseDeps({ skills: async () => [skillInput({ content: shortBody })], spool: firstStore }).deps
    const priorRows = await LiveDocSource.createLiveDocSource(probeDeps).collect({ collection: "skill_chunks", projectId: "proj-1" })
    expect(priorRows.length).toBe(1)
    const priorHash = priorRows[0]!.contentHash

    const { store, puts } = createFakeSpoolStore()
    const { deps, embedCalls } = baseDeps({
      skills: async () => [skillInput({ content: shortBody })],
      spool: store,
      indexedHashes: async () => new Map([[priorRows[0]!.canonicalId, priorHash]]),
    })
    const rows = await LiveDocSource.createLiveDocSource(deps).collect({ collection: "skill_chunks", projectId: "proj-1" })
    expect(rows.length).toBe(1)
    expect(rows[0]!.row.dense).toEqual([])
    expect(puts.length).toBe(1) // the spool write still happens (idempotent, content-addressed)
    expect(embedCalls.length).toBe(0)
  })
})

describe("LiveDocSource — tombstone flow (T020)", () => {
  test("a doc absent from the live source simply does not appear in the collected snapshot", async () => {
    const { deps } = baseDeps({ agents: async () => [] })
    const source = LiveDocSource.createLiveDocSource(deps)
    const rows = await source.collect({ collection: "agents", projectId: "proj-1" })
    expect(rows).toEqual([]) // runReconcile's own diff (feature050-staleness.test.ts) turns this into a tombstone
  })
})

describe("LiveDocSource — unsupported collection", () => {
  test("rejects rather than fabricating a snapshot for a collection this source does not own", async () => {
    const { deps } = baseDeps()
    const source = LiveDocSource.createLiveDocSource(deps)
    await expect(source.collect({ collection: "tools" as CollectionKind, projectId: "proj-1" })).rejects.toThrow()
  })
})
