import { describe, expect, test } from "bun:test"
import { Pipeline } from "@opencode-ai/core/semantic/pipeline"
import { TieBreak } from "@opencode-ai/core/semantic/tie-break"

// Feature 006 / T015 (S6) — the immutable nine-stage pipeline orchestrator. The
// stage order is fixed, an empty recall invents no agent, and identical inputs
// yield identical stage sequencing over deterministic ports (FR3, FR5, C2, AC2,
// AC18).

const request = {
  profile: {
    fingerprint: { fingerprint: "fp-1", binding_version: 1, config_hash: "cfg-1" },
    role_hint: "architect",
    domains: ["backend"],
    languages: ["pt-BR"],
    project_id: "proj-1",
  },
  collection: "agents",
  retrieval_top_k: 8,
  rerank_top_k: 3,
  consistency: "bounded",
  mode: "full_semantic",
} as unknown as Parameters<typeof Pipeline.run>[1]

const recallRow = (id: string, dense: number, sparse: number, rank: number): Pipeline.RecallRow => ({
  id,
  version: 1,
  rerank: null,
  dense,
  sparse,
  dense_rank: rank,
  sparse_rank: rank,
})

const makePorts = (
  recall: readonly Pipeline.RecallRow[],
  trace: string[] = [],
): Pipeline.PipelinePorts => ({
  embedQuery: async () => {
    trace.push("embed")
  },
  recall: async () => {
    trace.push("recall")
    return recall
  },
  rerank: async (rows) => {
    trace.push("rerank")
    return rows.map((r, i) => ({ ...r, rerank: 1 - i * 0.1 }) as TieBreak.Scored)
  },
  selectAgent: (ordered) => {
    trace.push("select")
    return { id: ordered[0]!.id, rank: 1 }
  },
  retrieveSkills: async () => {
    trace.push("skills")
    return [{ id: "skill-a", version: 1, rerank: 0.7, dense: 0.5, sparse: 0.2 }]
  },
  revalidate: async (rows) => {
    trace.push("revalidate")
    return rows
  },
})

describe("Pipeline — nine-stage order (C2, FR3)", () => {
  test("exposes exactly the nine stages in the fixed order", () => {
    expect(Pipeline.STAGES).toEqual([
      "profile",
      "filter",
      "recall",
      "reduce",
      "rerank",
      "score",
      "select_agent",
      "skill_pass",
      "revalidate",
    ])
    expect(Pipeline.STAGES).toHaveLength(9)
  })

  test("a populated run traces all nine stages in order and selects an agent", async () => {
    const run = await Pipeline.run(makePorts([recallRow("a", 0.9, 0.1, 0), recallRow("b", 0.3, 0.3, 1)]), request)
    expect(run.trace).toEqual([...Pipeline.STAGES])
    expect(run.selection?.id).toBe("a")
    expect(run.agents.length).toBeGreaterThan(0)
  })
})

describe("Pipeline — empty recall invents no agent (AC2, AC18)", () => {
  test("an empty recall yields a null selection and never consults the reranker", async () => {
    const calls: string[] = []
    const run = await Pipeline.run(makePorts([], calls), request)
    expect(run.selection).toBeNull()
    expect(run.agents).toEqual([])
    expect(calls).not.toContain("rerank")
    expect(calls).not.toContain("select")
    // The stage trace is still the fixed nine (order is immutable regardless of data).
    expect(run.trace).toEqual([...Pipeline.STAGES])
  })
})

describe("Pipeline — deterministic sequencing (C2)", () => {
  test("identical inputs yield identical stage sequencing", async () => {
    const rows = [recallRow("a", 0.9, 0.1, 0), recallRow("b", 0.3, 0.3, 1)]
    const first = await Pipeline.run(makePorts(rows), request)
    const second = await Pipeline.run(makePorts(rows), request)
    expect(first.trace).toEqual(second.trace)
    expect(first.agents.map((a) => a.id)).toEqual(second.agents.map((a) => a.id))
  })
})
