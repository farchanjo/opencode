import { describe, expect, test } from "bun:test"
import { BudgetPolicy } from "@/routing/domain/budget-policy"
import type { Budget } from "@opencode-ai/schema/routing/budget"

function policy(overrides?: Partial<Budget.Policy>): Budget.Policy {
  return {
    limits: {
      max_turns: 10,
      max_context_tokens: 1000,
      max_context_bytes: 4000,
      max_output_tokens: 500,
      max_output_bytes: 2000,
    },
    concurrency: {
      max_workers: 3,
      max_delegation_depth: 2,
    },
    retrieval: {
      retrieval_top_k: 5,
      rerank_top_k: 3,
      max_skill_chunks: 4,
      max_skill_tokens: 800,
    },
    cost: {
      time_budget_ms: 60_000,
      cost_budget_usd: 1.5,
      token_budget: 1200,
    },
    resilience: {
      retry_depth: 2,
      validation_depth: 1,
      escalation_threshold: "low_confidence",
    },
    ...overrides,
  }
}

function consumption(overrides?: Partial<Budget.Consumption>): Budget.Consumption {
  return {
    throughput: { turns_used: 1, context_tokens_used: 100, output_tokens_used: 50 },
    concurrency: { workers_requested: 0, workers_granted: 0, delegation_depth_used: 0 },
    retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
    cost: { time_ms_used: 0, cost_usd_used: 0 },
    resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
    ...overrides,
  }
}

describe("BudgetPolicy.checkLimits", () => {
  test("within limits returns ok with no violations", () => {
    const result = BudgetPolicy.checkLimits(policy(), consumption())
    expect(result.outcome).toBe("ok")
    expect(result.violations).toEqual([])
  })

  test("exceeding max_turns is blocked, never silently truncated", () => {
    const result = BudgetPolicy.checkLimits(policy(), consumption({ throughput: { turns_used: 11, context_tokens_used: 0, output_tokens_used: 0 } }))
    expect(result.outcome).toBe("blocked")
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.dimension).toBe("max_turns")
    expect(result.violations[0]?.observed).toBe(11)
    expect(result.violations[0]?.limit).toBe(10)
  })

  test("exceeding context and output tokens reports both violations", () => {
    const result = BudgetPolicy.checkLimits(
      policy(),
      consumption({ throughput: { turns_used: 1, context_tokens_used: 1001, output_tokens_used: 501 } }),
    )
    expect(result.outcome).toBe("blocked")
    const dims = result.violations.map((v) => v.dimension).sort()
    expect(dims).toEqual(["max_context_tokens", "max_output_tokens"])
  })

  test("byte caps are ignored when no ByteObservation is supplied", () => {
    const result = BudgetPolicy.checkLimits(policy(), consumption())
    expect(result.outcome).toBe("ok")
  })

  test("byte caps block when observation exceeds max_context_bytes/max_output_bytes", () => {
    const result = BudgetPolicy.checkLimits(policy(), consumption(), { context_bytes: 5000, output_bytes: 100 })
    expect(result.outcome).toBe("blocked")
    expect(result.violations.map((v) => v.dimension)).toEqual(["max_context_bytes"])
  })

  test("non-finite observed value yields an error outcome, not a silent pass", () => {
    const result = BudgetPolicy.checkLimits(
      policy(),
      consumption({ throughput: { turns_used: Number.NaN, context_tokens_used: 0, output_tokens_used: 0 } }),
    )
    expect(result.outcome).toBe("error")
  })
})

describe("BudgetPolicy.admitFanout", () => {
  test("grants requested workers when within max_workers", () => {
    const result = BudgetPolicy.admitFanout(policy(), 2)
    expect(result.outcome).toBe("ok")
    expect(result.granted).toBe(2)
  })

  test("caps grant at max_workers and reports the violation explicitly", () => {
    const result = BudgetPolicy.admitFanout(policy(), 10)
    expect(result.outcome).toBe("blocked")
    expect(result.granted).toBe(3)
    expect(result.violations[0]?.dimension).toBe("max_workers")
  })

  test("never grants a negative worker count", () => {
    const result = BudgetPolicy.admitFanout(policy(), -5)
    expect(result.granted).toBe(0)
  })
})

describe("BudgetPolicy.checkDelegationDepth", () => {
  test("depth within max_delegation_depth is ok", () => {
    expect(BudgetPolicy.checkDelegationDepth(policy(), 2).outcome).toBe("ok")
  })

  test("depth beyond max_delegation_depth is blocked", () => {
    const result = BudgetPolicy.checkDelegationDepth(policy(), 3)
    expect(result.outcome).toBe("blocked")
    expect(result.violations[0]?.dimension).toBe("max_delegation_depth")
  })
})

describe("BudgetPolicy.admitRetrieval", () => {
  test("grants requested retrieval within all four caps", () => {
    const result = BudgetPolicy.admitRetrieval(policy(), { retrieval_k: 2, rerank_k: 1, skill_chunks: 2, skill_tokens: 400 })
    expect(result.outcome).toBe("ok")
    expect(result.granted).toEqual({ retrieval_k: 2, rerank_k: 1, skill_chunks: 2, skill_tokens: 400 })
  })

  test("caps every exceeded dimension independently and reports each violation", () => {
    const result = BudgetPolicy.admitRetrieval(policy(), { retrieval_k: 9, rerank_k: 9, skill_chunks: 9, skill_tokens: 9000 })
    expect(result.outcome).toBe("blocked")
    expect(result.violations).toHaveLength(4)
    expect(result.granted).toEqual({ retrieval_k: 5, rerank_k: 3, skill_chunks: 4, skill_tokens: 800 })
  })
})

describe("BudgetPolicy.checkCost", () => {
  test("within cost budget is ok", () => {
    expect(BudgetPolicy.checkCost(policy(), consumption()).outcome).toBe("ok")
  })

  test("exceeding cost_budget_usd is blocked", () => {
    const result = BudgetPolicy.checkCost(policy(), consumption({ cost: { time_ms_used: 0, cost_usd_used: 2 } }))
    expect(result.outcome).toBe("blocked")
    expect(result.violations[0]?.dimension).toBe("cost_budget_usd")
  })

  test("token_budget is checked against combined context+output tokens", () => {
    const result = BudgetPolicy.checkCost(
      policy(),
      consumption({ throughput: { turns_used: 1, context_tokens_used: 700, output_tokens_used: 600 } }),
    )
    expect(result.outcome).toBe("blocked")
    expect(result.violations[0]?.dimension).toBe("token_budget")
  })
})

describe("BudgetPolicy.checkResilience", () => {
  test("within retry/validation depth is ok", () => {
    expect(BudgetPolicy.checkResilience(policy(), consumption()).outcome).toBe("ok")
  })

  test("exceeding retry_depth yields escalation, not blocked", () => {
    const result = BudgetPolicy.checkResilience(
      policy(),
      consumption({ resilience: { retry_count: 3, validation_count: 0, escalation_count: 0 } }),
    )
    expect(result.outcome).toBe("escalation")
    expect(result.violations[0]?.reason).toContain("escalation_threshold=low_confidence")
  })

  test("exceeding validation_depth yields escalation", () => {
    const result = BudgetPolicy.checkResilience(
      policy(),
      consumption({ resilience: { retry_count: 0, validation_count: 2, escalation_count: 0 } }),
    )
    expect(result.outcome).toBe("escalation")
    expect(result.violations[0]?.dimension).toBe("validation_depth")
  })
})

describe("BudgetPolicy.evaluateBudget", () => {
  test("aggregates the most severe outcome across all dimensions without dropping violations", () => {
    const result = BudgetPolicy.evaluateBudget(
      policy(),
      consumption({
        throughput: { turns_used: 20, context_tokens_used: 0, output_tokens_used: 0 },
        resilience: { retry_count: 3, validation_count: 0, escalation_count: 0 },
      }),
      { requestedWorkers: 10 },
    )
    // blocked (max_turns, max_workers) outranks escalation (retry_depth)
    expect(result.outcome).toBe("blocked")
    const dims = result.violations.map((v) => v.dimension).sort()
    expect(dims).toEqual(["max_turns", "max_workers", "retry_depth"])
  })

  test("all-ok input returns ok with zero violations", () => {
    expect(BudgetPolicy.evaluateBudget(policy(), consumption())).toEqual({ outcome: "ok", violations: [] })
  })
})
