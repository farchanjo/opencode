/**
 * Feature 001 / T017-T019+T021 — Routing Evaluator core.
 *
 * The deterministic heart of the Routing Decision Pipeline
 * (hierarchy-flow.md "Routing Decision Pipeline"): hard gates -> decision
 * model -> ranking, plus the post-execution Fallback State Machine. Pure
 * domain: no I/O, no Effect runtime, no model call. Composes the real
 * exports of the sibling domain modules (capability-resolver, classifier).
 *
 * Coverage:
 *   - T017 Hard-gate evaluation: rejects candidates per unmet capability
 *     dimension, keeps only the authorized set, records a `Decision.GateResult`
 *     per candidate x dimension.
 *   - T018 Deterministic two-stage ranking (task -> specialist agent ->
 *     executor model) over the authorized set ONLY, with skill and effort
 *     dimensions and a deterministic recorded tie-break.
 *   - T019 Decision-model selection from the authorized healthy pool without
 *     recursion, recording structured `Decision.DecisionInputs`/`DecisionOutput`
 *     with no raw prompts, skipping the model when the bypass policy is met.
 *   - T021 Fallback + execution-boundary classification (safe / retryable /
 *     mutation_risky): retry only authorized compatible candidates, never
 *     blind-repeat a mutation-risky candidate, and emit explicit
 *     `no_authorized_candidate` errors mapped to the protocol RoutingError
 *     tagged union (packages/protocol/src/routing).
 *
 * CORE INVARIANT (encoded in the type system, asserted in tests): hard gates
 * are AUTHORITATIVE. `AuthorizedCandidate` carries a module-private brand and
 * is only ever produced by `evaluateHardGates`; ranking and decision-model
 * selection consume `AuthorizedCandidate` values exclusively, so a gated-out
 * candidate can NEVER be resurrected downstream.
 *
 * Numeric ranking weights and bypass thresholds are open clarification
 * parameters (hierarchy-flow.md "Open Parameters"); the documented defaults
 * below are exported as data so a config-driven override can replace them
 * without touching the algorithm.
 */
export * as RoutingEvaluator from "./routing-evaluator"

import type { Capability } from "@opencode-ai/schema/routing/capability"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { RoutingError } from "@opencode-ai/protocol/routing/index"
import type { ClassificationResult } from "./classifier"
import {
  DIMENSION_NAMES,
  DEFAULT_LAYER_PRECEDENCE,
  describeRequirement,
  evaluateDimension,
  resolveCapabilityRecord,
  type DimensionName,
} from "./capability-resolver"

// =============================================================================
// Candidate inputs
// =============================================================================

/** A single routing candidate: its identity, profile, capability layers and health. */
export interface EvaluationCandidate {
  readonly identity: Decision.CandidateIdentity
  readonly profile: Decision.CandidateProfile
  readonly capability: {
    readonly catalog: Capability.Record
    readonly overlays: ReadonlyArray<Capability.Record>
  }
  /** Whether the candidate's provider/model is currently healthy (decision-model pool eligibility). */
  readonly healthy: boolean
}

export type DimensionRequirements = Partial<Record<DimensionName, Capability.ToolCapabilityValue>>

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

// =============================================================================
// T017 — Hard gates (authoritative)
// =============================================================================

// Module-private brand: an AuthorizedCandidate can only be minted by
// evaluateHardGates, never fabricated by a downstream stage or a caller.
declare const authorizedBrand: unique symbol

/** A candidate that passed every required hard gate — the ONLY input downstream stages accept. */
export interface AuthorizedCandidate {
  readonly [authorizedBrand]: true
  readonly identity: Decision.CandidateIdentity
  readonly profile: Decision.CandidateProfile
  readonly record: Capability.Record
  readonly gates: ReadonlyArray<Decision.GateResult>
  readonly healthy: boolean
}

/** A candidate after gate evaluation, authorized or rejected, with full per-dimension gate results. */
export interface GatedCandidate {
  readonly identity: Decision.CandidateIdentity
  readonly profile: Decision.CandidateProfile
  readonly record: Capability.Record
  readonly gates: ReadonlyArray<Decision.GateResult>
  readonly authorized: boolean
  readonly rejectionReasons: ReadonlyArray<string>
  readonly healthy: boolean
}

export interface HardGateEvaluation {
  /** Every candidate with its full gate results (authorized and rejected alike). */
  readonly evaluated: ReadonlyArray<GatedCandidate>
  /** The authorized set only — branded so ranking/decision cannot resurrect a rejected candidate. */
  readonly authorized: ReadonlyArray<AuthorizedCandidate>
}

// The sole mint site for the authorized brand: only a fully-authorized gated
// candidate is promoted, so the brand certifies "passed every required gate".
function mintAuthorized(gated: GatedCandidate): AuthorizedCandidate {
  return {
    identity: gated.identity,
    profile: gated.profile,
    record: gated.record,
    gates: gated.gates,
    healthy: gated.healthy,
  } as AuthorizedCandidate
}

function gateCandidate(
  candidate: EvaluationCandidate,
  requirements: DimensionRequirements,
  unknownPolicy: RoutingConfig.UnknownPolicy,
  now: string,
  precedence: ReadonlyArray<Capability.Source>,
): GatedCandidate {
  const record = resolveCapabilityRecord(candidate.capability.catalog, candidate.capability.overlays, now, precedence)
  const scope = record.freshness.scope
  const gates: Decision.GateResult[] = []
  const rejectionReasons: string[] = []

  for (const dimension of DIMENSION_NAMES) {
    const requirement = requirements[dimension] ?? null
    const value = record.assessment.dimensions[dimension]
    const evaluation = evaluateDimension(dimension, value, requirement, unknownPolicy)
    gates.push({
      dimension,
      passed: evaluation.met,
      reason: evaluation.reason,
      requirement: describeRequirement(dimension, requirement),
      candidate_value: value,
      scope,
    })
    if (!evaluation.met) rejectionReasons.push(`${dimension}:${evaluation.reason}`)
  }

  return {
    identity: candidate.identity,
    profile: candidate.profile,
    record,
    gates,
    authorized: rejectionReasons.length === 0,
    rejectionReasons,
    healthy: candidate.healthy,
  }
}

/**
 * T017 — evaluate hard gates for every candidate. Rejects a candidate on the
 * first unmet capability dimension (any rejection reason present), keeps only
 * the fully-authorized candidates in the branded `authorized` set, and records
 * a `Decision.GateResult` per candidate x dimension for the persisted decision.
 */
export function evaluateHardGates(
  candidates: ReadonlyArray<EvaluationCandidate>,
  requirements: DimensionRequirements,
  unknownPolicy: RoutingConfig.UnknownPolicy,
  now: string,
  precedence: ReadonlyArray<Capability.Source> = DEFAULT_LAYER_PRECEDENCE,
): HardGateEvaluation {
  const evaluated = candidates.map((candidate) => gateCandidate(candidate, requirements, unknownPolicy, now, precedence))
  const authorized = evaluated.filter((gated) => gated.authorized).map(mintAuthorized)
  return { evaluated, authorized }
}

// =============================================================================
// T018 — Deterministic two-stage ranking (authorized set only)
// =============================================================================

// Canonical effort orderings (mirror enums.cue #TaskEffort / #ReasoningEffort).
const TASK_EFFORT_ORDER: ReadonlyArray<Enums.TaskEffort> = ["minimal", "low", "medium", "high", "massive"]
const REASONING_EFFORT_ORDER: ReadonlyArray<Enums.ReasoningEffort> = ["minimal", "low", "medium", "high"]

export interface RankingWeights {
  readonly skillCoverage: number
  readonly effortFit: number
  readonly reasoningFit: number
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  skillCoverage: 0.5,
  effortFit: 0.25,
  reasoningFit: 0.25,
}

export interface RankingCriteria {
  readonly requiredSkills: ReadonlyArray<string>
  readonly desiredEffort: Enums.TaskEffort
  readonly desiredReasoning: Enums.ReasoningEffort
}

function skillCoverage(skills: ReadonlyArray<string>, required: ReadonlyArray<string>): number {
  if (required.length === 0) return 1
  const owned = new Set(skills)
  const matched = required.filter((skill) => owned.has(skill)).length
  return matched / required.length
}

function ordinalFit<T extends string>(value: T, target: T, order: ReadonlyArray<T>): number {
  const span = order.length - 1
  if (span <= 0) return 1
  const vi = order.indexOf(value)
  const ti = order.indexOf(target)
  if (vi < 0 || ti < 0) return 0
  return clampUnit(1 - Math.abs(vi - ti) / span)
}

interface ScoredCandidate {
  readonly candidate: AuthorizedCandidate
  readonly stage1: number
  readonly stage2: number
  readonly breakdown: Readonly<Record<string, number>>
}

function scoreCandidate(candidate: AuthorizedCandidate, criteria: RankingCriteria, weights: RankingWeights): ScoredCandidate {
  const skill = skillCoverage(candidate.profile.skills, criteria.requiredSkills)
  const effort = ordinalFit(candidate.profile.effort, criteria.desiredEffort, TASK_EFFORT_ORDER)
  const reasoning = ordinalFit(candidate.profile.reasoning_effort, criteria.desiredReasoning, REASONING_EFFORT_ORDER)
  const stage1 = skill
  const stage2 = effort * weights.effortFit + reasoning * weights.reasoningFit
  const finalScore = skill * weights.skillCoverage + stage2
  return {
    candidate,
    stage1,
    stage2,
    breakdown: {
      skill_coverage: skill,
      effort_fit: effort,
      reasoning_fit: reasoning,
      stage1_agent: stage1,
      stage2_model: stage2,
      final_score: finalScore,
    },
  }
}

/** Deterministic tie-break: ascending (agent_id, model_id) — total order, replay-stable. */
function compareTieBreak(a: ScoredCandidate, b: ScoredCandidate): number {
  const byAgent = a.candidate.identity.agent_id.localeCompare(b.candidate.identity.agent_id)
  if (byAgent !== 0) return byAgent
  return a.candidate.identity.model_id.localeCompare(b.candidate.identity.model_id)
}

// Two-stage ordering: stage 1 (specialist agent skill coverage) dominates,
// then stage 2 (executor model effort/reasoning fit), then the tie-break.
function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.stage1 !== a.stage1) return b.stage1 - a.stage1
  if (b.stage2 !== a.stage2) return b.stage2 - a.stage2
  return compareTieBreak(a, b)
}

function tieBreakNeeded(scored: ScoredCandidate, all: ReadonlyArray<ScoredCandidate>): boolean {
  return all.some(
    (other) =>
      other !== scored && other.stage1 === scored.stage1 && other.stage2 === scored.stage2,
  )
}

export const TIE_BREAK_REASON = "deterministic tie-break: ascending (agent_id, model_id)"

export interface RankingResult {
  readonly ranking: ReadonlyArray<Decision.RankedCandidate>
  /** Non-null when the deterministic tie-break decided the order of at least one pair. */
  readonly tieBreak: string | null
}

/**
 * T018 — rank the authorized set deterministically. The signature accepts only
 * `AuthorizedCandidate` values, so a gated-out candidate is unrepresentable
 * here (hard gates authoritative). Ordering is two-stage (agent then model)
 * with a recorded deterministic tie-break.
 */
export function rankAuthorized(
  authorized: ReadonlyArray<AuthorizedCandidate>,
  criteria: RankingCriteria,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankingResult {
  const scored = authorized.map((candidate) => scoreCandidate(candidate, criteria, weights))
  const ordered = [...scored].sort(compareScored)
  let anyTieBreak = false

  const ranking = ordered.map((entry, index): Decision.RankedCandidate => {
    const tie_break_applied = tieBreakNeeded(entry, scored)
    if (tie_break_applied) anyTieBreak = true
    return {
      agent_id: entry.candidate.identity.agent_id,
      model_id: entry.candidate.identity.model_id,
      rank: index + 1,
      score_breakdown: entry.breakdown,
      tie_break_applied,
    }
  })

  return { ranking, tieBreak: anyTieBreak ? TIE_BREAK_REASON : null }
}

// =============================================================================
// T019 — Decision-model selection (authorized healthy pool, no recursion)
// =============================================================================

export interface BypassPolicy {
  /** Skip the decision model when fewer than this many candidates are authorized (nothing to decide). */
  readonly minCandidatesForModel: number
  /** Force-skip regardless of candidate count (e.g. strict deterministic mode). */
  readonly forceBypass: boolean
}

export const DEFAULT_BYPASS_POLICY: BypassPolicy = {
  minCandidatesForModel: 2,
  forceBypass: false,
}

export interface DecisionModelSelection {
  readonly decisionModelId: Decision.DecisionEvaluation["decision_model_id"]
  readonly decisionInputs: Decision.DecisionInputs | null
  readonly decisionOutput: Decision.DecisionOutput | null
  readonly bypassed: boolean
  readonly reason: string
}

function bypassed(reason: string): DecisionModelSelection {
  return { decisionModelId: null, decisionInputs: null, decisionOutput: null, bypassed: true, reason }
}

/** First decision-pool model id (in pool order) backed by an authorized, healthy candidate. */
function pickHealthyDecisionModel(
  authorized: ReadonlyArray<AuthorizedCandidate>,
  decisionPoolModelIds: ReadonlyArray<string>,
): string | null {
  const healthy = new Set(authorized.filter((c) => c.healthy).map((c) => c.identity.model_id))
  for (const modelId of decisionPoolModelIds) {
    if (healthy.has(modelId)) return modelId
  }
  return null
}

export interface DecisionModelInput {
  readonly authorized: ReadonlyArray<AuthorizedCandidate>
  readonly decisionPoolModelIds: ReadonlyArray<string>
  readonly inputs: Decision.DecisionInputs
  readonly classification: Pick<ClassificationResult, "taskClass" | "routingProfile">
  readonly bypass?: BypassPolicy
}

/**
 * T019 — select the decision model from the authorized healthy pool without
 * recursion. Skips the model (all fields null) when the bypass policy is met
 * or no healthy pool member is authorized. When a model is selected, records
 * structured `DecisionInputs`/`DecisionOutput` — never a raw prompt; the local
 * deterministic simulation echoes the classifier recommendation with a
 * confidence derived from the structured ambiguity signal.
 */
export function selectDecisionModel(input: DecisionModelInput): DecisionModelSelection {
  const policy = input.bypass ?? DEFAULT_BYPASS_POLICY
  if (policy.forceBypass) return bypassed("bypass_policy_forced")
  if (input.authorized.length < policy.minCandidatesForModel) return bypassed("bypass_single_candidate")

  const decisionModelId = pickHealthyDecisionModel(input.authorized, input.decisionPoolModelIds)
  if (decisionModelId === null) return bypassed("no_healthy_decision_model")

  const decisionOutput: Decision.DecisionOutput = {
    recommended_profile: input.classification.routingProfile,
    recommended_task_class: input.classification.taskClass,
    confidence: clampUnit(1 - input.inputs.risk.ambiguity),
    reason: "deterministic local decision-model simulation; no external model call",
  }
  return { decisionModelId, decisionInputs: input.inputs, decisionOutput, bypassed: false, reason: "decision_model_selected" }
}

// =============================================================================
// Combined candidate records for the persisted decision
// =============================================================================

function toCandidateRecord(
  gated: GatedCandidate,
  rank: number,
  finalScore: number,
): Decision.CandidateRecord {
  return {
    identity: gated.identity,
    profile: gated.profile,
    outcome: {
      gate_results: gated.gates,
      final_score: finalScore,
      rank,
      rejected: !gated.authorized,
      rejection_reasons: gated.rejectionReasons,
    },
  }
}

function identityKey(identity: Decision.CandidateIdentity): string {
  return `${identity.agent_id} ${identity.model_id}`
}

/**
 * Project the gate evaluation plus ranking into the immutable
 * `Decision.CandidateRecord[]` persisted in the decision: authorized
 * candidates carry their ranked position and score; rejected candidates keep
 * their rejection reasons and are ordered after the authorized set (rank is a
 * positive int, so a stable post-authorized ordinal is assigned).
 */
export function toCandidateRecords(
  evaluation: HardGateEvaluation,
  ranking: ReadonlyArray<Decision.RankedCandidate>,
): ReadonlyArray<Decision.CandidateRecord> {
  const rankByKey = new Map<string, Decision.RankedCandidate>()
  for (const ranked of ranking) rankByKey.set(identityKey({ agent_id: ranked.agent_id, model_id: ranked.model_id }), ranked)

  const records: Decision.CandidateRecord[] = []
  let rejectedRank = ranking.length

  for (const gated of evaluation.evaluated) {
    if (gated.authorized) {
      const ranked = rankByKey.get(identityKey(gated.identity))
      const finalScore = ranked?.score_breakdown.final_score ?? 0
      records.push(toCandidateRecord(gated, ranked?.rank ?? ranking.length + 1, finalScore))
    } else {
      rejectedRank += 1
      records.push(toCandidateRecord(gated, rejectedRank, 0))
    }
  }
  return records
}

// =============================================================================
// T017-T019 combined pipeline pass
// =============================================================================

export interface EvaluationRequest {
  readonly candidates: ReadonlyArray<EvaluationCandidate>
  readonly requirements: DimensionRequirements
  readonly unknownPolicy: RoutingConfig.UnknownPolicy
  readonly now: string
  readonly ranking: RankingCriteria
  readonly classification: Pick<ClassificationResult, "taskClass" | "routingProfile">
  readonly inputs: Decision.DecisionInputs
  readonly decisionPoolModelIds: ReadonlyArray<string>
  readonly weights?: RankingWeights
  readonly bypass?: BypassPolicy
  readonly precedence?: ReadonlyArray<Capability.Source>
}

export interface EvaluationResult {
  readonly gates: HardGateEvaluation
  readonly decisionModel: DecisionModelSelection
  readonly ranking: ReadonlyArray<Decision.RankedCandidate>
  readonly candidates: ReadonlyArray<Decision.CandidateRecord>
  readonly tieBreak: string | null
}

/**
 * Run the deterministic pipeline pass in canonical order (hard gates ->
 * decision model -> ranking), returning every artifact the persisted decision
 * needs. Ranking and decision-model selection operate on the authorized set
 * only; the fallback stage (`planFallback`) is a separate post-execution step.
 */
export function runEvaluation(request: EvaluationRequest): EvaluationResult {
  const gates = evaluateHardGates(
    request.candidates,
    request.requirements,
    request.unknownPolicy,
    request.now,
    request.precedence,
  )
  const decisionModel = selectDecisionModel({
    authorized: gates.authorized,
    decisionPoolModelIds: request.decisionPoolModelIds,
    inputs: request.inputs,
    classification: request.classification,
    bypass: request.bypass,
  })
  const { ranking, tieBreak } = rankAuthorized(gates.authorized, request.ranking, request.weights)
  const candidates = toCandidateRecords(gates, ranking)
  return { gates, decisionModel, ranking, candidates, tieBreak }
}

// =============================================================================
// T021 — Fallback and execution-boundary classification
// =============================================================================

/** A candidate execution failure to classify into an execution boundary. */
export interface ExecutionFailure {
  readonly failedCandidate: Decision.CandidateIdentity
  /** Whether the candidate performed a mutation / external side-effect before failing. */
  readonly mutationPerformed: boolean
  /** Whether the failure class is transient / safe to retry (network, timeout, empty response). */
  readonly retryable: boolean
}

/**
 * Classify an execution failure into an `Enums.ExecutionBoundary`:
 *   - mutation_risky: a mutation/side-effect already ran — a blind retry could
 *     duplicate it, so this is terminal.
 *   - retryable: no mutation and a transient failure class — safe to retry a
 *     different authorized candidate.
 *   - safe: no mutation and a deterministic (non-retryable) failure — surface
 *     without retry.
 */
export function classifyExecutionBoundary(failure: ExecutionFailure): Enums.ExecutionBoundary {
  if (failure.mutationPerformed) return "mutation_risky"
  if (failure.retryable) return "retryable"
  return "safe"
}

/** Domain fallback error; `no_authorized_candidate` mirrors the protocol RoutingError variant. */
export type FallbackError =
  | { readonly type: "mutation_risky"; readonly reason: string; readonly candidate: Decision.CandidateIdentity }
  | { readonly type: "no_authorized_candidate"; readonly reason: string }

export interface FallbackPlan {
  readonly boundary: Enums.ExecutionBoundary
  /** True only when a retry candidate was actually selected. */
  readonly fallbackAttempted: boolean
  /** The authorized compatible candidate to retry, or null when none/ineligible. */
  readonly retryCandidate: AuthorizedCandidate | null
  readonly error: FallbackError | null
  readonly reason: string
}

function sameIdentity(a: Decision.CandidateIdentity, b: Decision.CandidateIdentity): boolean {
  return a.agent_id === b.agent_id && a.model_id === b.model_id
}

/**
 * Pick the next authorized compatible retry candidate: authorized (guaranteed
 * capability-compatible), never the just-failed one (no blind repeat), first in
 * the supplied order for determinism. An optional predicate narrows
 * compatibility further.
 */
function pickRetryCandidate(
  failed: Decision.CandidateIdentity,
  authorized: ReadonlyArray<AuthorizedCandidate>,
  compatible?: (candidate: AuthorizedCandidate) => boolean,
): AuthorizedCandidate | null {
  for (const candidate of authorized) {
    if (sameIdentity(candidate.identity, failed)) continue
    if (compatible && !compatible(candidate)) continue
    return candidate
  }
  return null
}

/**
 * T021 — plan the fallback for a classified execution failure over the
 * authorized set:
 *   - mutation_risky: NEVER retry; emit an explicit mutation_risky error.
 *   - retryable: retry the first authorized compatible candidate other than
 *     the failed one; if none remain, emit an explicit no_authorized_candidate
 *     error.
 *   - safe: no retry needed, no error.
 *
 * `authorized` MUST be the branded authorized set from `evaluateHardGates`, so
 * a gated-out candidate can never be chosen for a retry.
 */
export function planFallback(
  failure: ExecutionFailure,
  authorized: ReadonlyArray<AuthorizedCandidate>,
  compatible?: (candidate: AuthorizedCandidate) => boolean,
): FallbackPlan {
  const boundary = classifyExecutionBoundary(failure)

  if (boundary === "mutation_risky") {
    return {
      boundary,
      fallbackAttempted: false,
      retryCandidate: null,
      error: {
        type: "mutation_risky",
        reason: "execution boundary is mutation_risky; a blind retry could duplicate a side-effect",
        candidate: failure.failedCandidate,
      },
      reason: "mutation_risky_no_retry",
    }
  }

  if (boundary === "safe") {
    return { boundary, fallbackAttempted: false, retryCandidate: null, error: null, reason: "safe_no_retry" }
  }

  const retryCandidate = pickRetryCandidate(failure.failedCandidate, authorized, compatible)
  if (retryCandidate === null) {
    return {
      boundary,
      fallbackAttempted: true,
      retryCandidate: null,
      error: { type: "no_authorized_candidate", reason: "no authorized compatible candidate remains for retry" },
      reason: "retryable_exhausted",
    }
  }

  return { boundary, fallbackAttempted: true, retryCandidate, error: null, reason: "retryable_fallback" }
}

/**
 * Map a domain `FallbackError` onto the protocol RoutingError tagged union
 * (packages/protocol/src/routing). `no_authorized_candidate` maps 1:1;
 * `mutation_risky` has no dedicated wire variant and is surfaced as
 * `unavailable` with a descriptive reason.
 */
export function toRoutingError(error: FallbackError): RoutingError {
  switch (error.type) {
    case "no_authorized_candidate":
      return { type: "no_authorized_candidate", reason: error.reason }
    case "mutation_risky":
      return {
        type: "unavailable",
        reason: `mutation_risky: ${error.reason} (agent=${error.candidate.agent_id} model=${error.candidate.model_id})`,
      }
  }
}
