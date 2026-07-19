import { describe, expect, test } from "bun:test"
import { ToolPass } from "@opencode-ai/core/semantic/tool-pass"
import { TieBreak } from "@opencode-ai/core/semantic/tie-break"

// Feature 009 / T014 (S13) — the immutable tool-retrieval pass. The stage order is
// the fixed 1–6 + 9 (no agent-only 7 select_agent / 8 skill_pass), the tie-break is
// reused verbatim down to the composed tool id / version leg, an empty recall
// invents no tool and never consults the reranker, and identical inputs yield
// identical ordering over deterministic ports (FR11, FR12, C2, C3, AC1, AC4, AC8, AC13).

const request = {
  profile: {
    fingerprint: { fingerprint: "fp-1", binding_version: 1, config_hash: "cfg-1" },
    role_hint: "worker",
    domains: ["fs"],
    languages: ["pt-BR"],
    project_id: "proj-1",
  },
  collection: "tools",
  retrieval_top_k: 8,
  rerank_top_k: 3,
  consistency: "bounded",
  mode: "full_semantic",
} as unknown as Parameters<typeof ToolPass.run>[1]

const recallRow = (id: string, dense: number, sparse: number, rank: number): ToolPass.ToolRecallRow => ({
  id,
  version: 1,
  contentHash: `h-${id}`,
  source: "native",
  rerank: null,
  dense,
  sparse,
  dense_rank: rank,
  sparse_rank: rank,
})

const makePorts = (
  recall: readonly ToolPass.ToolRecallRow[],
  trace: string[] = [],
): ToolPass.ToolPassPorts => ({
  embedQuery: async () => {
    trace.push("embed")
  },
  recall: async () => {
    trace.push("recall")
    return recall
  },
  rerank: async (rows) => {
    trace.push("rerank")
    return rows.map((r, i) => ({ ...r, rerank: 1 - i * 0.1 }) as ToolPass.ToolScored)
  },
  revalidate: async (rows) => {
    trace.push("revalidate")
    return rows
  },
})

describe("ToolPass — fixed stage order 1–6 + 9, no 7/8 (C2, FR11)", () => {
  test("exposes exactly the seven stages, omitting select_agent and skill_pass", () => {
    expect(ToolPass.TOOL_STAGES).toEqual([
      "profile",
      "filter",
      "recall",
      "reduce",
      "rerank",
      "score",
      "revalidate",
    ])
    expect(ToolPass.TOOL_STAGES).toHaveLength(7)
    expect(ToolPass.TOOL_STAGES as readonly string[]).not.toContain("select_agent")
    expect(ToolPass.TOOL_STAGES as readonly string[]).not.toContain("skill_pass")
  })

  test("a populated run traces all seven stages in order and ranks the tools", async () => {
    const run = await ToolPass.run(makePorts([recallRow("tool.read", 0.9, 0.1, 0), recallRow("tool.list", 0.3, 0.3, 1)]), request)
    expect(run.trace).toEqual([...ToolPass.TOOL_STAGES])
    expect(run.tools.length).toBeGreaterThan(0)
    expect(run.tools[0]!.id).toBe("tool.read")
  })
})

describe("ToolPass — empty recall invents no tool (AC1, AC8)", () => {
  test("an empty recall yields no tool and never consults the reranker", async () => {
    const calls: string[] = []
    const run = await ToolPass.run(makePorts([], calls), request)
    expect(run.tools).toEqual([])
    expect(calls).not.toContain("rerank")
    // The stage trace is still the fixed seven (order is immutable regardless of data).
    expect(run.trace).toEqual([...ToolPass.TOOL_STAGES])
  })
})

describe("ToolPass — deterministic tie-break down to tool id/version (C3, AC8)", () => {
  test("colliding scores resolve to the composed tool id then version — a strict total order", () => {
    const rows: ToolPass.ToolScored[] = [
      { id: "same", version: 2, contentHash: "h2", source: "mcp", rerank: 0.5, dense: 0.5, sparse: 0.5 },
      { id: "same", version: 1, contentHash: "h1", source: "mcp", rerank: 0.5, dense: 0.5, sparse: 0.5 },
      { id: "alpha", version: 9, contentHash: "h9", source: "native", rerank: 0.5, dense: 0.5, sparse: 0.5 },
    ]
    const ordered = TieBreak.order(rows)
    expect(ordered.map((r) => `${r.id}:${r.version}`)).toEqual(["alpha:9", "same:1", "same:2"])
  })

  test("identical inputs yield identical ordering over deterministic ports", async () => {
    const rows = [recallRow("b", 0.5, 0.2, 1), recallRow("a", 0.9, 0.1, 0), recallRow("c", 0.3, 0.3, 2)]
    const first = await ToolPass.run(makePorts(rows), request)
    const second = await ToolPass.run(makePorts(rows), request)
    expect(first.tools.map((t) => t.id)).toEqual(second.tools.map((t) => t.id))
  })

  test("the tool content hash rides each row as the C3 version leg alongside the numeric version", async () => {
    const run = await ToolPass.run(makePorts([recallRow("tool.read", 0.9, 0.1, 0)]), request)
    expect(run.tools[0]!.contentHash).toBe("h-tool.read")
    expect(run.tools[0]!.source).toBe("native")
  })
})
