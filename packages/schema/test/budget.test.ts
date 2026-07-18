import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Budget } from "../src/routing/budget"

const validPolicy: Budget.Policy = {
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
    retrieval_top_k: 8,
    rerank_top_k: 4,
    max_skill_chunks: 6,
    max_skill_tokens: 4_000,
  },
  cost: {
    time_budget_ms: 60_000,
    cost_budget_usd: 0.5,
    token_budget: 200_000,
  },
  resilience: {
    retry_depth: 2,
    validation_depth: 1,
    escalation_threshold: "budget_exceeded",
  },
}

const validSnapshot: Budget.PolicySnapshot = {
  policy: validPolicy,
  applied_at: "2026-07-18T00:00:00Z",
  scope: "session",
  routing_profile: "manager",
  task_class: "large",
  role: "architect",
}

const validConsumption: Budget.Consumption = {
  throughput: {
    turns_used: 3,
    context_tokens_used: 12_000,
    output_tokens_used: 900,
  },
  concurrency: {
    workers_requested: 4,
    workers_granted: 3,
    delegation_depth_used: 1,
  },
  retrieval: {
    retrieval_chunks_used: 5,
    skill_tokens_used: 1_200,
  },
  cost: {
    time_ms_used: 4_500,
    cost_usd_used: 0.12,
  },
  resilience: {
    retry_count: 1,
    validation_count: 1,
    escalation_count: 0,
  },
}

describe("Budget.Policy", () => {
  test("round-trips a valid policy through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Budget.Policy)(validPolicy)
    expect(decoded).toEqual(validPolicy)
    expect(Schema.encodeSync(Budget.Policy)(decoded)).toEqual(validPolicy)
  })

  test("rejects a zero max_turns (limits are strictly positive)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.Policy)({
        ...validPolicy,
        limits: { ...validPolicy.limits, max_turns: 0 },
      }),
    ).toThrow()
  })

  test("rejects a delegation depth above the Architect->Manager->Worker ceiling", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.Policy)({
        ...validPolicy,
        concurrency: { ...validPolicy.concurrency, max_delegation_depth: 3 },
      }),
    ).toThrow()
  })

  test("accepts a zero retrieval_top_k (non-negative, not strictly positive)", () => {
    const decoded = Schema.decodeUnknownSync(Budget.Policy)({
      ...validPolicy,
      retrieval: { ...validPolicy.retrieval, retrieval_top_k: 0 },
    })
    expect(decoded.retrieval.retrieval_top_k).toBe(0)
  })

  test("rejects a negative cost_budget_usd", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.Policy)({
        ...validPolicy,
        cost: { ...validPolicy.cost, cost_budget_usd: -0.01 },
      }),
    ).toThrow()
  })

  test("rejects an empty escalation_threshold", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.Policy)({
        ...validPolicy,
        resilience: { ...validPolicy.resilience, escalation_threshold: "" },
      }),
    ).toThrow()
  })
})

describe("Budget.Scope", () => {
  test("accepts every closed-union member", () => {
    for (const value of ["global", "project", "session"] as const) {
      expect(Schema.decodeUnknownSync(Budget.Scope)(value)).toBe(value)
    }
  })

  test("rejects a value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Budget.Scope)("workspace")).toThrow()
  })
})

describe("Budget.PolicySnapshot", () => {
  test("round-trips a valid snapshot through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Budget.PolicySnapshot)(validSnapshot)
    expect(decoded).toEqual(validSnapshot)
    expect(Schema.encodeSync(Budget.PolicySnapshot)(decoded)).toEqual(validSnapshot)
  })

  test("rejects a routing_profile outside the closed union", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.PolicySnapshot)({ ...validSnapshot, routing_profile: "solo" }),
    ).toThrow()
  })

  test("rejects a task_class outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Budget.PolicySnapshot)({ ...validSnapshot, task_class: "tiny" })).toThrow()
  })

  test("rejects a role outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Budget.PolicySnapshot)({ ...validSnapshot, role: "observer" })).toThrow()
  })
})

describe("Budget.Consumption", () => {
  test("round-trips a valid consumption record through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Budget.Consumption)(validConsumption)
    expect(decoded).toEqual(validConsumption)
    expect(Schema.encodeSync(Budget.Consumption)(decoded)).toEqual(validConsumption)
  })

  test("rejects a negative counter", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.Consumption)({
        ...validConsumption,
        throughput: { ...validConsumption.throughput, turns_used: -1 },
      }),
    ).toThrow()
  })

  test("rejects a negative cost_usd_used", () => {
    expect(() =>
      Schema.decodeUnknownSync(Budget.Consumption)({
        ...validConsumption,
        cost: { ...validConsumption.cost, cost_usd_used: -1 },
      }),
    ).toThrow()
  })

  test("accepts a zero cost_usd_used (non-negative, not strictly positive)", () => {
    const decoded = Schema.decodeUnknownSync(Budget.Consumption)({
      ...validConsumption,
      cost: { ...validConsumption.cost, cost_usd_used: 0 },
    })
    expect(decoded.cost.cost_usd_used).toBe(0)
  })
})
