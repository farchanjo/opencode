export * as Budget from "./budget"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"
import { HierarchyRole, RoutingProfile, TaskClass } from "./enums"
import { Ids } from "./ids"

// EscalationThreshold (descriptors.cue #EscalationThreshold) and Timestamp
// (versions.cue #Timestamp) are owned by routing/ids.ts; re-exported here under
// the member names this module's structs use so they are no longer duplicated.
export const EscalationThreshold = Ids.EscalationThreshold
export type EscalationThreshold = typeof EscalationThreshold.Type

export const Timestamp = Ids.Timestamp
export type Timestamp = typeof Timestamp.Type

const NonNegativeFloat = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

// DelegationDepth bounds Architect -> Manager -> Worker fanout depth (ADR-0002).
const DelegationDepth = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 }))

// BudgetLimits caps turn, context and output size.
export interface Limits extends Schema.Schema.Type<typeof Limits> {}
export const Limits = Schema.Struct({
  max_turns: PositiveInt,
  max_context_tokens: PositiveInt,
  max_context_bytes: PositiveInt,
  max_output_tokens: PositiveInt,
  max_output_bytes: PositiveInt,
}).annotate({ identifier: "Budget.Limits" })

// BudgetConcurrency caps fanout and delegation depth.
export interface Concurrency extends Schema.Schema.Type<typeof Concurrency> {}
export const Concurrency = Schema.Struct({
  max_workers: PositiveInt,
  max_delegation_depth: DelegationDepth,
}).annotate({ identifier: "Budget.Concurrency" })

// BudgetRetrieval caps retrieval and skill-context expansion.
export interface Retrieval extends Schema.Schema.Type<typeof Retrieval> {}
export const Retrieval = Schema.Struct({
  retrieval_top_k: NonNegativeInt,
  rerank_top_k: NonNegativeInt,
  max_skill_chunks: PositiveInt,
  max_skill_tokens: PositiveInt,
}).annotate({ identifier: "Budget.Retrieval" })

// BudgetCost caps wall-clock, monetary and token spend.
export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  time_budget_ms: PositiveInt,
  cost_budget_usd: NonNegativeFloat,
  token_budget: PositiveInt,
}).annotate({ identifier: "Budget.Cost" })

// BudgetResilience caps retry and validation depth and names the escalation signal.
export interface Resilience extends Schema.Schema.Type<typeof Resilience> {}
export const Resilience = Schema.Struct({
  retry_depth: NonNegativeInt,
  validation_depth: NonNegativeInt,
  escalation_threshold: EscalationThreshold,
}).annotate({ identifier: "Budget.Resilience" })

// BudgetPolicy composes the hard maximums that a model may never relax.
export interface Policy extends Schema.Schema.Type<typeof Policy> {}
export const Policy = Schema.Struct({
  limits: Limits,
  concurrency: Concurrency,
  retrieval: Retrieval,
  cost: Cost,
  resilience: Resilience,
}).annotate({ identifier: "Budget.Policy" })

export const Scope = Schema.Literals(["global", "project", "session"]).annotate({ identifier: "Budget.Scope" })
export type Scope = typeof Scope.Type

// BudgetPolicySnapshot is captured at routing decision time for replay and audit.
export interface PolicySnapshot extends Schema.Schema.Type<typeof PolicySnapshot> {}
export const PolicySnapshot = Schema.Struct({
  policy: Policy,
  applied_at: Timestamp,
  scope: Scope,
  routing_profile: RoutingProfile,
  task_class: TaskClass,
  role: HierarchyRole,
}).annotate({ identifier: "Budget.PolicySnapshot" })

// --- BudgetConsumption (doc/arch/schemas/routing/budget-consumption.cue) ---

// ConsumptionThroughput records turn, token and byte spend.
// Byte fields are optional for backward compatibility with records written
// before they existed; enforcement prefers them over caller-supplied observations.
export interface ConsumptionThroughput extends Schema.Schema.Type<typeof ConsumptionThroughput> {}
export const ConsumptionThroughput = Schema.Struct({
  turns_used: NonNegativeInt,
  context_tokens_used: NonNegativeInt,
  output_tokens_used: NonNegativeInt,
  context_bytes_used: Schema.optional(NonNegativeInt),
  output_bytes_used: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "Budget.ConsumptionThroughput" })

// ConsumptionConcurrency records worker and delegation spend.
export interface ConsumptionConcurrency extends Schema.Schema.Type<typeof ConsumptionConcurrency> {}
export const ConsumptionConcurrency = Schema.Struct({
  workers_requested: NonNegativeInt,
  workers_granted: NonNegativeInt,
  delegation_depth_used: NonNegativeInt,
}).annotate({ identifier: "Budget.ConsumptionConcurrency" })

// ConsumptionRetrieval records retrieval, rerank and skill-context spend.
// rerank/skill-chunk fields are optional for backward compatibility.
export interface ConsumptionRetrieval extends Schema.Schema.Type<typeof ConsumptionRetrieval> {}
export const ConsumptionRetrieval = Schema.Struct({
  retrieval_chunks_used: NonNegativeInt,
  rerank_chunks_used: Schema.optional(NonNegativeInt),
  skill_chunks_used: Schema.optional(NonNegativeInt),
  skill_tokens_used: NonNegativeInt,
}).annotate({ identifier: "Budget.ConsumptionRetrieval" })

// ConsumptionCost records wall-clock and monetary spend.
export interface ConsumptionCost extends Schema.Schema.Type<typeof ConsumptionCost> {}
export const ConsumptionCost = Schema.Struct({
  time_ms_used: NonNegativeInt,
  cost_usd_used: NonNegativeFloat,
}).annotate({ identifier: "Budget.ConsumptionCost" })

// ConsumptionResilience records retry, validation and escalation counts.
export interface ConsumptionResilience extends Schema.Schema.Type<typeof ConsumptionResilience> {}
export const ConsumptionResilience = Schema.Struct({
  retry_count: NonNegativeInt,
  validation_count: NonNegativeInt,
  escalation_count: NonNegativeInt,
}).annotate({ identifier: "Budget.ConsumptionResilience" })

// BudgetConsumption composes observed spend across all budget dimensions.
export interface Consumption extends Schema.Schema.Type<typeof Consumption> {}
export const Consumption = Schema.Struct({
  throughput: ConsumptionThroughput,
  concurrency: ConsumptionConcurrency,
  retrieval: ConsumptionRetrieval,
  cost: ConsumptionCost,
  resilience: ConsumptionResilience,
}).annotate({ identifier: "Budget.Consumption" })
