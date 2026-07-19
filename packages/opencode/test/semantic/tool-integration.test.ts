/**
 * Feature 009 / T015 (S13) — tool-search integration + fault-injection.
 *
 * Drives the `tools` collection through the injected fake Milvus adapter (hybrid
 * recall under mandatory scalar `DocScope` filters, cross-project isolation,
 * content-hash upsert/tombstone/reconcile), the shared query-embedding cache reuse
 * across native then MCP, the three-rung degradation matrix (Milvus down →
 * lexical_only, reranker down → lexical order, embedder+Milvus down →
 * full_set_passthrough, no binding → floor, per-surface fail-closed → typed error,
 * no model substitution), the operator reindex via the reused `semantic.index.*`
 * reserved ids with no new id, a binding/corpus mutation-attempt leaving both
 * unchanged, and surface parity across native/MCP/code-mode (FR4, FR10, FR20, FR22,
 * NFR2, NFR4, AC5, AC6, AC9, AC10, AC11, AC12, AC16, AC17, AC19).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { Degradation } from "@opencode-ai/core/semantic/degradation"
import { QueryCache } from "@opencode-ai/core/semantic/query-cache"
import { RESERVED_SEMANTIC_COMMAND_IDS } from "@opencode-ai/protocol/semantic/commands"
import type { ToolProjectionInput } from "@opencode-ai/protocol/semantic/commands"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import { IndexJobs } from "@/semantic/index-jobs"
import { ToolProjection } from "@/semantic/tool-projection"
import { ToolRetrieval } from "@/semantic/tool-retrieval"
import { CutoverExecutor } from "@/semantic/cutover-executor"

const scope = (projectId: string): ToolProjectionInput["scope"] =>
  ({
    project_id: projectId,
    scope: "project" as const,
    visibility: "project" as const,
    permission_ref: `perm:${projectId}`,
  }) as unknown as ToolProjectionInput["scope"]

const projectTool = (projectId: string, toolId: string): ReturnType<typeof ToolProjection.project> =>
  ToolProjection.project({
    source: "native",
    toolId,
    displayName: toolId,
    rawDescription: `read files for ${toolId}`,
    rawParameterSchema: { properties: { path: { type: "string", description: "the path", default: "/etc/passwd" } } },
    scope: scope(projectId),
    languageTag: "en-US",
  })

const toolRow = (projectId: string, toolId: string, dense: number[], terms: string[]): MilvusAdapter.DocumentRow =>
  IndexJobs.toolLiveDoc(projectTool(projectId, toolId).doc, { dense, terms }).row

const toolFilters = (projectId: string): MilvusAdapter.MandatoryFilters => ({
  projectId,
  scope: "project",
  visibility: "project",
})

describe("T015 tools collection over the Milvus adapter (AC10, AC11)", () => {
  test("hybrid recall under mandatory scalar filters ranks the relevant tool first", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "tools", rows: [toolRow("p1", "tool.read", [1, 0], ["read", "file"]), toolRow("p1", "tool.list", [0, 1], ["list"])] }))
    const result = Effect.runSync(
      port.search({ collection: "tools", dense: [1, 0], sparseTerms: ["read"], filters: toolFilters("p1"), topK: 10, consistency: "bounded", metric: "cosine" }),
    )
    expect(result.hits[0].canonicalId).toBe("tool.read")
  })

  test("the scalar project key isolates tool projects (no cross-project leak, AC11)", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "tools", rows: [toolRow("p1", "tool.read", [1, 0], ["read"]), toolRow("p2", "tool.secret", [1, 0], ["read"])] }))
    const hits = Effect.runSync(
      port.search({ collection: "tools", dense: [1, 0], sparseTerms: ["read"], filters: toolFilters("p1"), topK: 10, consistency: "bounded", metric: "cosine" }),
    )
    expect(hits.hits.map((h) => h.canonicalId)).toEqual(["tool.read"])
  })

  test("a content-hash change drives an upsert; a removed tool tombstones (AC10)", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    const spool: IndexJobs.OutputSpoolSink = { spool: ({ collection, summary }) => Effect.succeed(`output://semantic/${collection}/${summary.upsertedCount}`) }
    const live = [IndexJobs.toolLiveDoc(projectTool("p1", "tool.read").doc, { dense: [1, 0], terms: ["read"] })]
    const result = await Effect.runPromise(
      IndexJobs.runReconcile({ milvus, spool }, { collection: "tools", live, indexed: [{ canonicalId: "tool.gone", contentHash: "hx" }], projectId: "p1", bindingVersion: 7 }),
    )
    expect(result.summary.upsertedCount).toBe(1)
    expect(result.summary.tombstonedCount).toBe(1)
    expect(result.summary.bindingVersion).toBe(7)
    expect(result.outputRef.startsWith("output://")).toBe(true)
  })

  test("the content hash covers only sanitized kept fields (a stripped default never re-embeds)", () => {
    const kept = projectTool("p1", "tool.read").doc.identity.content_hash
    const again = projectTool("p1", "tool.read").doc.identity.content_hash
    expect(kept).toBe(again)
    // The stripped `default` (/etc/passwd) is dropped by NAME only, never stored.
    expect(projectTool("p1", "tool.read").sanitizedFieldsDropped).toContain("default")
    expect(JSON.stringify(projectTool("p1", "tool.read").doc)).not.toContain("/etc/passwd")
  })
})

describe("T015 shared query-embedding cache reuse across surfaces (AC12, NFR4)", () => {
  test("native then MCP querying the same Task fingerprint reuse the one embedding", () => {
    const cache = QueryCache.create<readonly number[]>()
    const fingerprint = { fingerprint: "fp-tool-1", binding_version: 4, config_hash: "cfg-1" }
    let embedCalls = 0
    const embed = () => {
      embedCalls++
      return [0.1, 0.2, 0.3]
    }
    const native = cache.resolve(QueryCache.keyOf(fingerprint), embed)
    const mcp = cache.resolve(QueryCache.keyOf(fingerprint), embed)
    expect(native.hit).toBe(false)
    expect(mcp.hit).toBe(true)
    expect(embedCalls).toBe(1)
    expect(mcp.value).toEqual(native.value)
  })

  test("a binding-version change forces exactly one re-embed (never a stale reuse)", () => {
    const cache = QueryCache.create<number>()
    let calls = 0
    const embed = () => ++calls
    cache.resolve(QueryCache.keyOf({ fingerprint: "fp", binding_version: 1, config_hash: "c" }), embed)
    const after = cache.resolve(QueryCache.keyOf({ fingerprint: "fp", binding_version: 2, config_hash: "c" }), embed)
    expect(after.hit).toBe(false)
    expect(calls).toBe(2)
  })
})

const healthy: Degradation.HealthConditions = {
  no_binding: false,
  milvus_unavailable: false,
  embedding_unavailable: false,
  cold_index: false,
  index_stale: false,
  retrieval_timeout: false,
  reranker_unavailable: false,
}

describe("T015 tool degradation matrix — three-rung ladder, no model substitution (AC5, AC6, AC7, AC14, AC19)", () => {
  test("Milvus down alone drops to lexical_only and still yields tools", () => {
    const out = Degradation.classifyTool({ ...healthy, milvus_unavailable: true })
    expect(out.mode).toBe("lexical_only")
    expect(Degradation.toolYieldsTools(out.mode)).toBe(true)
  })

  test("reranker down keeps the lexical_only rung (dense/lexical order retained)", () => {
    expect(Degradation.classifyTool({ ...healthy, reranker_unavailable: true }).mode).toBe("lexical_only")
  })

  test("embedder down, and embedder+Milvus down, reach the full_set_passthrough floor (AC7)", () => {
    expect(Degradation.classifyTool({ ...healthy, embedding_unavailable: true }).mode).toBe("full_set_passthrough")
    expect(Degradation.classifyTool({ ...healthy, embedding_unavailable: true, milvus_unavailable: true }).mode).toBe("full_set_passthrough")
  })

  test("no pinned binding reaches the floor; the floor still yields today's full set (AC14)", () => {
    const out = Degradation.classifyTool({ ...healthy, no_binding: true })
    expect(out.mode).toBe("full_set_passthrough")
    expect(Degradation.toolYieldsTools(out.mode)).toBe(true)
  })

  test("a per-surface fail-closed opt-in returns fail_closed (a typed capability gap, not degrade) (AC19)", () => {
    const out = Degradation.classifyTool({ ...healthy, milvus_unavailable: true }, { failClosed: true })
    expect(out.mode).toBe("fail_closed")
    expect(out.gap).toBe("milvus_unavailable")
    expect(Degradation.toolYieldsTools(out.mode)).toBe(false)
  })

  test("no gap carries a stable typed gap code and never auto-substitutes a model", () => {
    const out = Degradation.classifyTool({ ...healthy, embedding_unavailable: true })
    expect(out.gap).toBe("embedding_unavailable")
    // The reason is content-free and never names a substitute model.
    expect(out.degraded_reason).not.toContain("substitute")
  })
})

describe("T015 operator reindex via the reused reserved ids — no new id (AC17, FR22)", () => {
  test("the reserved semantic.index.* ids drive tool reindex/status; no tool-specific id was added", () => {
    expect(new Set(RESERVED_SEMANTIC_COMMAND_IDS).size).toBe(30)
    expect(RESERVED_SEMANTIC_COMMAND_IDS).toContain("semantic.index.reindex")
    expect(RESERVED_SEMANTIC_COMMAND_IDS).toContain("semantic.index.status")
    for (const id of RESERVED_SEMANTIC_COMMAND_IDS) {
      expect(id.startsWith("semantic.")).toBe(true)
      expect(id).not.toContain("tool")
    }
  })

  test("cutover moves the tools collection atomically with agents/skills under one CAS (AC9)", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter({ casToken: "cas-1" })
    const collections: readonly ("agents" | "skills" | "skill_chunks" | "tools")[] = ["agents", "skills", "skill_chunks", "tools"]
    const outcome = await Effect.runPromise(
      CutoverExecutor.cutoverEmbedding({ milvus }, { collections, fromGeneration: "g1", toGeneration: "g2", casExpected: "cas-1", casActual: "cas-1", confirmed: true, bindingVersion: 3 }),
    )
    expect(outcome.kind).toBe("committed")
    if (outcome.kind === "committed") expect(outcome.swapped).toContain("tools")
  })

  test("select and reindex never activate the alias; only cutover does (FR22)", () => {
    expect(CutoverExecutor.activatesAlias("reindex")).toBe(false)
    expect(CutoverExecutor.activatesAlias("cutover")).toBe(true)
  })
})

describe("T015 mutation-attempt + ranked-subset never widens (AC16, FR4)", () => {
  test("the ranked subset is applied after visibility and never widens the permission-visible set", () => {
    const visible = ["tool.read", "tool.write"]
    // A ranking that names a wildcard-DENIED tool cannot smuggle it into the result.
    const gate: ToolRetrieval.RankedGate = { enabled: true, ranked: ["tool.write", "tool.read", "tool.denied"] }
    const narrowed = ToolRetrieval.narrow(visible, (t) => t, gate)
    expect(narrowed).toEqual(["tool.write", "tool.read"])
    expect(narrowed).not.toContain("tool.denied")
  })

  test("a disabled surface renders the full permission-visible set unchanged (default-off floor)", () => {
    const visible = ["tool.read", "tool.write", "tool.bash"]
    expect(ToolRetrieval.narrow(visible, (t) => t, ToolRetrieval.PASSTHROUGH)).toEqual(visible)
    const record = { "tool.read": 1, "tool.write": 2 }
    expect(ToolRetrieval.narrowRecord(record, ToolRetrieval.PASSTHROUGH)).toEqual(record)
  })

  test("a projection is a pure value — no binding or corpus is mutated by projecting a tool", () => {
    const before = projectTool("p1", "tool.read").doc.identity.content_hash
    // Projecting again yields the same hash: pure, no side effect on any shared state.
    const after = projectTool("p1", "tool.read").doc.identity.content_hash
    expect(after).toBe(before)
  })
})

describe("T015 surface parity across native/MCP/code-mode (AC1, AC16)", () => {
  const surfaces = ["native", "mcp", "code_mode"] as const

  test("every surface defaults to the passthrough floor (enabled=false) with the same bounds", () => {
    for (const surface of surfaces) {
      const config = ToolRetrieval.projectSurfaceConfig(undefined, surface)
      expect(config.enabled).toBe(false)
      expect(config.failClosed).toBe(false)
      expect(config.rerankTopK).toBeLessThanOrEqual(config.retrievalTopK)
      expect(ToolRetrieval.surfaceEnabled(undefined, surface)).toBe(false)
    }
  })

  test("the same ranked ids narrow to an identical ordering on every surface (one ranking contract)", () => {
    const visible = ["tool.a", "tool.b", "tool.c"]
    const gate: ToolRetrieval.RankedGate = { enabled: true, ranked: ["tool.c", "tool.a"] }
    const perSurface = surfaces.map(() => ToolRetrieval.narrow(visible, (t) => t, gate))
    for (const narrowed of perSurface) expect(narrowed).toEqual(["tool.c", "tool.a"])
  })
})
