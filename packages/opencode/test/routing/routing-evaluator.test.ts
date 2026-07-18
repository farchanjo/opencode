import { describe, expect, test } from "bun:test"
import type { Capability } from "@opencode-ai/schema/routing/capability"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import {
  classifyExecutionBoundary,
  DEFAULT_RANKING_WEIGHTS,
  evaluateHardGates,
  planFallback,
  rankAuthorized,
  runEvaluation,
  selectDecisionModel,
  toCandidateRecords,
  toRoutingError,
  TIE_BREAK_REASON,
  type AuthorizedCandidate,
  type EvaluationCandidate,
  type RankingCriteria,
} from "@/routing/domain/routing-evaluator"

const NOW = "2026-07-18T00:00:00.000Z"

function capabilityRecord(
  overrides: {
    model?: string
    dimensions?: Partial<Capability.ToolCallDimensions>
    source?: Capability.Source
  } = {},
): Capability.Record {
  const model = overrides.model ?? "claude-sonnet-5"
  return {
    identity: { provider: "anthropic", model, variant: "default", api: "anthropic" },
    assessment: {
      source: overrides.source ?? "catalog",
      confidence: 1,
      dimensions: {
        tool_call_present: null,
        max_calls_per_turn: null,
        same_turn_multiple_calls: null,
        serial_runner_execution: null,
        parallel_calls: null,
        continuation_after_tool_result: null,
        multi_turn_cycles: null,
        ...overrides.dimensions,
      },
    },
    freshness: { timestamp: NOW, ttl_ms: 3_600_000, scope: `anthropic/${model}/default` },
  }
}

function candidate(
  overrides: {
    agent?: string
    model?: string
    skills?: ReadonlyArray<string>
    effort?: Enums.TaskEffort
    reasoning?: Enums.ReasoningEffort
    dimensions?: Partial<Capability.ToolCallDimensions>
    overlays?: ReadonlyArray<Capability.Record>
    healthy?: boolean
  } = {},
): EvaluationCandidate {
  const model = overrides.model ?? "claude-sonnet-5"
  return {
    identity: { agent_id: overrides.agent ?? "worker", model_id: model },
    profile: {
      skills: overrides.skills ?? [],
      effort: overrides.effort ?? "medium",
      reasoning_effort: overrides.reasoning ?? "medium",
    },
    capability: {
      catalog: capabilityRecord({ model, dimensions: overrides.dimensions }),
      overlays: overrides.overlays ?? [],
    },
    healthy: overrides.healthy ?? true,
  }
}

const CRITERIA: RankingCriteria = { requiredSkills: [], desiredEffort: "medium", desiredReasoning: "medium" }

const DECISION_INPUTS: Decision.DecisionInputs = {
  structure: { domain_count: 1, independent_units: 1, context_size: 1000 },
  risk: { mutation_risk: 0.1, ambiguity: 0.2, security_migration: 0, external_effects: 0 },
  concurrency: { expected_tools: [], parallelism: 0 },
}

// =============================================================================
// T017 — hard gates
// =============================================================================

describe("routing-evaluator / T017 hard gates", () => {
  test("a candidate satisfying every required dimension is authorized", () => {
    const c = candidate({ dimensions: { tool_call_present: true, parallel_calls: true } })

    const { authorized, evaluated } = evaluateHardGates([c], { tool_call_present: true, parallel_calls: true }, "deny", NOW)

    expect(authorized).toHaveLength(1)
    expect(evaluated[0]?.authorized).toBe(true)
    expect(evaluated[0]?.rejectionReasons).toEqual([])
  })

  test("a candidate missing a required dimension is rejected under deny policy", () => {
    const c = candidate({ dimensions: { parallel_calls: false } }) // tool_call_present unknown

    const { authorized, evaluated } = evaluateHardGates([c], { tool_call_present: true, parallel_calls: true }, "deny", NOW)

    expect(authorized).toHaveLength(0)
    expect(evaluated[0]?.authorized).toBe(false)
    expect(evaluated[0]?.rejectionReasons).toContain("tool_call_present:capability_unknown_deny")
    expect(evaluated[0]?.rejectionReasons).toContain("parallel_calls:capability_unsupported")
  })

  test("records exactly one GateResult per dimension per candidate", () => {
    const c = candidate({ dimensions: { tool_call_present: true } })

    const { evaluated } = evaluateHardGates([c], { tool_call_present: true }, "deny", NOW)

    expect(evaluated[0]?.gates).toHaveLength(7)
    const passed = evaluated[0]?.gates.find((g) => g.dimension === "tool_call_present")
    expect(passed?.passed).toBe(true)
    expect(passed?.requirement).toBe("tool_call_present == true")
  })

  test("keeps only the authorized subset out of a mixed pool", () => {
    const ok = candidate({ agent: "a", model: "m-ok", dimensions: { tool_call_present: true } })
    const bad = candidate({ agent: "b", model: "m-bad", dimensions: { tool_call_present: false } })

    const { authorized } = evaluateHardGates([ok, bad], { tool_call_present: true }, "deny", NOW)

    expect(authorized.map((a) => a.identity.model_id)).toEqual(["m-ok"])
  })
})

// =============================================================================
// T018 — deterministic two-stage ranking
// =============================================================================

function authorize(candidates: ReadonlyArray<EvaluationCandidate>, requirements = {}): ReadonlyArray<AuthorizedCandidate> {
  return evaluateHardGates(candidates, requirements, "deny", NOW).authorized
}

describe("routing-evaluator / T018 ranking", () => {
  test("higher skill coverage (stage 1) outranks a better effort fit (stage 2)", () => {
    const criteria: RankingCriteria = { requiredSkills: ["go"], desiredEffort: "medium", desiredReasoning: "medium" }
    const skilled = candidate({ agent: "a", model: "m-a", skills: ["go"], effort: "massive", reasoning: "minimal" })
    const fit = candidate({ agent: "b", model: "m-b", skills: [], effort: "medium", reasoning: "medium" })

    const { ranking } = rankAuthorized(authorize([skilled, fit]), criteria)

    expect(ranking[0]?.model_id).toBe("m-a")
    expect(ranking[0]?.rank).toBe(1)
    expect(ranking[1]?.rank).toBe(2)
  })

  test("effort/reasoning fit (stage 2) breaks equal skill coverage", () => {
    const criteria: RankingCriteria = { requiredSkills: [], desiredEffort: "low", desiredReasoning: "low" }
    const far = candidate({ agent: "a", model: "m-far", effort: "massive", reasoning: "high" })
    const near = candidate({ agent: "b", model: "m-near", effort: "low", reasoning: "low" })

    const { ranking } = rankAuthorized(authorize([far, near]), criteria)

    expect(ranking[0]?.model_id).toBe("m-near")
  })

  test("identical scores fall to the deterministic (agent_id, model_id) tie-break", () => {
    const x = candidate({ agent: "zeta", model: "m2" })
    const y = candidate({ agent: "alpha", model: "m1" })

    const { ranking, tieBreak } = rankAuthorized(authorize([x, y]), CRITERIA)

    expect(ranking[0]?.agent_id).toBe("alpha")
    expect(ranking[0]?.tie_break_applied).toBe(true)
    expect(tieBreak).toBe(TIE_BREAK_REASON)
  })

  test("tieBreak is null and tie_break_applied false when scores are distinct", () => {
    const criteria: RankingCriteria = { requiredSkills: ["go"], desiredEffort: "medium", desiredReasoning: "medium" }
    const a = candidate({ agent: "a", model: "m-a", skills: ["go"] })
    const b = candidate({ agent: "b", model: "m-b", skills: [] })

    const { ranking, tieBreak } = rankAuthorized(authorize([a, b]), criteria)

    expect(tieBreak).toBeNull()
    expect(ranking.every((r) => r.tie_break_applied === false)).toBe(true)
  })

  test("ranking is a stable total order regardless of input order", () => {
    const criteria: RankingCriteria = { requiredSkills: ["go", "rust"], desiredEffort: "high", desiredReasoning: "high" }
    const pool = [
      candidate({ agent: "a", model: "m-a", skills: ["go"], effort: "high", reasoning: "high" }),
      candidate({ agent: "b", model: "m-b", skills: ["go", "rust"], effort: "low", reasoning: "low" }),
      candidate({ agent: "c", model: "m-c", skills: [], effort: "high", reasoning: "high" }),
    ]

    const forward = rankAuthorized(authorize(pool), criteria).ranking.map((r) => r.model_id)
    const reverse = rankAuthorized(authorize([...pool].reverse()), criteria).ranking.map((r) => r.model_id)

    expect(forward).toEqual(reverse)
    expect(forward[0]).toBe("m-b") // full skill coverage dominates stage 1
  })

  test("score_breakdown carries the two-stage components", () => {
    const { ranking } = rankAuthorized(authorize([candidate()]), CRITERIA, DEFAULT_RANKING_WEIGHTS)

    const breakdown = ranking[0]?.score_breakdown
    expect(breakdown).toBeDefined()
    for (const key of ["skill_coverage", "effort_fit", "reasoning_fit", "stage1_agent", "stage2_model", "final_score"]) {
      expect(breakdown?.[key]).toBeGreaterThanOrEqual(0)
    }
  })
})

// =============================================================================
// CORE INVARIANT — hard gates authoritative
// =============================================================================

describe("routing-evaluator / hard gates are authoritative", () => {
  test("ranking can never resurrect a gated-out candidate", () => {
    const authorized = candidate({ agent: "a", model: "m-ok", dimensions: { tool_call_present: true } })
    const rejected = candidate({ agent: "b", model: "m-bad", dimensions: { tool_call_present: false } })

    const gates = evaluateHardGates([authorized, rejected], { tool_call_present: true }, "deny", NOW)
    const { ranking } = rankAuthorized(gates.authorized, CRITERIA)

    const rankedModels = ranking.map((r) => r.model_id)
    expect(rankedModels).toContain("m-ok")
    expect(rankedModels).not.toContain("m-bad")
  })

  test("runEvaluation ranks only authorized candidates; rejected ones stay rejected in the record", () => {
    const ok = candidate({ agent: "a", model: "m-ok", dimensions: { tool_call_present: true } })
    const bad = candidate({ agent: "b", model: "m-bad", dimensions: { tool_call_present: false } })

    const result = runEvaluation({
      candidates: [ok, bad],
      requirements: { tool_call_present: true },
      unknownPolicy: "deny",
      now: NOW,
      ranking: CRITERIA,
      classification: { taskClass: "small", routingProfile: "direct_worker" },
      inputs: DECISION_INPUTS,
      decisionPoolModelIds: [],
    })

    expect(result.ranking.map((r) => r.model_id)).toEqual(["m-ok"])
    const badRecord = result.candidates.find((c) => c.identity.model_id === "m-bad")
    expect(badRecord?.outcome.rejected).toBe(true)
    expect(badRecord?.outcome.final_score).toBe(0)
    expect(badRecord?.outcome.rank).toBeGreaterThan(result.ranking.length)
  })

  test("toCandidateRecords assigns positive ranks to every candidate", () => {
    const ok = candidate({ agent: "a", model: "m-ok", dimensions: { tool_call_present: true } })
    const bad = candidate({ agent: "b", model: "m-bad", dimensions: { tool_call_present: false } })
    const gates = evaluateHardGates([ok, bad], { tool_call_present: true }, "deny", NOW)
    const { ranking } = rankAuthorized(gates.authorized, CRITERIA)

    const records = toCandidateRecords(gates, ranking)

    expect(records.every((r) => r.outcome.rank >= 1)).toBe(true)
    expect(new Set(records.map((r) => r.outcome.rank)).size).toBe(records.length)
  })
})

// =============================================================================
// T019 — decision-model selection
// =============================================================================

describe("routing-evaluator / T019 decision model", () => {
  test("bypasses the model when fewer than two candidates are authorized", () => {
    const authorized = authorize([candidate({ model: "m1" })])

    const selection = selectDecisionModel({
      authorized,
      decisionPoolModelIds: ["m1"],
      inputs: DECISION_INPUTS,
      classification: { taskClass: "small", routingProfile: "direct_worker" },
    })

    expect(selection.bypassed).toBe(true)
    expect(selection.reason).toBe("bypass_single_candidate")
    expect(selection.decisionModelId).toBeNull()
    expect(selection.decisionInputs).toBeNull()
    expect(selection.decisionOutput).toBeNull()
  })

  test("bypasses when forceBypass is set even with multiple candidates", () => {
    const authorized = authorize([candidate({ model: "m1" }), candidate({ agent: "b", model: "m2" })])

    const selection = selectDecisionModel({
      authorized,
      decisionPoolModelIds: ["m1"],
      inputs: DECISION_INPUTS,
      classification: { taskClass: "medium", routingProfile: "manager" },
      bypass: { minCandidatesForModel: 2, forceBypass: true },
    })

    expect(selection.bypassed).toBe(true)
    expect(selection.reason).toBe("bypass_policy_forced")
  })

  test("selects the first pool model backed by an authorized healthy candidate, without recursion", () => {
    const authorized = authorize([
      candidate({ agent: "a", model: "m1", healthy: false }),
      candidate({ agent: "b", model: "m2", healthy: true }),
    ])

    const selection = selectDecisionModel({
      authorized,
      decisionPoolModelIds: ["m1", "m2"], // m1 first but unhealthy -> m2 chosen
      inputs: DECISION_INPUTS,
      classification: { taskClass: "large", routingProfile: "manager" },
    })

    expect(selection.bypassed).toBe(false)
    expect(selection.decisionModelId).toBe("m2")
    expect(selection.decisionInputs).toEqual(DECISION_INPUTS)
    expect(selection.decisionOutput?.recommended_task_class).toBe("large")
    expect(selection.decisionOutput?.recommended_profile).toBe("manager")
    // confidence derived from structured ambiguity (0.2) -> 0.8, never a raw prompt.
    expect(selection.decisionOutput?.confidence).toBeCloseTo(0.8, 5)
  })

  test("bypasses when no authorized healthy pool member exists", () => {
    const authorized = authorize([
      candidate({ agent: "a", model: "m1", healthy: false }),
      candidate({ agent: "b", model: "m2", healthy: false }),
    ])

    const selection = selectDecisionModel({
      authorized,
      decisionPoolModelIds: ["m1", "m2"],
      inputs: DECISION_INPUTS,
      classification: { taskClass: "small", routingProfile: "direct_worker" },
    })

    expect(selection.bypassed).toBe(true)
    expect(selection.reason).toBe("no_healthy_decision_model")
  })
})

// =============================================================================
// T021 — fallback and execution-boundary classification
// =============================================================================

describe("routing-evaluator / T021 fallback + execution boundary", () => {
  test("classifyExecutionBoundary maps mutation, transient, and terminal failures", () => {
    expect(classifyExecutionBoundary({ failedCandidate: id("a"), mutationPerformed: true, retryable: true })).toBe(
      "mutation_risky",
    )
    expect(classifyExecutionBoundary({ failedCandidate: id("a"), mutationPerformed: false, retryable: true })).toBe(
      "retryable",
    )
    expect(classifyExecutionBoundary({ failedCandidate: id("a"), mutationPerformed: false, retryable: false })).toBe(
      "safe",
    )
  })

  test("mutation_risky never retries and emits an explicit error", () => {
    const authorized = authorize([candidate({ agent: "a", model: "m1" }), candidate({ agent: "b", model: "m2" })])

    const plan = planFallback({ failedCandidate: id("a", "m1"), mutationPerformed: true, retryable: true }, authorized)

    expect(plan.boundary).toBe("mutation_risky")
    expect(plan.fallbackAttempted).toBe(false)
    expect(plan.retryCandidate).toBeNull()
    expect(plan.error?.type).toBe("mutation_risky")
  })

  test("retryable picks a different authorized candidate, never blind-repeating the failed one", () => {
    const authorized = authorize([candidate({ agent: "a", model: "m1" }), candidate({ agent: "b", model: "m2" })])

    const plan = planFallback({ failedCandidate: id("a", "m1"), mutationPerformed: false, retryable: true }, authorized)

    expect(plan.boundary).toBe("retryable")
    expect(plan.fallbackAttempted).toBe(true)
    expect(plan.retryCandidate?.identity.model_id).toBe("m2")
    expect(plan.error).toBeNull()
  })

  test("retryable with only the failed candidate emits no_authorized_candidate", () => {
    const authorized = authorize([candidate({ agent: "a", model: "m1" })])

    const plan = planFallback({ failedCandidate: id("a", "m1"), mutationPerformed: false, retryable: true }, authorized)

    expect(plan.retryCandidate).toBeNull()
    expect(plan.error?.type).toBe("no_authorized_candidate")
  })

  test("safe boundary requires no retry and no error", () => {
    const plan = planFallback({ failedCandidate: id("a"), mutationPerformed: false, retryable: false }, [])

    expect(plan.boundary).toBe("safe")
    expect(plan.fallbackAttempted).toBe(false)
    expect(plan.error).toBeNull()
  })

  test("toRoutingError maps the domain fallback errors onto the protocol union", () => {
    expect(toRoutingError({ type: "no_authorized_candidate", reason: "empty pool" })).toEqual({
      type: "no_authorized_candidate",
      reason: "empty pool",
    })
    const mapped = toRoutingError({ type: "mutation_risky", reason: "wrote a file", candidate: id("a", "m1") })
    expect(mapped).toEqual({ type: "mutation_risky", reason: "wrote a file", agentId: "a", modelId: "m1" })
  })
})

function id(agent: string, model = "m1"): Decision.CandidateIdentity {
  return { agent_id: agent, model_id: model }
}
