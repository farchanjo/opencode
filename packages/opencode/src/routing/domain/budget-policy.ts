/**
 * Feature 001 / T022 — Budget Policy domain enforcement.
 *
 * Pure, deterministic enforcement of the Context, Turn and Delegation Budget
 * hard maximums (doc/arch/schemas/routing/budget.cue,
 * doc/arch/sdd/001-.../hierarchy-flow.md "Context, Turn and Delegation Budget
 * Flow"). `Budget.Policy` hard maximums may never be relaxed by a model,
 * plugin, MCP call or nested instruction — every dimension check below
 * yields an explicit outcome ("blocked" | "escalation" | "error") instead of
 * a silently truncated or reduced value.
 *
 * Zero framework deps (plan.md "Domain ... zero framework deps"): no I/O, no
 * Effect runtime import. Operates purely over the already-decoded
 * `Budget.Policy` / `Budget.Consumption` value objects.
 *
 * Coverage of the T022 dimension list:
 *   - limits:      max_turns, max_context_tokens/bytes, max_output_tokens/bytes
 *   - concurrency: max_workers (fanout admission), max_delegation_depth (<=2)
 *   - retrieval:   retrieval_top_k, rerank_top_k, max_skill_chunks/tokens
 *   - cost:        time_budget_ms, cost_budget_usd, token_budget
 *   - resilience:  retry_depth, validation_depth, escalation_threshold
 *
 * KNOWN GAP (report to spec corpus): `Budget.Consumption` (budget-consumption.cue)
 * tracks token counts but carries no `context_bytes_used` / `output_bytes_used`,
 * `rerank_chunks_used`, or `skill_chunks_used` fields, even though
 * `Budget.Policy.limits`/`Budget.Policy.retrieval` define byte and
 * rerank/skill-chunk hard maximums. This module accepts those as optional
 * caller-supplied observations (`ByteObservation`, `RetrievalRequest`) rather
 * than reading them off `Budget.Consumption`, which does not carry them.
 */
export * as BudgetPolicy from "./budget-policy"

import type { Budget } from "@opencode-ai/schema/routing/budget"

// =============================================================================
// Outcome vocabulary
// =============================================================================

/**
 * - "ok"         within the hard maximum; no action required.
 * - "blocked"    a hard maximum was exceeded; caller MUST NOT proceed with
 *                the oversized request/consumption (limits, cost, retrieval,
 *                fanout, delegation depth).
 * - "escalation" a resilience threshold (retry/validation depth) was
 *                reached; caller MUST reclassify/escalate rather than retry
 *                blindly (hierarchy-flow.md Fallback State Machine).
 * - "error"      the check itself could not be evaluated (non-finite input);
 *                caller MUST surface this, never silently continue.
 */
export const OUTCOME_KINDS = ["ok", "blocked", "escalation", "error"] as const
export type Outcome = (typeof OUTCOME_KINDS)[number]

export interface Violation {
  readonly dimension: string
  readonly limit: number
  readonly observed: number
  readonly outcome: Exclude<Outcome, "ok">
  readonly reason: string
}

export interface Decision {
  readonly outcome: Outcome
  readonly violations: ReadonlyArray<Violation>
}

const OUTCOME_SEVERITY: Readonly<Record<Outcome, number>> = { ok: 0, escalation: 1, blocked: 2, error: 3 }

function aggregate(violations: ReadonlyArray<Violation>): Decision {
  if (violations.length === 0) return { outcome: "ok", violations: [] }
  let outcome: Outcome = "ok"
  for (const violation of violations) {
    if (OUTCOME_SEVERITY[violation.outcome] > OUTCOME_SEVERITY[outcome]) outcome = violation.outcome
  }
  return { outcome, violations }
}

/** Hard-maximum check: `observed > limit` produces a violation, never a truncated value. */
function overMax(
  dimension: string,
  limit: number,
  observed: number,
  outcome: Exclude<Outcome, "ok">,
  reason: string,
): Violation | null {
  if (!Number.isFinite(limit) || !Number.isFinite(observed)) {
    return { dimension, limit, observed, outcome: "error", reason: `${dimension}: non-finite value (limit or observed)` }
  }
  if (observed > limit) return { dimension, limit, observed, outcome, reason }
  return null
}

function collect(violations: (Violation | null)[]): Violation[] {
  return violations.filter((v): v is Violation => v !== null)
}

// =============================================================================
// Limits: max_turns, max_context_tokens/bytes, max_output_tokens/bytes
// =============================================================================

export interface ByteObservation {
  readonly context_bytes: number
  readonly output_bytes: number
}

/** Checks `Budget.Limits` hard maximums against observed turn/token (and optional byte) spend. */
export function checkLimits(policy: Budget.Policy, consumption: Budget.Consumption, bytes?: ByteObservation): Decision {
  const { limits } = policy
  const { throughput } = consumption
  const violations = collect([
    overMax("max_turns", limits.max_turns, throughput.turns_used, "blocked", "turn count exceeds max_turns"),
    overMax(
      "max_context_tokens",
      limits.max_context_tokens,
      throughput.context_tokens_used,
      "blocked",
      "context tokens exceed max_context_tokens",
    ),
    overMax(
      "max_output_tokens",
      limits.max_output_tokens,
      throughput.output_tokens_used,
      "blocked",
      "output tokens exceed max_output_tokens",
    ),
    ...(bytes
      ? [
          overMax(
            "max_context_bytes",
            limits.max_context_bytes,
            bytes.context_bytes,
            "blocked" as const,
            "context bytes exceed max_context_bytes",
          ),
          overMax(
            "max_output_bytes",
            limits.max_output_bytes,
            bytes.output_bytes,
            "blocked" as const,
            "output bytes exceed max_output_bytes",
          ),
        ]
      : []),
  ])
  return aggregate(violations)
}

// =============================================================================
// Concurrency: max_workers (fanout admission), max_delegation_depth
// =============================================================================

export interface FanoutAdmission extends Decision {
  /** min(requestedWorkers, max_workers) — never negative, never silently unreported. */
  readonly granted: number
}

/**
 * Admission-controlled fanout (hierarchy-flow.md "Budget Flow": grants =
 * min(requested, max_workers, ...)). This function enforces the max_workers
 * factor only; hierarchy-dispatcher.ts (T023) composes it with cost/token
 * headroom from `checkCost` for the full admission formula.
 */
export function admitFanout(policy: Budget.Policy, requestedWorkers: number): FanoutAdmission {
  const maxWorkers = policy.concurrency.max_workers
  const granted = Number.isFinite(requestedWorkers) ? Math.max(0, Math.min(requestedWorkers, maxWorkers)) : 0
  const violation = overMax(
    "max_workers",
    maxWorkers,
    requestedWorkers,
    "blocked",
    "requested fanout exceeds max_workers; admitted at the hard cap",
  )
  return { ...aggregate(collect([violation])), granted }
}

/** Enforces max_delegation_depth (<= 2, Architect -> Manager -> Worker). */
export function checkDelegationDepth(policy: Budget.Policy, requestedDepth: number): Decision {
  const violation = overMax(
    "max_delegation_depth",
    policy.concurrency.max_delegation_depth,
    requestedDepth,
    "blocked",
    "delegation depth exceeds max_delegation_depth (Architect -> Manager -> Worker = 2)",
  )
  return aggregate(collect([violation]))
}

// =============================================================================
// Retrieval: retrieval_top_k, rerank_top_k, max_skill_chunks/tokens
// =============================================================================

export interface RetrievalRequest {
  readonly retrieval_k: number
  readonly rerank_k: number
  readonly skill_chunks: number
  readonly skill_tokens: number
}

export interface RetrievalAdmission extends Decision {
  readonly granted: RetrievalRequest
}

/**
 * Admission-controlled retrieval request (Feature 006 consumes
 * retrieval_top_k/rerank_top_k/max_skill_chunks from Budget policy per
 * plan.md; it does not own hard gates or final route selection — this
 * function is the enforcement point it must call before retrieval).
 */
export function admitRetrieval(policy: Budget.Policy, requested: RetrievalRequest): RetrievalAdmission {
  const { retrieval } = policy
  const violations = collect([
    overMax("retrieval_top_k", retrieval.retrieval_top_k, requested.retrieval_k, "blocked", "requested retrieval_k exceeds retrieval_top_k"),
    overMax("rerank_top_k", retrieval.rerank_top_k, requested.rerank_k, "blocked", "requested rerank_k exceeds rerank_top_k"),
    overMax(
      "max_skill_chunks",
      retrieval.max_skill_chunks,
      requested.skill_chunks,
      "blocked",
      "requested skill_chunks exceeds max_skill_chunks",
    ),
    overMax(
      "max_skill_tokens",
      retrieval.max_skill_tokens,
      requested.skill_tokens,
      "blocked",
      "requested skill_tokens exceeds max_skill_tokens",
    ),
  ])
  const granted: RetrievalRequest = {
    retrieval_k: Math.max(0, Math.min(requested.retrieval_k, retrieval.retrieval_top_k)),
    rerank_k: Math.max(0, Math.min(requested.rerank_k, retrieval.rerank_top_k)),
    skill_chunks: Math.max(0, Math.min(requested.skill_chunks, retrieval.max_skill_chunks)),
    skill_tokens: Math.max(0, Math.min(requested.skill_tokens, retrieval.max_skill_tokens)),
  }
  return { ...aggregate(violations), granted }
}

// =============================================================================
// Cost: time_budget_ms, cost_budget_usd, token_budget
// =============================================================================

/** Checks `Budget.Cost` hard maximums against observed wall-clock/monetary/token spend. */
export function checkCost(policy: Budget.Policy, consumption: Budget.Consumption): Decision {
  const { cost } = policy
  const tokensUsed = consumption.throughput.context_tokens_used + consumption.throughput.output_tokens_used
  const violations = collect([
    overMax("time_budget_ms", cost.time_budget_ms, consumption.cost.time_ms_used, "blocked", "elapsed time exceeds time_budget_ms"),
    overMax("cost_budget_usd", cost.cost_budget_usd, consumption.cost.cost_usd_used, "blocked", "spend exceeds cost_budget_usd"),
    overMax("token_budget", cost.token_budget, tokensUsed, "blocked", "total tokens exceed token_budget"),
  ])
  return aggregate(violations)
}

// =============================================================================
// Resilience: retry_depth, validation_depth, escalation_threshold
// =============================================================================

/**
 * Checks `Budget.Resilience` depth maximums. Unlike limits/cost/retrieval,
 * breaching retry_depth or validation_depth does not block outright — it
 * reaches the named `escalation_threshold` signal and forces reclassification
 * (hierarchy-flow.md Fallback State Machine: retryable -> escalate rather than
 * a blind repeat).
 */
export function checkResilience(policy: Budget.Policy, consumption: Budget.Consumption): Decision {
  const { resilience } = policy
  const { resilience: used } = consumption
  const signal = resilience.escalation_threshold
  const violations = collect([
    overMax(
      "retry_depth",
      resilience.retry_depth,
      used.retry_count,
      "escalation",
      `retry count exceeds retry_depth; escalation_threshold=${signal}`,
    ),
    overMax(
      "validation_depth",
      resilience.validation_depth,
      used.validation_count,
      "escalation",
      `validation count exceeds validation_depth; escalation_threshold=${signal}`,
    ),
  ])
  return aggregate(violations)
}

// =============================================================================
// Aggregate evaluation
// =============================================================================

export interface EvaluateBudgetInput {
  readonly bytes?: ByteObservation
  readonly retrieval?: RetrievalRequest
  readonly requestedWorkers?: number
  readonly requestedDepth?: number
}

/**
 * Evaluates every applicable Budget.Policy dimension against
 * Budget.Consumption (plus any optional live observations/requests) and
 * returns the aggregate decision: the most severe outcome across all
 * dimensions, with every individual violation preserved (never collapsed or
 * silently dropped).
 */
export function evaluateBudget(policy: Budget.Policy, consumption: Budget.Consumption, input?: EvaluateBudgetInput): Decision {
  const decisions: Decision[] = [
    checkLimits(policy, consumption, input?.bytes),
    checkCost(policy, consumption),
    checkResilience(policy, consumption),
  ]
  if (input?.requestedWorkers !== undefined) decisions.push(admitFanout(policy, input.requestedWorkers))
  if (input?.requestedDepth !== undefined) decisions.push(checkDelegationDepth(policy, input.requestedDepth))
  if (input?.retrieval !== undefined) decisions.push(admitRetrieval(policy, input.retrieval))
  return aggregate(decisions.flatMap((d) => d.violations))
}
