import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Budget } from "../src/routing/budget"
import { Decision } from "../src/routing/decision"

const validBudgetPolicy: Budget.Policy = {
  limits: {
    max_turns: 10,
    max_context_tokens: 100_000,
    max_context_bytes: 400_000,
    max_output_tokens: 8_000,
    max_output_bytes: 32_000,
  },
  concurrency: {
    max_workers: 4,
    max_delegation_depth: 2,
  },
  retrieval: {
    retrieval_top_k: 20,
    rerank_top_k: 5,
    max_skill_chunks: 10,
    max_skill_tokens: 4_000,
  },
  cost: {
    time_budget_ms: 60_000,
    cost_budget_usd: 1.5,
    token_budget: 100_000,
  },
  resilience: {
    retry_depth: 2,
    validation_depth: 1,
    escalation_threshold: "budget_exceeded",
  },
}

const validBudgetSnapshot: Budget.PolicySnapshot = {
  policy: validBudgetPolicy,
  applied_at: "2026-07-18T00:00:00Z",
  scope: "session",
  routing_profile: "direct_worker",
  task_class: "medium",
  role: "worker",
}

const validBudgetConsumption: Budget.Consumption = {
  throughput: { turns_used: 1, context_tokens_used: 100, output_tokens_used: 50 },
  concurrency: { workers_requested: 1, workers_granted: 1, delegation_depth_used: 0 },
  retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
  cost: { time_ms_used: 100, cost_usd_used: 0.01 },
  resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
}

const validGate: Decision.GateResult = {
  dimension: "tool_call_present",
  passed: true,
  reason: "candidate supports tool calls",
  requirement: "requires tool call support",
  candidate_value: true,
  scope: "provider/model/variant",
}

const validCandidate: Decision.CandidateRecord = {
  identity: { agent_id: "java-architect", model_id: "claude-sonnet-5" },
  profile: { skills: ["read", "edit"], effort: "medium", reasoning_effort: "low" },
  outcome: {
    gate_results: [validGate],
    final_score: 0.87,
    rank: 1,
    rejected: false,
    rejection_reasons: [],
  },
}

const validRanked: Decision.RankedCandidate = {
  agent_id: "java-architect",
  model_id: "claude-sonnet-5",
  rank: 1,
  score_breakdown: { capability: 0.5, cost: 0.37 },
  tie_break_applied: false,
}

const validAuthContext: Decision.AuthContextSnapshot = {
  permission_mode: "default",
  policy_version: "policy-2026-07",
  hard_gates_authoritative: true,
}

const validDecisionInputs: Decision.DecisionInputs = {
  structure: { domain_count: 1, independent_units: 1, context_size: 4_000 },
  risk: { mutation_risk: 0.1, ambiguity: 0.2, security_migration: 0.0, external_effects: 0.0 },
  concurrency: { expected_tools: ["read", "edit"], parallelism: 0.5 },
}

const validDecisionOutput: Decision.DecisionOutput = {
  recommended_profile: "direct_worker",
  recommended_task_class: "medium",
  confidence: 0.9,
  reason: "structured signals indicate a bounded single-file change",
}

const validDecision: Decision.RoutingDecision = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  context: {
    version: 1,
    session_id: "ses_abc123",
    turn_id: "trn_abc123",
    task_fingerprint: "fp-abc123",
  },
  classification: {
    task_class: "medium",
    routing_profile: "direct_worker",
    task_effort: "medium",
    reasoning_effort: "low",
  },
  selection: {
    specialist_agent: "java-architect",
    executor_model: "claude-sonnet-5",
    selected_skills: ["read", "edit"],
    provider_variant: "default",
  },
  evaluation: {
    gates: [validGate],
    candidates: [validCandidate],
    ranking: [validRanked],
    tie_break: null,
    decision_model_id: null,
    decision_inputs: validDecisionInputs,
    decision_output: validDecisionOutput,
  },
  accounting: {
    budget: validBudgetSnapshot,
    budget_consumed: validBudgetConsumption,
    catalog_version: "catalog-2026-07",
    policy_version: "policy-2026-07",
    auth_context: validAuthContext,
  },
  lifecycle: {
    execution_boundary: "safe",
    fallback_attempted: false,
    fallback_reason: null,
    fallback_candidates: null,
    created_at: "2026-07-18T00:00:00Z",
    decision_latency_ms: 120,
    offline: false,
  },
}

describe("Decision.RoutingDecision", () => {
  test("round-trips a valid decision through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Decision.RoutingDecision)(validDecision)
    expect(decoded).toEqual(validDecision)
    expect(Schema.encodeSync(Decision.RoutingDecision)(decoded)).toEqual(validDecision)
  })

  test("rejects a non-ULID id", () => {
    expect(() => Schema.decodeUnknownSync(Decision.RoutingDecision)({ ...validDecision, id: "not-a-ulid" })).toThrow()
  })

  test("rejects an unknown task_class", () => {
    expect(() =>
      Schema.decodeUnknownSync(Decision.RoutingDecision)({
        ...validDecision,
        classification: { ...validDecision.classification, task_class: "gigantic" },
      }),
    ).toThrow()
  })

  test("accepts a decision with fallback state populated", () => {
    const withFallback = {
      ...validDecision,
      lifecycle: {
        ...validDecision.lifecycle,
        fallback_attempted: true,
        fallback_reason: "primary candidate rejected",
        fallback_candidates: ["backup-agent"],
      },
    }
    expect(Schema.decodeUnknownSync(Decision.RoutingDecision)(withFallback)).toEqual(withFallback)
  })

  test("rejects a negative decision_latency_ms", () => {
    expect(() =>
      Schema.decodeUnknownSync(Decision.RoutingDecision)({
        ...validDecision,
        lifecycle: { ...validDecision.lifecycle, decision_latency_ms: -1 },
      }),
    ).toThrow()
  })
})

describe("Decision.GateResult", () => {
  test("accepts each ToolCapabilityValue member as candidate_value", () => {
    for (const candidate_value of [true, false, 4, null] as const) {
      const value = { ...validGate, candidate_value }
      expect(Schema.decodeUnknownSync(Decision.GateResult)(value)).toEqual(value)
    }
  })

  test("rejects a candidate_value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Decision.GateResult)({ ...validGate, candidate_value: "unknown" })).toThrow()
  })
})

describe("Decision.CandidateRecord", () => {
  test("rejects a non-positive rank on the outcome", () => {
    expect(() =>
      Schema.decodeUnknownSync(Decision.CandidateRecord)({
        ...validCandidate,
        outcome: { ...validCandidate.outcome, rank: 0 },
      }),
    ).toThrow()
  })

  test("rejects a negative final_score", () => {
    expect(() =>
      Schema.decodeUnknownSync(Decision.CandidateRecord)({
        ...validCandidate,
        outcome: { ...validCandidate.outcome, final_score: -0.1 },
      }),
    ).toThrow()
  })
})

describe("Decision.DecisionInputs / DecisionOutput", () => {
  test("rejects a risk value outside [0, 1]", () => {
    expect(() =>
      Schema.decodeUnknownSync(Decision.DecisionInputs)({
        ...validDecisionInputs,
        risk: { ...validDecisionInputs.risk, mutation_risk: 1.1 },
      }),
    ).toThrow()
  })

  test("rejects an unknown recommended_profile", () => {
    expect(() =>
      Schema.decodeUnknownSync(Decision.DecisionOutput)({
        ...validDecisionOutput,
        recommended_profile: "solo",
      }),
    ).toThrow()
  })

  test("round-trips valid decision-model inputs and outputs", () => {
    expect(Schema.decodeUnknownSync(Decision.DecisionInputs)(validDecisionInputs)).toEqual(validDecisionInputs)
    expect(Schema.decodeUnknownSync(Decision.DecisionOutput)(validDecisionOutput)).toEqual(validDecisionOutput)
  })
})
