/**
 * Feature 006 / T036 (S6) — retrieval facade + Feature 001 seam acceptance.
 *
 * The facade returns revalidated ranked candidates, records the effective binding
 * versions and Feature 004 language tag without content, and the documented
 * Feature 001 seam is present and covered (FR1, FR2, FR5, FR16, FR21, C2, C11).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { RetrievalFacade } from "@/semantic/retrieval-facade"

const outcome = (rows: RetrievalFacade.RankedRow[]): RetrievalFacade.PipelineOutcome => ({
  rows,
  degradation: { rung: "full_semantic" },
  queryFingerprint: { fingerprint: "fp-1", bindingVersion: 4, configHash: "cfg" },
  cacheHit: true,
  effective: { embeddingBindingVersion: 4, rerankerBindingVersion: 2, languageTag: "pt-BR" },
})

const rows: RetrievalFacade.RankedRow[] = [
  { canonicalId: "agent-a", canonicalVersion: "1", rerank: 0.9, dense: 0.8, sparse: 0.2 },
  { canonicalId: "agent-b", canonicalVersion: "1", rerank: 0.4, dense: 0.5, sparse: 0.1 },
]

const build = () => {
  const recorded: RetrievalFacade.RetrievalDecisionRecord[] = []
  const pipeline: RetrievalFacade.PipelineRunnerPort = {
    runAgents: async () => outcome(rows),
    runSkills: async () => outcome([{ canonicalId: "skill-x", canonicalVersion: "1", rerank: null, dense: 0.7, sparse: 0.3 }]),
    runTools: async () => ({
      rows: [],
      degradation: { rung: "full_semantic" },
      queryFingerprint: { fingerprint: "fp-1", bindingVersion: 4, configHash: "cfg" },
      cacheHit: true,
      effective: { embeddingBindingVersion: 4, rerankerBindingVersion: 2, languageTag: "pt-BR" },
    }),
  }
  const facade = RetrievalFacade.createRetrievalFacade({ pipeline, recorder: { record: (d) => recorded.push(d) } })
  return { facade, recorded }
}

const request = {
  profile: { taskId: "t1", queryText: "deploy", projectId: "p1", languageTag: "pt-BR" },
  retrievalTopK: 50,
  rerankTopK: 10,
  filters: { projectId: "p1" },
}

describe("retrieveAgents", () => {
  test("returns revalidated ranked candidates with bounded confidence", async () => {
    const { facade } = build()
    const result = await Effect.runPromise(facade.retrieveAgents(request))
    expect(result.candidates.map((c) => c.canonicalId)).toEqual(["agent-a", "agent-b"])
    expect(result.candidates.every((c) => c.revalidated)).toBe(true)
    expect(result.candidates.every((c) => c.score.confidence >= 0 && c.score.confidence <= 1)).toBe(true)
    expect(result.cacheHit).toBe(true)
  })

  test("records the effective binding versions and language tag without content", async () => {
    const { facade, recorded } = build()
    await Effect.runPromise(facade.retrieveAgents(request))
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toEqual({ embeddingBindingVersion: 4, rerankerBindingVersion: 2, languageTag: "pt-BR" })
    // No query text in the record.
    expect(JSON.stringify(recorded[0])).not.toContain("deploy")
  })

  test("rejects a budget overflow before retrieval", async () => {
    const { facade } = build()
    const exit = Effect.runSyncExit(facade.retrieveAgents({ ...request, rerankTopK: 999 }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("retrieveSkills", () => {
  test("returns skill candidates constrained by the prior agent pass", async () => {
    const { facade } = build()
    const result = await Effect.runPromise(facade.retrieveSkills({ ...request, selectedAgentCanonicalId: "agent-a", maxSkillChunks: 5 }))
    expect(result.candidates[0].kind).toBe("skill")
    expect(result.candidates[0].canonicalId).toBe("skill-x")
  })
})

describe("Feature 001 seam", () => {
  test("the documented wiring point hands the port through unchanged (unreachable in V1)", () => {
    const { facade } = build()
    expect(RetrievalFacade.FEATURE_001_SELECTION_SEAM(facade)).toBe(facade)
  })
})
