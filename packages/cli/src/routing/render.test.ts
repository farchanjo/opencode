import { describe, expect, test } from "bun:test"
import { renderCapabilityInspect, renderExplain, renderStatus, renderTest } from "./render"

describe("routing renderers", () => {
  test("status renders mode, pools and health", () => {
    const out = renderStatus({
      enabled: true,
      mode: "auto",
      strictGates: true,
      decisionModelPool: ["m/a", "m/b"],
      rolePools: { worker: ["m/c"] },
      catalogVersion: "cat-1",
      policyVersion: "pol-1",
      health: "ok",
      reason: null,
      recommendedAction: null,
      offline: false,
    })
    expect(out).toContain("routing: enabled (mode auto)")
    expect(out).toContain("strict gates: yes")
    expect(out).toContain("decision pool: m/a, m/b")
    expect(out).toContain("worker: m/c")
    expect(out).toContain("catalog: cat-1  policy: pol-1")
    expect(out).toContain("health: ok")
  })

  test("explain renders selection and candidate ranking", () => {
    const out = renderExplain({
      decisionId: "dec-1",
      taskClass: "code",
      routingProfile: "direct_worker",
      selectedAgent: "agent/build",
      selectedModel: "m/a",
      confidence: 0.9,
      decisionModelCalled: false,
      candidates: [{ rank: 1, agentId: "agent/build", modelId: "m/a", score: 12 }],
      fallbackAttempted: false,
      fallbackReason: null,
    })
    expect(out).toContain("decision dec-1")
    expect(out).toContain("selected: agent/build / m/a (confidence 0.9)")
    expect(out).toContain("decision model called: no")
    expect(out).toContain("#1 agent/build / m/a score=12")
  })

  test("test always states that no external model call was made", () => {
    const out = renderTest({
      taskClass: "code",
      routingProfile: "direct_worker",
      authorizedCandidates: [{ rank: 1, agentId: "a", modelId: "m", score: 1 }],
      noExternalModelCall: true,
      redacted: true,
    })
    expect(out).toContain("authorized candidates: 1")
    expect(out).toContain("no external model call was made")
  })

  test("capability inspect renders records with dimensions", () => {
    const out = renderCapabilityInspect({
      records: [
        {
          modelId: "m/a",
          source: "catalog",
          confidence: 0.8,
          dimensions: { parallel_tool_calls: true, streaming: null },
        },
      ],
      redacted: true,
    })
    expect(out).toContain("capability records: 1")
    expect(out).toContain("m/a source=catalog confidence=0.8")
    expect(out).toContain("parallel_tool_calls=true streaming=?")
  })
})
