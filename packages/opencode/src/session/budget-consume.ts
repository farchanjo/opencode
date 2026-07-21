/**
 * Feature 043 / Phase 2b — live budget consumption + enforcement helpers.
 *
 * Pure, framework-free arithmetic that wires the Feature 001 budget engine
 * (`routing/domain/budget-policy.ts`) and the `RoutingSessionState` store into
 * the live session response loop (`session/processor.ts` `step-finish`) and the
 * Task fan-out admission seam (`session/routing-hierarchy.ts`):
 *
 *   - `accumulateConsumption` folds a per-response usage delta onto the session's
 *     prior recorded `Budget.Consumption` (running total, never overwrite; FR-A2).
 *   - `recordTurnAndEvaluate` records the accumulated consumption on the store and
 *     re-evaluates the budget against it (the first non-`ZERO_CONSUMPTION` call
 *     site of `evaluateBudget`; FR-A1, FR-A3, FR-B1). A breach is the engine's
 *     explicit `blocked` / `escalation` / `error` outcome — never a truncated or
 *     reduced value (FR-B2, FR-B3).
 *   - `headroomFor` / `perWorkerReserve` convert budget minus recorded consumption
 *     into the real cost/token headroom and a conservative non-zero per-worker
 *     estimate that `admitDispatchFanout` uses to bound the granted worker count
 *     (FR-C1).
 *
 * Zero framework deps: no I/O, no Effect runtime import. The caller (the processor
 * seam) owns the hang/crash-safety wrap (FR-F1); these helpers only compute.
 */
import type { Budget } from "@opencode-ai/schema/routing/budget"
import { evaluateBudget, type Decision } from "@/routing/domain/budget-policy"
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

/**
 * Fold a per-response delta onto the session's prior `Budget.Consumption` — the
 * running total across the session's turns (FR-A2). Only the throughput and cost
 * dimensions are updated from a live response; concurrency / retrieval /
 * resilience carry the prior values unchanged (Phase 3 fills them).
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
    resilience: prior.resilience,
  }
}

// =============================================================================
// Record + re-evaluate mid-session (FR-A1, FR-A3, FR-B1, FR-B2).
// =============================================================================

export interface BudgetEnforcement {
  /** The accumulated running total after this turn was recorded. */
  readonly consumption: Budget.Consumption
  /** The pure engine's outcome over the running total (`ok` when within budget). */
  readonly decision: Decision
  /** True only for a genuine hard-maximum breach (`blocked` / `escalation` /
   * `error`) — the one non-degrading outcome the caller must surface honestly. */
  readonly breached: boolean
}

/**
 * Record the completed response's consumption onto the store (accumulated onto the
 * prior recorded total) and re-evaluate the budget against the running total. The
 * recording happens BEFORE the evaluation reads it (FR-A3), so a breach is detected
 * against the consumption that includes the step just completed. The returned
 * `decision` is the engine's authoritative outcome — the caller never truncates,
 * caps, or reduces the recorded value to fit (FR-B2, FR-B3).
 */
export function recordTurnAndEvaluate(
  store: RoutingSessionStateStore,
  sessionID: SessionID,
  budget: Budget.Policy,
  delta: ConsumptionDelta,
): BudgetEnforcement {
  const prior = store.get(sessionID).consumption ?? ZERO_CONSUMPTION
  const consumption = accumulateConsumption(prior, delta)
  store.recordConsumption(sessionID, consumption)
  const decision = evaluateBudget(budget, consumption)
  return { consumption, decision, breached: decision.outcome !== "ok" }
}

// =============================================================================
// Fan-out admission headroom (FR-C1).
// =============================================================================

/**
 * A conservative estimate of one worker's monetary spend, used to convert
 * remaining `cost_budget_usd` headroom into a worker count. Deliberately small so
 * a generous cost budget lets `max_workers` bind while a nearly-spent budget bounds
 * fan-out below it. Tunable; documented as a plan constant (ADR-0043).
 */
export const PER_WORKER_COST_USD = 0.5

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
 * bounds the granted worker count (not `max_workers` alone). `PER_WORKER_TOKEN_RESERVE`
 * defaults to the budget's `max_output_tokens` — the largest single response a
 * worker may emit — so one worker is priced at its worst-case output ceiling.
 */
export function perWorkerReserve(budget: Budget.Policy): WorkerCost {
  return { costUsd: PER_WORKER_COST_USD, tokens: budget.limits.max_output_tokens }
}
