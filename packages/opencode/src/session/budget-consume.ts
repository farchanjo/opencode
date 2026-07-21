/**
 * Feature 043 / Phase 2b — live budget consumption + enforcement helpers.
 *
 * Pure, framework-free arithmetic that wires the Feature 001 budget engine
 * (`routing/domain/budget-policy.ts`) and the `RoutingSessionState` store into
 * the live session response loop (`session/processor.ts` `step-finish`) and the
 * Task fan-out admission seam (`session/routing-hierarchy.ts`):
 *
 *   - `accumulateConsumption` folds a per-response usage delta onto the session's
 *     prior recorded `Budget.Consumption` (RUNNING TOTAL, never overwrite; FR-A2) —
 *     this is what gets recorded and persisted (`accounting.budget_consumed`; FR-D1).
 *   - `recordTurn` records that running total; `evaluateRecorded` re-evaluates the
 *     budget against it via `evaluateLiveBudget`, which compares each dimension
 *     against a value of the RIGHT SHAPE: the per-response token ceilings
 *     (`max_context_tokens` / `max_output_tokens`) against the CURRENT response's
 *     spend, the cumulative dimensions (`max_turns`, `token_budget`, `cost_usd`)
 *     against the running total. Recording is decoupled from budget resolution so a
 *     transient config-read failure never under-counts the accumulator.
 *   - `exceedsTurnLimit` is the PRE-turn gate for the countable `max_turns`, so it
 *     is honored EXACTLY (blocked before the over-limit turn starts). A breach is
 *     the engine's explicit typed outcome — never a truncated value (FR-B2, FR-B3).
 *   - `headroomFor` / `perWorkerReserve` convert budget minus recorded consumption
 *     into the real cost/token headroom and a conservative non-zero per-worker
 *     estimate that `admitDispatchFanout` uses to bound the granted worker count
 *     (FR-C1).
 *
 * Zero framework deps: no I/O, no Effect runtime import. The caller (the processor
 * seam) owns the hang/crash-safety wrap (FR-F1); these helpers only compute.
 */
import type { Budget } from "@opencode-ai/schema/routing/budget"
import {
  aggregate,
  checkCost,
  checkLimits,
  checkResilience,
  checkRetrievalConsumption,
  type Decision,
  type Outcome,
} from "@/routing/domain/budget-policy"
import type { BudgetHeadroom, WorkerCost } from "@/routing/domain/hierarchy-dispatcher"
import type { RoutingSessionStateStore } from "./routing-state"
import type { SessionID } from "./schema"

// =============================================================================
// Zero consumption — the session-layer starting point for the running total.
// =============================================================================

/** A session's consumption before any turn has settled. Mirrors the routing
 * layer's own `ZERO_CONSUMPTION` (the two are identical constants, not a shared
 * mutable store — SSOT is the engine + the `RoutingSessionState` store). */
export const ZERO_CONSUMPTION: Budget.Consumption = {
  throughput: { turns_used: 0, context_tokens_used: 0, output_tokens_used: 0 },
  concurrency: { workers_requested: 0, workers_granted: 0, delegation_depth_used: 0 },
  retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
  cost: { time_ms_used: 0, cost_usd_used: 0 },
  resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
}

// =============================================================================
// Per-response consumption delta + accumulation (FR-A1, FR-A2).
// =============================================================================

/**
 * One completed LLM response's real spend, derived from `Session.getUsage`:
 * `usage.tokens.input` → context tokens, `usage.tokens.output` → output tokens,
 * one completed step → one turn, `usage.cost` → monetary spend. `getUsage`
 * already clamps non-finite / negative values to safe non-negative counts, so a
 * delta carries no untrusted magnitude.
 */
export interface ConsumptionDelta {
  readonly turns: number
  readonly contextTokens: number
  readonly outputTokens: number
  readonly costUsd: number
  readonly timeMs: number
  /** Data-plane retries observed for this response (Feature 050 FR12) — folded
   * into `resilience.retry_count`. Optional; a delta without it (the pre-050
   * shape) is equivalent to `0`, so old call sites accumulate byte-identically. */
  readonly retries?: number
}

/** Live `Session.getUsage` shape this module reads (the numeric spend only). */
export interface UsageObservation {
  readonly tokens: { readonly input: number; readonly output: number }
  readonly cost: number
}

/** Map a completed-step usage observation to a per-response consumption delta
 * (one step → one turn). Non-finite / negative values collapse to 0 so a
 * malformed usage can never corrupt the running total. */
export function deltaFromUsage(usage: UsageObservation, elapsedMs = 0): ConsumptionDelta {
  return {
    turns: 1,
    contextTokens: safe(usage.tokens.input),
    outputTokens: safe(usage.tokens.output),
    costUsd: safe(usage.cost),
    timeMs: safe(elapsedMs),
  }
}

function safe(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** Zero-or-positive retry count; a missing/non-finite/negative `retries` folds
 * to 0 so a malformed delta can never corrupt the resilience running total. */
function safeRetries(delta: ConsumptionDelta): number {
  const retries = delta.retries
  return retries === undefined ? 0 : safe(retries)
}

/**
 * Create a `ConsumptionDelta` that reports ONLY retries (every other field
 * zeroed) — the shape a data-plane retry site (Feature 050 FR12: T007's
 * `withDataPlaneRetry`, T021's dimension-probe retries) reports without
 * hand-building a full usage delta.
 */
export function retryDelta(count: number): ConsumptionDelta {
  return { turns: 0, contextTokens: 0, outputTokens: 0, costUsd: 0, timeMs: 0, retries: safe(count) }
}

/**
 * Fold a per-response delta onto the session's prior `Budget.Consumption` — the
 * running total across the session's turns (FR-A2). Throughput and cost update
 * from a live response; `resilience.retry_count` accumulates `delta.retries`
 * (Feature 050 FR12 — fed by semantic data-plane retries, no longer inert);
 * `validation_count`/`escalation_count` and concurrency/retrieval still carry
 * the prior values unchanged (future phases fill them).
 */
export function accumulateConsumption(prior: Budget.Consumption, delta: ConsumptionDelta): Budget.Consumption {
  return {
    throughput: {
      ...prior.throughput,
      turns_used: prior.throughput.turns_used + delta.turns,
      context_tokens_used: prior.throughput.context_tokens_used + delta.contextTokens,
      output_tokens_used: prior.throughput.output_tokens_used + delta.outputTokens,
    },
    concurrency: prior.concurrency,
    retrieval: prior.retrieval,
    cost: {
      time_ms_used: prior.cost.time_ms_used + delta.timeMs,
      cost_usd_used: prior.cost.cost_usd_used + delta.costUsd,
    },
    resilience: {
      ...prior.resilience,
      retry_count: prior.resilience.retry_count + safeRetries(delta),
    },
  }
}

// =============================================================================
// Record + re-evaluate mid-session (FR-A1, FR-A3, FR-B1, FR-B2).
// =============================================================================

export interface BudgetEnforcement {
  /** The accumulated running total after this turn was recorded. */
  readonly consumption: Budget.Consumption
  /** The pure engine's outcome over the correctly-shaped consumption (`ok` within budget). */
  readonly decision: Decision
  /** True only for a HARD-STOP outcome (`blocked` / `error`). An `escalation`
   * (resilience threshold) is NOT a hard stop — it is advisory here and wired to
   * halt the turn only in a future phase (see `isHardStop`). */
  readonly breached: boolean
}

/** A hard-stop outcome halts the turn (`ctx.blocked`). `escalation` is deliberately
 * excluded: a resilience threshold asks the caller to reclassify/escalate, not to
 * halt. `resilience.retry_count` is now live (Feature 050 FR12 — accumulated from
 * semantic data-plane retries via `accumulateConsumption`); `validation_count` /
 * `escalation_count` are still unfed, so an `escalation` outcome can only fire on
 * retry_depth today. Only `blocked`/`error` set `ctx.blocked`. */
export function isHardStop(outcome: Outcome): boolean {
  return outcome === "blocked" || outcome === "error"
}

/**
 * The per-response VIEW of the running total. `max_context_tokens` and
 * `max_output_tokens` are PER-RESPONSE window ceilings (the largest single
 * response), NOT cumulative budgets — every step re-sends the full context, so
 * comparing the CUMULATIVE token sum against them would spuriously breach within a
 * handful of steps. This view carries the cumulative `turns_used` (a countable
 * cumulative dimension) but replaces the token counters with the CURRENT response's
 * spend, so `checkLimits` compares each ceiling against a value of the right shape.
 */
function perResponseView(cumulative: Budget.Consumption, delta: ConsumptionDelta): Budget.Consumption {
  return {
    ...cumulative,
    throughput: {
      ...cumulative.throughput,
      context_tokens_used: delta.contextTokens,
      output_tokens_used: delta.outputTokens,
    },
  }
}

/**
 * Evaluate the budget with each dimension compared against a value of the right
 * shape (fixing the per-response-vs-cumulative confusion):
 *   - `checkLimits` runs over the PER-RESPONSE view (`max_context_tokens` /
 *     `max_output_tokens` are per-response ceilings; `max_turns` stays cumulative).
 *   - `checkCost` runs over the CUMULATIVE total (`token_budget` = context+output
 *     summed across turns; `cost_usd`/`time_ms` cumulative) — the genuinely
 *     cumulative dimensions.
 *   - retrieval / resilience run over the cumulative total; `retry_count` is a
 *     real accumulated count (Feature 050 FR12), `validation_count`/
 *     `escalation_count` remain unfed (future phases).
 * A breach is the engine's explicit typed outcome — never a truncated or reduced
 * value (FR-B2, FR-B3).
 */
export function evaluateLiveBudget(
  budget: Budget.Policy,
  cumulative: Budget.Consumption,
  delta: ConsumptionDelta,
): Decision {
  const perResponse = perResponseView(cumulative, delta)
  return aggregate([
    ...checkLimits(budget, perResponse).violations,
    ...checkCost(budget, cumulative).violations,
    ...checkRetrievalConsumption(budget, cumulative).violations,
    ...checkResilience(budget, cumulative).violations,
  ])
}

/**
 * Record the completed response's consumption onto the store (accumulated onto the
 * prior recorded total). Returns the running total. This is DECOUPLED from budget
 * resolution/evaluation so the accumulator is never under-counted by a transient
 * config-read failure (the caller records first, resolves the budget second).
 */
export function recordTurn(store: RoutingSessionStateStore, sessionID: SessionID, delta: ConsumptionDelta): Budget.Consumption {
  const prior = store.get(sessionID).consumption ?? ZERO_CONSUMPTION
  const consumption = accumulateConsumption(prior, delta)
  store.recordConsumption(sessionID, consumption)
  return consumption
}

/** Evaluate an already-recorded running total against the budget (per FR-A3 the
 * recording happens first). The `decision` is authoritative — never truncated. */
export function evaluateRecorded(budget: Budget.Policy, consumption: Budget.Consumption, delta: ConsumptionDelta): BudgetEnforcement {
  const decision = evaluateLiveBudget(budget, consumption, delta)
  return { consumption, decision, breached: isHardStop(decision.outcome) }
}

/**
 * Record + re-evaluate in one call (the recording happens BEFORE the evaluation
 * reads it, FR-A3). Convenience wrapper over `recordTurn` + `evaluateRecorded`;
 * the processor seam calls the two halves separately so recording survives a
 * budget-resolution failure.
 */
export function recordTurnAndEvaluate(
  store: RoutingSessionStateStore,
  sessionID: SessionID,
  budget: Budget.Policy,
  delta: ConsumptionDelta,
): BudgetEnforcement {
  return evaluateRecorded(budget, recordTurn(store, sessionID, delta), delta)
}

/**
 * PRE-turn gate for the one COUNTABLE dimension, `max_turns`: `turns_used + 1 >
 * max_turns` means the NEXT turn would breach, so it MUST be blocked BEFORE it
 * starts (post-execution accounting is inherently one turn late for token/cost, but
 * a countable turn can be gated exactly). Returns true when the next turn must not
 * run. Non-finite limits collapse to "allow" (the post-turn engine reports `error`).
 */
export function exceedsTurnLimit(budget: Budget.Policy, consumption: Budget.Consumption | null): boolean {
  const turnsUsed = consumption?.throughput.turns_used ?? 0
  const max = budget.limits.max_turns
  return Number.isFinite(max) && turnsUsed + 1 > max
}

// =============================================================================
// Fan-out admission headroom (FR-C1).
// =============================================================================

/**
 * A documented, conservative blended token price (USD per 1k tokens) used to derive
 * a worker's monetary reserve from its token reserve, so the cost gate is priced
 * consistently with the token gate rather than a magic flat number. Operator-tunable
 * plan constant (ADR-0043). ~0.003 is a deliberately low blended input+output rate:
 * conservative (under-prices rather than over-blocks) but NOT inert.
 */
export const PER_WORKER_TOKEN_RATE_USD_PER_1K = 0.003

/**
 * Real remaining budget headroom = budget − the session's recorded consumption
 * (FR-C1). Floored at 0 so an over-budget session yields zero headroom (which
 * denies fan-out) rather than a negative admission count.
 */
export function headroomFor(budget: Budget.Policy, consumption: Budget.Consumption): BudgetHeadroom {
  const tokensUsed = consumption.throughput.context_tokens_used + consumption.throughput.output_tokens_used
  return {
    costUsd: Math.max(0, budget.cost.cost_budget_usd - consumption.cost.cost_usd_used),
    tokens: Math.max(0, budget.cost.token_budget - tokensUsed),
  }
}

/**
 * A conservative per-worker cost/token reserve so cost/token headroom genuinely
 * bounds the granted worker count (not `max_workers` alone). A worker consumes BOTH
 * its context window AND its output, so the token reserve is priced at
 * `max_context_tokens + max_output_tokens` — one worker's worst-case single-response
 * footprint — NOT output alone (which under-priced a real worker and left the token
 * gate largely inert). The cost reserve is DERIVED from that token reserve at the
 * documented `PER_WORKER_TOKEN_RATE_USD_PER_1K` rate, so cost and token gates stay
 * consistent. Conservative but not inert: a fresh session still lets `max_workers`
 * bind while a spent budget bounds fan-out below it.
 */
export function perWorkerReserve(budget: Budget.Policy): WorkerCost {
  const tokens = budget.limits.max_context_tokens + budget.limits.max_output_tokens
  return { costUsd: (tokens / 1_000) * PER_WORKER_TOKEN_RATE_USD_PER_1K, tokens }
}
