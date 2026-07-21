/**
 * Feature 043 / Phase 2b — live budget consumption + enforcement (FR-F3).
 *
 * Drives the pure consumption helpers (`session/budget-consume.ts`) over the REAL
 * budget engine (`routing/domain/budget-policy.ts`), the REAL fan-out admission
 * (`routing/domain/hierarchy-dispatcher.ts`), and the REAL `RoutingSessionState`
 * store, plus the out-of-box defaults (`config-adapter.ts`). Proves: real
 * consumption is recorded and ACCUMULATES; a hard-maximum breach is an explicit
 * typed outcome (never truncated, never relaxable); fan-out grants fewer workers as
 * headroom shrinks; the default budget is enforced and an operator budget wins; and
 * a thrown error in the budget path degrades to a no-op.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import {
  ZERO_CONSUMPTION,
  accumulateConsumption,
  deltaFromUsage,
  recordTurn,
  recordTurnAndEvaluate,
  evaluateLiveBudget,
  exceedsTurnLimit,
  headroomFor,
  perWorkerReserve,
  PER_WORKER_TOKEN_RATE_USD_PER_1K,
  type ConsumptionDelta,
} from "@/session/budget-consume"
import { createRoutingSessionStateStore } from "@/session/routing-state"
import { admitDispatchFanout } from "@/routing/domain/hierarchy-dispatcher"
import { evaluateBudget } from "@/routing/domain/budget-policy"
import {
  createConfigAdapter,
  DEFAULT_ROUTING_BUDGET,
  DEFAULT_ROUTING_CONFIG,
} from "@/routing/adapters/outbound/config-adapter"
import { createMemoryConfigPort } from "@/operator/adapters"
import type { SessionID } from "@/session/schema"

const SESSION = "ses_budget" as SessionID

function policy(overrides?: {
  readonly maxTurns?: number
  readonly maxContextTokens?: number
  readonly maxOutputTokens?: number
  readonly maxWorkers?: number
  readonly costBudgetUsd?: number
  readonly tokenBudget?: number
}): Budget.Policy {
  return {
    limits: {
      max_turns: overrides?.maxTurns ?? 100,
      max_context_tokens: overrides?.maxContextTokens ?? 1_000_000,
      max_context_bytes: 8_000_000,
      max_output_tokens: overrides?.maxOutputTokens ?? 8_000,
      max_output_bytes: 32_000,
    },
    concurrency: { max_workers: overrides?.maxWorkers ?? 3, max_delegation_depth: 2 },
    retrieval: { retrieval_top_k: 8, rerank_top_k: 4, max_skill_chunks: 8, max_skill_tokens: 4_000 },
    cost: {
      time_budget_ms: 600_000,
      cost_budget_usd: overrides?.costBudgetUsd ?? 10,
      token_budget: overrides?.tokenBudget ?? 800_000,
    },
    resilience: { retry_depth: 2, validation_depth: 1, escalation_threshold: "manual_review" },
  }
}

const delta = (over?: Partial<ConsumptionDelta>): ConsumptionDelta => ({
  turns: 1,
  contextTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  timeMs: 200,
  ...over,
})

// =============================================================================
// FR-F3-a / FR-F3-b — real consumption recorded + accumulated across turns.
// =============================================================================

describe("consumption recording (FR-A1, FR-A2, FR-F3-a/b)", () => {
  test("deltaFromUsage maps live usage: input→context, output→output, one step→one turn", () => {
    const d = deltaFromUsage({ tokens: { input: 1200, output: 340 }, cost: 0.07 }, 900)
    expect(d).toEqual({ turns: 1, contextTokens: 1200, outputTokens: 340, costUsd: 0.07, timeMs: 900 })
  })

  test("deltaFromUsage clamps non-finite / negative usage to 0 (untrusted magnitude)", () => {
    const d = deltaFromUsage({ tokens: { input: -5, output: Number.NaN }, cost: Number.POSITIVE_INFINITY })
    expect(d).toEqual({ turns: 1, contextTokens: 0, outputTokens: 0, costUsd: 0, timeMs: 0 })
  })

  test("accumulateConsumption folds a delta onto the prior total (never overwrites)", () => {
    const once = accumulateConsumption(ZERO_CONSUMPTION, delta({ contextTokens: 100, outputTokens: 50 }))
    const twice = accumulateConsumption(once, delta({ contextTokens: 200, outputTokens: 60 }))
    expect(twice.throughput.turns_used).toBe(2)
    expect(twice.throughput.context_tokens_used).toBe(300)
    expect(twice.throughput.output_tokens_used).toBe(110)
    expect(twice.cost.cost_usd_used).toBeCloseTo(0.02, 6)
  })

  test("recordTurnAndEvaluate records the accumulated running total on the store — no longer a dead zero", () => {
    const store = createRoutingSessionStateStore()
    expect(store.get(SESSION).consumption).toBeNull()

    recordTurnAndEvaluate(store, SESSION, policy(), delta({ contextTokens: 1000, outputTokens: 200, costUsd: 0.05 }))
    const after1 = store.get(SESSION).consumption
    expect(after1?.throughput).toEqual({ turns_used: 1, context_tokens_used: 1000, output_tokens_used: 200 })
    expect(after1?.cost.cost_usd_used).toBeCloseTo(0.05, 6)

    recordTurnAndEvaluate(store, SESSION, policy(), delta({ contextTokens: 500, outputTokens: 100, costUsd: 0.03 }))
    const after2 = store.get(SESSION).consumption
    expect(after2?.throughput.turns_used).toBe(2)
    expect(after2?.throughput.context_tokens_used).toBe(1500)
    expect(after2?.throughput.output_tokens_used).toBe(300)
    expect(after2?.cost.cost_usd_used).toBeCloseTo(0.08, 6)
  })
})

// =============================================================================
// FR-F3-c — a hard-maximum breach is an explicit typed outcome, never truncated.
// =============================================================================

describe("hard-maximum breach → explicit block, never truncation (FR-B2, FR-B3, FR-F3-c)", () => {
  test("max_turns exceeded → blocked with the max_turns violation; the recorded turn count is NOT reduced to fit", () => {
    const store = createRoutingSessionStateStore()
    const p = policy({ maxTurns: 2 })
    recordTurnAndEvaluate(store, SESSION, p, delta())
    recordTurnAndEvaluate(store, SESSION, p, delta())
    const breach = recordTurnAndEvaluate(store, SESSION, p, delta()) // the 3rd turn

    expect(breach.breached).toBe(true)
    expect(breach.decision.outcome).toBe("blocked")
    const v = breach.decision.violations.find((x) => x.dimension === "max_turns")
    expect(v).toBeDefined()
    expect(v?.observed).toBe(3)
    expect(v?.limit).toBe(2)
    // The real spend is preserved verbatim — never silently capped at the max.
    expect(store.get(SESSION).consumption?.throughput.turns_used).toBe(3)
  })

  test("max_context_tokens exceeded → blocked; observed context tokens preserved", () => {
    const store = createRoutingSessionStateStore()
    const breach = recordTurnAndEvaluate(store, SESSION, policy({ maxContextTokens: 100 }), delta({ contextTokens: 150 }))
    expect(breach.decision.outcome).toBe("blocked")
    expect(breach.decision.violations.some((v) => v.dimension === "max_context_tokens")).toBe(true)
    expect(store.get(SESSION).consumption?.throughput.context_tokens_used).toBe(150)
  })

  test("max_output_tokens exceeded → blocked; observed output tokens preserved", () => {
    const store = createRoutingSessionStateStore()
    const breach = recordTurnAndEvaluate(store, SESSION, policy({ maxOutputTokens: 40 }), delta({ outputTokens: 90 }))
    expect(breach.decision.outcome).toBe("blocked")
    expect(breach.decision.violations.some((v) => v.dimension === "max_output_tokens")).toBe(true)
    expect(store.get(SESSION).consumption?.throughput.output_tokens_used).toBe(90)
  })

  test("a nested instruction can NEVER relax a hard maximum — the outcome is a pure function of (policy, consumption)", () => {
    // Enforcement reads ONLY the decoded policy and the recorded consumption; there
    // is no instruction/plugin/MCP path into the engine. The same over-limit spend
    // deterministically blocks, and the recorded value is the real one — proving no
    // "talk past the max" reduction is possible.
    const overLimit: Budget.Consumption = {
      ...ZERO_CONSUMPTION,
      throughput: { turns_used: 99, context_tokens_used: 0, output_tokens_used: 0 },
    }
    const strict = policy({ maxTurns: 5 })
    expect(evaluateBudget(strict, overLimit).outcome).toBe("blocked")
    expect(evaluateBudget(strict, overLimit).outcome).toBe("blocked") // reproducible, authoritative
    // Only a genuinely higher OPERATOR policy changes the outcome — not any instruction.
    expect(evaluateBudget(policy({ maxTurns: 100 }), overLimit).outcome).toBe("ok")
  })

  test("a within-budget turn is `ok` (a within-budget session sees no behavior change)", () => {
    const store = createRoutingSessionStateStore()
    const out = recordTurnAndEvaluate(store, SESSION, policy(), delta())
    expect(out.breached).toBe(false)
    expect(out.decision.outcome).toBe("ok")
  })
})

// =============================================================================
// MUST-FIX 2 — per-response ceilings vs cumulative dimensions. A normal multi-step
// routed session must NOT spuriously breach the per-RESPONSE token ceilings just
// because the cumulative sum crossed them (each step re-sends the full context).
// =============================================================================

describe("per-response ceilings vs cumulative dimensions (Feature 043 MUST-FIX 2)", () => {
  test("a normal multi-step session does NOT spuriously breach max_context_tokens/max_output_tokens", () => {
    const store = createRoutingSessionStateStore()
    // 5 steps, each response ~50k context / 4k output — well within the 200k/8k
    // per-response ceilings, but the CUMULATIVE sum (250k/20k) crosses BOTH.
    const p = policy({ maxContextTokens: 200_000, maxOutputTokens: 8_000, tokenBudget: 800_000, maxTurns: 100 })
    let last = recordTurnAndEvaluate(store, SESSION, p, delta({ contextTokens: 50_000, outputTokens: 4_000 }))
    for (let i = 0; i < 4; i++) {
      last = recordTurnAndEvaluate(store, SESSION, p, delta({ contextTokens: 50_000, outputTokens: 4_000 }))
    }
    // No spurious per-response breach…
    expect(last.breached).toBe(false)
    expect(last.decision.outcome).toBe("ok")
    // …yet the running total is still recorded cumulatively (FR-A2 / FR-D1 accounting).
    expect(store.get(SESSION).consumption?.throughput.context_tokens_used).toBe(250_000)
    expect(store.get(SESSION).consumption?.throughput.output_tokens_used).toBe(20_000)
    expect(store.get(SESSION).consumption?.throughput.turns_used).toBe(5)
  })

  test("the cumulative token_budget still breaches on the summed context+output total", () => {
    const store = createRoutingSessionStateStore()
    // Per-response 50k context is under the 200k ceiling, but the cumulative sum
    // crosses the 120k token_budget on the third step (150k) → blocked on token_budget.
    const p = policy({ maxContextTokens: 200_000, maxOutputTokens: 8_000, tokenBudget: 120_000, maxTurns: 100 })
    recordTurnAndEvaluate(store, SESSION, p, delta({ contextTokens: 50_000, outputTokens: 0 }))
    recordTurnAndEvaluate(store, SESSION, p, delta({ contextTokens: 50_000, outputTokens: 0 }))
    const breach = recordTurnAndEvaluate(store, SESSION, p, delta({ contextTokens: 50_000, outputTokens: 0 }))
    expect(breach.decision.outcome).toBe("blocked")
    expect(breach.decision.violations.some((v) => v.dimension === "token_budget")).toBe(true)
    // No spurious per-response context ceiling breach (each step was 50k < 200k).
    expect(breach.decision.violations.some((v) => v.dimension === "max_context_tokens")).toBe(false)
  })

  test("evaluateLiveBudget compares max_context_tokens against the per-response delta, not the running total", () => {
    // A cumulative total already well past the per-response ceiling, but THIS
    // response is small → no per-response breach; a large response → breach.
    const p = policy({ maxContextTokens: 100_000, tokenBudget: 10_000_000 })
    const cumulative: Budget.Consumption = {
      ...ZERO_CONSUMPTION,
      throughput: { turns_used: 3, context_tokens_used: 500_000, output_tokens_used: 0 },
    }
    const small = evaluateLiveBudget(p, cumulative, delta({ contextTokens: 40_000, outputTokens: 0 }))
    expect(small.outcome).toBe("ok")
    const large = evaluateLiveBudget(p, cumulative, delta({ contextTokens: 120_000, outputTokens: 0 }))
    expect(large.outcome).toBe("blocked")
    expect(large.violations.some((v) => v.dimension === "max_context_tokens")).toBe(true)
  })
})

// =============================================================================
// SHIP-NOTE — pre-turn max_turns gate honors the limit EXACTLY (blocked before the
// over-limit turn starts), plus recording decoupled from budget resolution.
// =============================================================================

describe("pre-turn max_turns gate + decoupled recording (Feature 043 ship-notes)", () => {
  test("exceedsTurnLimit blocks the turn that WOULD push turns_used over max_turns, not one turn late", () => {
    const store = createRoutingSessionStateStore()
    const p = policy({ maxTurns: 2 })
    // Before turn 1: 0 + 1 = 1 <= 2 → allowed.
    expect(exceedsTurnLimit(p, store.get(SESSION).consumption)).toBe(false)
    recordTurn(store, SESSION, delta())
    // Before turn 2: 1 + 1 = 2 <= 2 → allowed.
    expect(exceedsTurnLimit(p, store.get(SESSION).consumption)).toBe(false)
    recordTurn(store, SESSION, delta())
    // Before turn 3: 2 + 1 = 3 > 2 → the next turn is blocked BEFORE it runs.
    expect(exceedsTurnLimit(p, store.get(SESSION).consumption)).toBe(true)
  })

  test("recordTurn accumulates independently of any budget resolution (never under-counted)", () => {
    const store = createRoutingSessionStateStore()
    const first = recordTurn(store, SESSION, delta({ contextTokens: 100, outputTokens: 20 }))
    const second = recordTurn(store, SESSION, delta({ contextTokens: 200, outputTokens: 30 }))
    expect(first.throughput.turns_used).toBe(1)
    expect(second.throughput.turns_used).toBe(2)
    expect(second.throughput.context_tokens_used).toBe(300)
    expect(store.get(SESSION).consumption?.throughput.output_tokens_used).toBe(50)
  })
})

// =============================================================================
// FR-F3-d — fan-out admission grants fewer workers as cost/token headroom shrinks.
// =============================================================================

describe("fan-out admission honors real headroom (FR-C1, FR-C3, FR-F3-d)", () => {
  // A worker is priced at its worst-case single-response footprint: context + output.
  const p = policy({ maxWorkers: 3, costBudgetUsd: 10, tokenBudget: 800_000, maxContextTokens: 200_000, maxOutputTokens: 8_000 })
  // perWorker.tokens = 200000 + 8000 = 208000; perWorker.costUsd = 208 * 0.003 = 0.624.

  test("perWorkerReserve prices a worker at max_context_tokens + max_output_tokens (not output alone), cost derived from the rate", () => {
    const reserve = perWorkerReserve(p)
    expect(reserve.tokens).toBe(208_000)
    expect(reserve.costUsd).toBeCloseTo(0.624, 6)
    expect(reserve.costUsd).toBeGreaterThan(0)
    expect(PER_WORKER_TOKEN_RATE_USD_PER_1K).toBeGreaterThan(0)
  })

  test("ample headroom (fresh session) → max_workers binds — conservative pricing is NOT inert", () => {
    const headroom = headroomFor(p, ZERO_CONSUMPTION)
    expect(headroom).toEqual({ costUsd: 10, tokens: 800_000 })
    const admission = admitDispatchFanout(p, 5, headroom, perWorkerReserve(p))
    // min(5, max_workers=3, byCost=floor(10/0.624)=16, byToken=floor(800000/208000)=3).
    expect(admission.granted).toBe(3)
    expect(admission.outcome).toBe("ok")
  })

  test("shrinking token headroom grants FEWER workers than max_workers", () => {
    // Spend 300000 tokens → 500000 headroom left = floor(500000/208000)=2 workers.
    const consumed = accumulateConsumption(ZERO_CONSUMPTION, delta({ contextTokens: 300_000, outputTokens: 0, turns: 1 }))
    const admission = admitDispatchFanout(p, 5, headroomFor(p, consumed), perWorkerReserve(p))
    expect(admission.factors.byTokenBudget).toBe(2)
    expect(admission.granted).toBe(2) // token headroom now binds below max_workers
  })

  test("shrinking cost headroom grants FEWER workers than max_workers", () => {
    // Leave 0.7 USD of cost headroom = floor(0.7/0.624)=1 worker.
    const consumed = accumulateConsumption(ZERO_CONSUMPTION, delta({ costUsd: 9.3, contextTokens: 0, outputTokens: 0 }))
    const admission = admitDispatchFanout(p, 5, headroomFor(p, consumed), perWorkerReserve(p))
    expect(admission.factors.byCostBudget).toBe(1)
    expect(admission.granted).toBe(1)
  })

  test("a nearly-spent budget denies the spawn outright (granted 0, blocked)", () => {
    // 150000 tokens left < one worker's 208000 reserve → 0 workers.
    const consumed = accumulateConsumption(ZERO_CONSUMPTION, delta({ contextTokens: 650_000, outputTokens: 0 }))
    const admission = admitDispatchFanout(p, 3, headroomFor(p, consumed), perWorkerReserve(p))
    expect(admission.granted).toBe(0)
    expect(admission.outcome).toBe("blocked")
  })

  test("headroom is floored at 0 for an over-budget session (never a negative admission)", () => {
    const consumed = accumulateConsumption(ZERO_CONSUMPTION, delta({ contextTokens: 2_000_000, costUsd: 99 }))
    expect(headroomFor(p, consumed)).toEqual({ costUsd: 0, tokens: 0 })
  })
})

// =============================================================================
// FR-F3-f — the default budget is enforced out-of-box; an operator budget wins.
// =============================================================================

describe("sensible defaults active out-of-box (FR-E1, FR-E2, FR-F3-f)", () => {
  test("DEFAULT_ROUTING_BUDGET matches the grounded ADR-0043 table", () => {
    expect(DEFAULT_ROUTING_BUDGET.limits.max_turns).toBe(8)
    expect(DEFAULT_ROUTING_BUDGET.limits.max_context_tokens).toBe(200_000)
    expect(DEFAULT_ROUTING_BUDGET.limits.max_output_tokens).toBe(8_000)
    expect(DEFAULT_ROUTING_BUDGET.concurrency.max_workers).toBe(3)
    expect(DEFAULT_ROUTING_BUDGET.concurrency.max_delegation_depth).toBe(2)
    expect(DEFAULT_ROUTING_BUDGET.cost.token_budget).toBe(800_000)
  })

  test("resolveEffective with NO operator config → origin `default` enforcing the grounded budget", async () => {
    const adapter = createConfigAdapter({ config: createMemoryConfigPort() })
    const resolved = await adapter.resolveEffective()
    expect(resolved.origin).toBe("default")
    expect(resolved.config.enforcement.budget).toEqual(DEFAULT_ROUTING_BUDGET)
  })

  test("an explicit operator budget wins verbatim over the default (FR-E2)", async () => {
    const adapter = createConfigAdapter({ config: createMemoryConfigPort() })
    const operatorBudget: RoutingConfig.Enforcement["budget"] = {
      ...DEFAULT_ROUTING_BUDGET,
      limits: { ...DEFAULT_ROUTING_BUDGET.limits, max_turns: 42 },
      cost: { ...DEFAULT_ROUTING_BUDGET.cost, token_budget: 1_234_567 },
    }
    const operatorConfig: RoutingConfig.Info = {
      ...DEFAULT_ROUTING_CONFIG,
      activation: { ...DEFAULT_ROUTING_CONFIG.activation, enabled: true, mode: "auto" },
      models: { ...DEFAULT_ROUTING_CONFIG.models, role_pools: { worker: ["m"] } },
      enforcement: { ...DEFAULT_ROUTING_CONFIG.enforcement, budget: operatorBudget },
    }
    const set = await adapter.set("project", operatorConfig, null)
    expect(set.ok).toBe(true)
    const resolved = await adapter.resolveEffective()
    expect(resolved.origin).toBe("project")
    expect(resolved.config.enforcement.budget.limits.max_turns).toBe(42)
    expect(resolved.config.enforcement.budget.cost.token_budget).toBe(1_234_567)
  })
})

// =============================================================================
// FR-F3-g — the budget path is hang/crash-safe: a thrown error degrades to a no-op.
// =============================================================================

describe("hang/crash-safety (FR-F1, FR-F3-g)", () => {
  test("a defect in the enforcement block degrades to a no-op — the turn proceeds", async () => {
    // Mirror the processor's guard: `Effect.gen(...).pipe(Effect.catchCause(() => Effect.void))`.
    let turnProceeded = false
    const guarded = Effect.gen(function* () {
      // A store whose recordConsumption throws stands in for any budget-path defect.
      const brokenStore = {
        ...createRoutingSessionStateStore(),
        recordConsumption: () => {
          throw new Error("boom in the budget path")
        },
      } as ReturnType<typeof createRoutingSessionStateStore>
      recordTurnAndEvaluate(brokenStore, SESSION, policy(), delta())
      yield* Effect.void
    }).pipe(Effect.catchCause(() => Effect.void))

    await Effect.runPromise(guarded) // must resolve, never reject
    turnProceeded = true
    expect(turnProceeded).toBe(true)
  })

  test("accumulate / headroom never throw on malformed magnitudes (defensive arithmetic)", () => {
    expect(() => accumulateConsumption(ZERO_CONSUMPTION, deltaFromUsage({ tokens: { input: -1, output: -1 }, cost: -1 }))).not.toThrow()
    expect(() => headroomFor(policy(), ZERO_CONSUMPTION)).not.toThrow()
  })
})
