export * as Decision from "./decision"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"
import { Budget } from "./budget"
import { Capability } from "./capability"
import { Enums } from "./enums"
import { Ids } from "./ids"

// Mirrors doc/arch/schemas/routing/decision.cue, decision-parts.cue,
// candidate.cue, ranking.cue and decision-inputs.cue.
//
// Enum literals (TaskClass, RoutingProfile, TaskEffort, ReasoningEffort,
// ExecutionBoundary) are canonically defined in ./enums (mirrors enums.cue)
// and imported directly here rather than through ./config — this decision
// aggregate has no business depending on routing policy configuration, and
// ./config itself re-exports the same ./enums bindings unchanged.
//
// BudgetPolicySnapshot / BudgetConsumption (decision-parts.cue's
// #DecisionAccounting.budget / budget_consumed) are reused from ./budget
// (mirrors budget.cue and budget-consumption.cue). ToolCapabilityValue
// (candidate.cue's #GateResult.candidate_value) is reused from ./capability
// (mirrors capability.cue).

const NonNegativeFloat = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.0))
const UnitInterval = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0.0), Schema.isLessThanOrEqualTo(1.0))

// --- Plain named booleans (candidate.cue / ranking.cue / decision-parts.cue) ---

export const GatePassed = Schema.Boolean.annotate({ identifier: "RoutingDecision.GatePassed" })
export type GatePassed = typeof GatePassed.Type

export const CandidateRejected = Schema.Boolean.annotate({ identifier: "RoutingDecision.CandidateRejected" })
export type CandidateRejected = typeof CandidateRejected.Type

export const TieBreakApplied = Schema.Boolean.annotate({ identifier: "RoutingDecision.TieBreakApplied" })
export type TieBreakApplied = typeof TieBreakApplied.Type

export const HardGatesAuthoritative = Schema.Boolean.annotate({
  identifier: "RoutingDecision.HardGatesAuthoritative",
})
export type HardGatesAuthoritative = typeof HardGatesAuthoritative.Type

export const FallbackAttempted = Schema.Boolean.annotate({ identifier: "RoutingDecision.FallbackAttempted" })
export type FallbackAttempted = typeof FallbackAttempted.Type

// Offline flags that remote metrics were unavailable at decision time.
export const Offline = Schema.Boolean.annotate({ identifier: "RoutingDecision.Offline" })
export type Offline = typeof Offline.Type

// --- candidate.cue: hard-gate results and evaluated candidate records ---

export interface GateResult extends Schema.Schema.Type<typeof GateResult> {}
export const GateResult = Schema.Struct({
  dimension: Ids.CapabilityDimension, // e.g. "tool_call_present"
  passed: GatePassed,
  reason: Ids.Reason,
  requirement: Ids.Requirement, // what the task required
  candidate_value: Capability.ToolCapabilityValue, // what the candidate provided
  scope: Ids.Scope, // provider/model/variant/API
}).annotate({ identifier: "RoutingDecision.GateResult" })

export const GateList = Schema.Array(GateResult).annotate({ identifier: "RoutingDecision.GateList" })
export type GateList = typeof GateList.Type

export const SkillList = Schema.Array(Ids.SkillName).annotate({ identifier: "RoutingDecision.SkillList" })
export type SkillList = typeof SkillList.Type

export const RejectionReasons = Schema.Array(Ids.Reason).annotate({
  identifier: "RoutingDecision.RejectionReasons",
})
export type RejectionReasons = typeof RejectionReasons.Type

export interface CandidateIdentity extends Schema.Schema.Type<typeof CandidateIdentity> {}
export const CandidateIdentity = Schema.Struct({
  agent_id: Ids.AgentId,
  model_id: Ids.ModelId,
}).annotate({ identifier: "RoutingDecision.CandidateIdentity" })

export interface CandidateProfile extends Schema.Schema.Type<typeof CandidateProfile> {}
export const CandidateProfile = Schema.Struct({
  skills: SkillList,
  effort: Enums.TaskEffort,
  reasoning_effort: Enums.ReasoningEffort,
}).annotate({ identifier: "RoutingDecision.CandidateProfile" })

export interface CandidateOutcome extends Schema.Schema.Type<typeof CandidateOutcome> {}
export const CandidateOutcome = Schema.Struct({
  gate_results: GateList,
  final_score: NonNegativeFloat,
  rank: PositiveInt,
  rejected: CandidateRejected,
  rejection_reasons: RejectionReasons,
}).annotate({ identifier: "RoutingDecision.CandidateOutcome" })

export interface CandidateRecord extends Schema.Schema.Type<typeof CandidateRecord> {}
export const CandidateRecord = Schema.Struct({
  identity: CandidateIdentity,
  profile: CandidateProfile,
  outcome: CandidateOutcome,
}).annotate({ identifier: "RoutingDecision.CandidateRecord" })

export const CandidateList = Schema.Array(CandidateRecord).annotate({
  identifier: "RoutingDecision.CandidateList",
})
export type CandidateList = typeof CandidateList.Type

// --- ranking.cue: ranked candidates and the authorization snapshot ---

export interface RankedCandidate extends Schema.Schema.Type<typeof RankedCandidate> {}
export const RankedCandidate = Schema.Struct({
  agent_id: Ids.AgentId,
  model_id: Ids.ModelId,
  rank: PositiveInt,
  score_breakdown: Schema.Record(Schema.String, NonNegativeFloat),
  tie_break_applied: TieBreakApplied,
}).annotate({ identifier: "RoutingDecision.RankedCandidate" })

export const RankingList = Schema.Array(RankedCandidate).annotate({ identifier: "RoutingDecision.RankingList" })
export type RankingList = typeof RankingList.Type

export interface AuthContextSnapshot extends Schema.Schema.Type<typeof AuthContextSnapshot> {}
export const AuthContextSnapshot = Schema.Struct({
  permission_mode: Ids.PermissionMode,
  policy_version: Ids.PolicyVersion,
  hard_gates_authoritative: HardGatesAuthoritative,
}).annotate({ identifier: "RoutingDecision.AuthContextSnapshot" })

// --- decision-inputs.cue: structured decision-model inputs and outputs ---
// No raw prompts or model text — structured/typed signals only.

export const ExpectedTools = Schema.Array(Ids.SkillName).annotate({ identifier: "RoutingDecision.ExpectedTools" })
export type ExpectedTools = typeof ExpectedTools.Type

export interface InputStructure extends Schema.Schema.Type<typeof InputStructure> {}
export const InputStructure = Schema.Struct({
  domain_count: NonNegativeInt,
  independent_units: NonNegativeInt,
  context_size: NonNegativeInt,
}).annotate({ identifier: "RoutingDecision.InputStructure" })

export interface InputRisk extends Schema.Schema.Type<typeof InputRisk> {}
export const InputRisk = Schema.Struct({
  mutation_risk: UnitInterval,
  ambiguity: UnitInterval,
  security_migration: UnitInterval,
  external_effects: UnitInterval,
}).annotate({ identifier: "RoutingDecision.InputRisk" })

export interface InputConcurrency extends Schema.Schema.Type<typeof InputConcurrency> {}
export const InputConcurrency = Schema.Struct({
  expected_tools: ExpectedTools,
  parallelism: UnitInterval,
}).annotate({ identifier: "RoutingDecision.InputConcurrency" })

export interface DecisionInputs extends Schema.Schema.Type<typeof DecisionInputs> {}
export const DecisionInputs = Schema.Struct({
  structure: InputStructure,
  risk: InputRisk,
  concurrency: InputConcurrency,
}).annotate({ identifier: "RoutingDecision.DecisionInputs" })

export interface DecisionOutput extends Schema.Schema.Type<typeof DecisionOutput> {}
export const DecisionOutput = Schema.Struct({
  recommended_profile: Enums.RoutingProfile,
  recommended_task_class: Enums.TaskClass,
  confidence: UnitInterval,
  reason: Ids.Reason,
}).annotate({ identifier: "RoutingDecision.DecisionOutput" })

// --- decision-parts.cue: cohesive sub-objects composed by the aggregate root ---

export interface DecisionContext extends Schema.Schema.Type<typeof DecisionContext> {}
export const DecisionContext = Schema.Struct({
  // Schema version for replay compatibility against schema changes.
  version: Ids.Version,
  session_id: Ids.SessionId,
  turn_id: Ids.TurnId,
  // Deterministic hash of task inputs — used for cache/replay deduplication.
  task_fingerprint: Ids.Fingerprint,
}).annotate({ identifier: "RoutingDecision.DecisionContext" })

export interface DecisionClassification extends Schema.Schema.Type<typeof DecisionClassification> {}
export const DecisionClassification = Schema.Struct({
  task_class: Enums.TaskClass,
  routing_profile: Enums.RoutingProfile,
  task_effort: Enums.TaskEffort,
  reasoning_effort: Enums.ReasoningEffort,
}).annotate({ identifier: "RoutingDecision.DecisionClassification" })

export interface DecisionSelection extends Schema.Schema.Type<typeof DecisionSelection> {}
export const DecisionSelection = Schema.Struct({
  specialist_agent: Ids.AgentId,
  executor_model: Ids.ModelId,
  selected_skills: SkillList,
  provider_variant: Ids.VariantName,
}).annotate({ identifier: "RoutingDecision.DecisionSelection" })

export interface DecisionEvaluation extends Schema.Schema.Type<typeof DecisionEvaluation> {}
export const DecisionEvaluation = Schema.Struct({
  // Hard gates per candidate x dimension.
  gates: GateList,
  // Ranked candidate list after deterministic scoring + tie-break.
  candidates: CandidateList,
  ranking: RankingList,
  tie_break: Schema.NullOr(Ids.Reason),
  // Decision model invocation (null if decision model was not required).
  decision_model_id: Schema.NullOr(Ids.ModelId),
  decision_inputs: Schema.NullOr(DecisionInputs),
  decision_output: Schema.NullOr(DecisionOutput),
}).annotate({ identifier: "RoutingDecision.DecisionEvaluation" })

export interface DecisionAccounting extends Schema.Schema.Type<typeof DecisionAccounting> {}
export const DecisionAccounting = Schema.Struct({
  // Budget at decision time and consumption observed so far.
  budget: Budget.PolicySnapshot,
  budget_consumed: Budget.Consumption,
  // Catalog/policy versions at decision time for replay validation.
  catalog_version: Ids.CatalogVersion,
  policy_version: Ids.PolicyVersion,
  // Authorization context snapshot.
  auth_context: AuthContextSnapshot,
}).annotate({ identifier: "RoutingDecision.DecisionAccounting" })

export const FallbackCandidates = Schema.Array(Ids.AgentId).annotate({
  identifier: "RoutingDecision.FallbackCandidates",
})
export type FallbackCandidates = typeof FallbackCandidates.Type

export interface DecisionLifecycle extends Schema.Schema.Type<typeof DecisionLifecycle> {}
export const DecisionLifecycle = Schema.Struct({
  // Execution boundary classification from fallback analysis.
  execution_boundary: Enums.ExecutionBoundary,
  // Fallback state.
  fallback_attempted: FallbackAttempted,
  fallback_reason: Schema.NullOr(Ids.Reason),
  fallback_candidates: Schema.NullOr(FallbackCandidates),
  // Metadata.
  created_at: Ids.Timestamp, // ISO 8601
  decision_latency_ms: NonNegativeInt,
  offline: Offline, // true when remote metrics were unavailable
}).annotate({ identifier: "RoutingDecision.DecisionLifecycle" })

// --- decision.cue: RoutingDecision — immutable decision record persisted
// after every routing evaluation. ---

export interface RoutingDecision extends Schema.Schema.Type<typeof RoutingDecision> {}
export const RoutingDecision = Schema.Struct({
  // ULID — sort order encodes creation time; the aggregate identity.
  id: Ids.DecisionId,
  // Correlation and replay context (version, session, turn, fingerprint).
  context: DecisionContext,
  // Task classification outcome.
  classification: DecisionClassification,
  // Two-stage pipeline result (specialist agent, executor model, skills).
  selection: DecisionSelection,
  // Hard gates, candidates, ranking and decision-model invocation.
  evaluation: DecisionEvaluation,
  // Budget, versions and authorization context at decision time.
  accounting: DecisionAccounting,
  // Execution boundary, fallback state and timing metadata.
  lifecycle: DecisionLifecycle,
}).annotate({ identifier: "RoutingDecision.RoutingDecision" })
