/**
 * Feature 001 / T026 — Routing application service (RoutingPort).
 *
 * The composition seam that turns the pure routing domain into the inbound
 * RoutingPort (evaluate / explain / test / capabilityInspect / status). It
 * orchestrates, in the canonical pipeline order
 * (hierarchy-flow.md "Routing Decision Pipeline"):
 *
 *   analyze (structured signals) -> classify (task_class + routing_profile)
 *   -> resolve candidates (Catalog.Service, no hardcoded ids)
 *   -> evaluateHardGates -> selectDecisionModel -> rankAuthorized
 *   -> budget snapshot -> buildRoutingDecision -> commit (atomic, idempotent)
 *
 * Every dependency is an injected outbound port (ports.ts): config, candidate
 * source, task analyzer, decision store, optional telemetry, clock. The domain
 * modules stay framework-free; this service adds only the Effect wiring, the
 * error mapping onto the protocol RoutingError union, and the non-blocking
 * telemetry hand-off. Zero LLM calls: the decision model is a deterministic
 * local simulation and `test` force-bypasses it entirely.
 */
export * as RoutingService from "./routing-service"

import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type {
  ExplainResponse,
  TestResponse,
  StatusResponse,
  CapabilityInspectResponse,
  GateExplain,
  CandidateExplain,
  RoutingError,
} from "@opencode-ai/protocol/routing/index"
import { classify } from "../domain/classifier"
import {
  runEvaluation,
  planFallback,
  DEFAULT_BYPASS_POLICY,
  type EvaluationResult,
  type AuthorizedCandidate,
  type ExecutionFailure,
  type FallbackPlan,
} from "../domain/routing-evaluator"
import { buildRoutingDecision } from "../domain/routing-decision"
import { evaluateBudget } from "../domain/budget-policy"
import type {
  RoutingPort,
  RoutingConfigSource,
  CandidateSource,
  CandidateResolution,
  TaskAnalyzer,
  TaskAnalysis,
  DecisionStore,
  RoutingTelemetry,
} from "./ports"

// =============================================================================
// Deps + defaults
// =============================================================================

export interface RoutingServiceDeps {
  readonly config: RoutingConfigSource
  readonly candidates: CandidateSource
  readonly analyzer: TaskAnalyzer
  readonly decisions: DecisionStore
  readonly telemetry?: RoutingTelemetry
  /** Monotonic millisecond clock for decision latency (default Date.now). */
  readonly clock?: () => number
  /** ISO 8601 instant source (default new Date().toISOString()). */
  readonly nowIso?: () => string
  /** DecisionId (ULID) generator (default a local ULID). */
  readonly newId?: () => string
  /** Active permission mode recorded in the auth-context snapshot (default "default"). */
  readonly permissionMode?: string
}

// Crockford base32 ULID — 48-bit ms timestamp + 80-bit randomness, 26 chars.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function ulid(nowMs: number): string {
  let ts = Math.max(0, Math.floor(nowMs))
  let time = ""
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[ts % 32] + time
    ts = Math.floor(ts / 32)
  }
  let rand = ""
  for (let i = 0; i < 16; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)]
  return time + rand
}

const ZERO_CONSUMPTION: Budget.Consumption = {
  throughput: { turns_used: 0, context_tokens_used: 0, output_tokens_used: 0 },
  concurrency: { workers_requested: 0, workers_granted: 0, delegation_depth_used: 0 },
  retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
  cost: { time_ms_used: 0, cost_usd_used: 0 },
  resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
}

// =============================================================================
// Pure projections (domain record -> protocol wire shapes)
// =============================================================================

function scalarString(value: Decision.GateResult["candidate_value"]): string {
  return value === null ? "null" : String(value)
}

function toGateExplain(gate: Decision.GateResult): GateExplain {
  return {
    dimension: gate.dimension,
    passed: gate.passed,
    reason: gate.reason,
    requirement: gate.requirement,
    candidateValue: scalarString(gate.candidate_value),
  }
}

function toCandidateExplain(record: Decision.CandidateRecord): CandidateExplain {
  return {
    agentId: record.identity.agent_id,
    modelId: record.identity.model_id,
    passed: !record.outcome.rejected,
    score: record.outcome.final_score,
    rank: record.outcome.rank,
    rejectionReasons: record.outcome.rejection_reasons,
  }
}

function profileToRole(profile: Enums.RoutingProfile): Enums.HierarchyRole {
  return profile === "manager" ? "manager" : "worker"
}

/** Flatten the decision-model pool (role-pool ids) into concrete model ids, in pool order. */
export function resolveDecisionModelPool(config: RoutingConfig.Info): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const roleId of config.models.decision_model.pool) {
    for (const modelId of config.models.role_pools[roleId] ?? []) {
      if (!seen.has(modelId)) {
        seen.add(modelId)
        out.push(modelId)
      }
    }
  }
  return out
}

// =============================================================================
// Fallback composition helper (post-execution; exported for the executor layer)
// =============================================================================

/**
 * Compose the domain fallback state machine over the branded authorized set of
 * a prior evaluation: classify the execution boundary and pick the next
 * authorized compatible retry candidate, never blind-repeating a mutation-risky
 * one. The RoutingPort surface itself is pre-execution; the executor layer
 * calls this with the recorded failure to drive retries.
 */
export function planRoutingFallback(
  failure: ExecutionFailure,
  authorized: ReadonlyArray<AuthorizedCandidate>,
): FallbackPlan {
  return planFallback(failure, authorized)
}

// =============================================================================
// Service
// =============================================================================

interface PipelineResult {
  readonly config: RoutingConfig.Info
  readonly policyVersion: string
  readonly analysis: TaskAnalysis
  readonly classification: ReturnType<typeof classify>
  readonly resolution: CandidateResolution
  readonly evaluation: EvaluationResult
}

export function createRoutingService(deps: RoutingServiceDeps): RoutingPort {
  const clock = deps.clock ?? Date.now
  const nowIso = deps.nowIso ?? (() => new Date().toISOString())
  const newId = deps.newId ?? (() => ulid(clock()))
  const permissionMode = deps.permissionMode ?? "default"

  // Shared deterministic pipeline used by evaluate + test. `forceDecisionBypass`
  // makes `test` provably free of even the local decision-model simulation.
  function runPipeline(
    taskDescription: string,
    scope: Budget.Scope,
    forceDecisionBypass: boolean,
  ): Effect.Effect<PipelineResult, RoutingError> {
    return Effect.gen(function* () {
      const resolved = yield* Effect.tryPromise({
        try: () => deps.config.resolve(),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `routing config unavailable: ${String(cause)}` }),
      })
      const config = resolved.config
      const analysis = deps.analyzer.analyze({ taskDescription, scope })
      const classification = classify(analysis.inputs)

      const resolution = yield* Effect.tryPromise({
        try: () =>
          deps.candidates.resolve({
            routingProfile: classification.routingProfile,
            taskClass: classification.taskClass,
            config,
            scope,
          }),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `candidate resolution failed: ${String(cause)}` }),
      })

      const evaluation = runEvaluation({
        candidates: resolution.candidates,
        requirements: analysis.requirements,
        unknownPolicy: config.enforcement.capability.unknown_policy,
        now: nowIso(),
        ranking: analysis.ranking,
        classification: { taskClass: classification.taskClass, routingProfile: classification.routingProfile },
        inputs: analysis.inputs,
        decisionPoolModelIds: resolution.decisionPoolModelIds,
        bypass: forceDecisionBypass
          ? { minCandidatesForModel: DEFAULT_BYPASS_POLICY.minCandidatesForModel, forceBypass: true }
          : undefined,
      })

      return { config, policyVersion: resolved.policyVersion, analysis, classification, resolution, evaluation }
    })
  }

  function emit(decision: Decision.RoutingDecision, authorizedCount: number): void {
    if (!deps.telemetry) return
    try {
      deps.telemetry.recordDecision({
        decisionId: decision.id,
        taskClass: decision.classification.task_class,
        routingProfile: decision.classification.routing_profile,
        authorizedCount,
        decisionModelCalled: decision.evaluation.decision_model_id !== null,
        latencyMs: decision.lifecycle.decision_latency_ms,
        offline: decision.lifecycle.offline,
      })
    } catch {
      /* telemetry never blocks or breaks the hot path */
    }
  }

  const evaluate: RoutingPort["evaluate"] = (input) =>
    Effect.gen(function* () {
      const start = clock()
      const pipeline = yield* runPipeline(input.taskDescription, input.scope, false)
      const { config, policyVersion, analysis, classification, evaluation, resolution } = pipeline

      const authorized = evaluation.gates.authorized
      if (authorized.length === 0) {
        return yield* Effect.fail<RoutingError>({
          type: "no_authorized_candidate",
          reason: "no candidate passed the hard capability gates",
        })
      }

      const winner = evaluation.ranking[0]
      const winnerCandidate = authorized.find(
        (c) => c.identity.agent_id === winner.agent_id && c.identity.model_id === winner.model_id,
      )
      if (!winnerCandidate) {
        return yield* Effect.fail<RoutingError>({
          type: "unavailable",
          reason: "top-ranked candidate is not in the authorized set",
        })
      }

      const selectedSkills = analysis.ranking.requiredSkills.filter((s) => winnerCandidate.profile.skills.includes(s))
      // Non-critical: the offline flag falls back to `true` if the catalog
      // status is unreachable — a status hiccup never aborts a committed decision.
      const status = yield* Effect.promise(() =>
        deps.candidates.status().catch(() => ({ offline: true }) as { offline: boolean }),
      )

      const budgetSnapshot: Budget.PolicySnapshot = {
        policy: config.enforcement.budget,
        applied_at: nowIso(),
        scope: input.scope,
        routing_profile: classification.routingProfile,
        task_class: classification.taskClass,
        role: profileToRole(classification.routingProfile),
      }

      // Pre-execution admission over zero consumption — surfaces a
      // mis-specified policy as an explicit error rather than a silent pass.
      const budget = evaluateBudget(config.enforcement.budget, ZERO_CONSUMPTION)
      if (budget.outcome === "error") {
        return yield* Effect.fail<RoutingError>({
          type: "unavailable",
          reason: `budget policy could not be evaluated: ${budget.violations[0]?.reason ?? "non-finite limit"}`,
        })
      }

      const decision = buildRoutingDecision({
        id: newId(),
        context: {
          version: 1,
          session_id: input.sessionId,
          turn_id: input.turnId,
          task_fingerprint: input.taskFingerprint,
        },
        classification: {
          task_class: classification.taskClass,
          routing_profile: classification.routingProfile,
          task_effort: analysis.ranking.desiredEffort,
          reasoning_effort: analysis.ranking.desiredReasoning,
        },
        selection: {
          specialist_agent: winnerCandidate.identity.agent_id,
          executor_model: winnerCandidate.identity.model_id,
          selected_skills: selectedSkills,
          provider_variant: winnerCandidate.record.identity.variant,
        },
        evaluation: {
          gates: evaluation.candidates.flatMap((c) => c.outcome.gate_results),
          candidates: evaluation.candidates,
          ranking: evaluation.ranking,
          tie_break: evaluation.tieBreak,
          decision_model_id: evaluation.decisionModel.decisionModelId,
          decision_inputs: evaluation.decisionModel.decisionInputs,
          decision_output: evaluation.decisionModel.decisionOutput,
        },
        accounting: {
          budget: budgetSnapshot,
          budget_consumed: ZERO_CONSUMPTION,
          catalog_version: resolution.catalogVersion,
          policy_version: policyVersion,
          auth_context: {
            permission_mode: permissionMode,
            policy_version: policyVersion,
            hard_gates_authoritative: true,
          },
        },
        lifecycle: {
          execution_boundary: "safe",
          fallback_attempted: false,
          fallback_reason: null,
          fallback_candidates: null,
          created_at: nowIso(),
          decision_latency_ms: Math.max(0, clock() - start),
          offline: status.offline,
        },
      })

      const committed = yield* Effect.tryPromise({
        try: () => deps.decisions.commit(decision),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `decision commit failed: ${String(cause)}` }),
      })

      emit(committed, authorized.length)
      return committed
    })

  const explain: RoutingPort["explain"] = (decisionId) =>
    Effect.gen(function* () {
      const decision = yield* Effect.tryPromise({
        try: () => deps.decisions.findById(decisionId),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `decision lookup failed: ${String(cause)}` }),
      })
      if (!decision) {
        return yield* Effect.fail<RoutingError>({
          type: "invalid_argument",
          field: "decisionId",
          reason: `no persisted decision for id '${decisionId}'`,
        })
      }
      const response: ExplainResponse = {
        decisionId: decision.id,
        taskClass: decision.classification.task_class,
        routingProfile: decision.classification.routing_profile,
        gates: decision.evaluation.gates.map(toGateExplain),
        candidates: decision.evaluation.candidates.map(toCandidateExplain),
        scoreBreakdown: decision.evaluation.ranking[0]?.score_breakdown ?? {},
        decisionModelCalled: decision.evaluation.decision_model_id !== null,
        selectedAgent: decision.selection.specialist_agent,
        selectedModel: decision.selection.executor_model,
        fallbackAttempted: decision.lifecycle.fallback_attempted,
        fallbackReason: decision.lifecycle.fallback_reason,
        confidence: decision.evaluation.decision_output?.confidence ?? 1,
        redacted: true,
      }
      return response
    })

  const test: RoutingPort["test"] = (input) =>
    Effect.gen(function* () {
      const { config, classification, evaluation } = yield* runPipeline(input.taskDescription, input.scope, true)
      const authorizedCandidates = evaluation.candidates.filter((c) => !c.outcome.rejected).map(toCandidateExplain)
      const hardGateSummary = evaluation.gates.evaluated.flatMap((e) => e.gates.map(toGateExplain))
      const response: TestResponse = {
        taskClass: classification.taskClass,
        routingProfile: classification.routingProfile,
        authorizedCandidates,
        hardGateSummary,
        budgetPolicy: config.enforcement.budget,
        noExternalModelCall: true,
        redacted: true,
      }
      return response
    })

  const capabilityInspect: RoutingPort["capabilityInspect"] = (modelId) =>
    Effect.gen(function* () {
      const records = yield* Effect.tryPromise({
        try: () => deps.candidates.inspect(modelId),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `capability inspect failed: ${String(cause)}` }),
      })
      const response: CapabilityInspectResponse = { records: [...records], redacted: true }
      return response
    })

  const status: RoutingPort["status"] = () =>
    Effect.gen(function* () {
      const resolved = yield* Effect.tryPromise({
        try: () => deps.config.resolve(),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `routing config unavailable: ${String(cause)}` }),
      })
      const sourceStatus = yield* Effect.tryPromise({
        try: () => deps.candidates.status(),
        catch: (cause): RoutingError => ({ type: "unavailable", reason: `catalog status unavailable: ${String(cause)}` }),
      })
      const config = resolved.config
      const response: StatusResponse = {
        enabled: config.activation.enabled,
        mode: config.activation.mode,
        strictGates: config.activation.strict_gates,
        decisionModelPool: resolveDecisionModelPool(config),
        rolePools: { ...config.models.role_pools },
        catalogVersion: sourceStatus.catalogVersion,
        policyVersion: resolved.policyVersion,
        health: sourceStatus.health,
        reason: sourceStatus.reason,
        recommendedAction: sourceStatus.recommendedAction,
        offline: sourceStatus.offline,
      }
      return response
    })

  return { evaluate, explain, test, capabilityInspect, status }
}
