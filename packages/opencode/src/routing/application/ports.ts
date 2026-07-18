/**
 * Feature 001 / T026 — Routing application ports.
 *
 * The inbound application ports owned by Feature 001, mirrored 1:1 from
 * doc/arch/sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/contracts/ports.ts
 * (RoutingPort, SmartPort, BudgetPort, PoolsPort). TelemetryPort is owned by
 * telemetry-service.ts and re-exported here for a single application-port
 * surface.
 *
 * Two layers live in this module:
 *   - INBOUND ports (RoutingPort/SmartPort/BudgetPort/PoolsPort): implemented by
 *     the routing application services and consumed by Feature 007 operator
 *     adapters. Every method is Effect-typed with the closed error union from
 *     contracts/ports.ts; reads are model-independent, offline-capable and
 *     zero-cost.
 *   - OUTBOUND dependency ports (RoutingConfigSource/CandidateSource/
 *     TaskAnalyzer/DecisionStore/RoutingTelemetry): the seams the routing
 *     service depends on. T027 (catalog/config/event adapters) and the
 *     composition root supply concrete implementations; the routing domain
 *     modules stay framework-free behind these ports.
 *
 * Request/response shapes reuse the wire mirror in
 * packages/protocol/src/routing (the canonical validated shapes for the
 * routing surface) so the application ports never drift from the protocol.
 */
export * as RoutingPorts from "./ports"

import type { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Capability } from "@opencode-ai/schema/routing/capability"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { SmartState } from "@opencode-ai/schema/tui/smart-state"
import type {
  EvaluateRequest,
  ExplainResponse,
  TestRequest,
  TestResponse,
  CapabilityInspectResponse,
  StatusResponse,
  RoutingError,
} from "@opencode-ai/protocol/routing/index"
import type {
  EvaluationCandidate,
  DimensionRequirements,
  RankingCriteria,
} from "../domain/routing-evaluator"

// Re-export the telemetry inbound port so the four Feature 001 domains expose a
// single application-port module (plan.md "Application ... ports.ts").
export type { TelemetryPort } from "./telemetry-service"

// =============================================================================
// Routing Port (inbound) — mirrors contracts/ports.ts RoutingPort
// =============================================================================

export interface RoutingPort {
  /** Evaluate + persist a RoutingDecision. Zero LLM calls; deterministic local evaluation. */
  readonly evaluate: (input: EvaluateRequest) => Effect.Effect<Decision.RoutingDecision, RoutingError>
  /** Explain a persisted decision by id from recorded gate/candidate/fallback data. Zero cost. */
  readonly explain: (decisionId: string) => Effect.Effect<ExplainResponse, RoutingError>
  /** Deterministic local simulation of the routing baseline. Zero model calls. */
  readonly test: (input: TestRequest) => Effect.Effect<TestResponse, RoutingError>
  /** Inspect redacted tool-call capability metadata for a candidate. Zero cost. */
  readonly capabilityInspect: (modelId?: string) => Effect.Effect<CapabilityInspectResponse, RoutingError>
  /** Effective routing configuration + health, offline-capable. Zero cost. */
  readonly status: () => Effect.Effect<StatusResponse, RoutingError>
}

// =============================================================================
// Smart Port (inbound) — mirrors contracts/ports.ts SmartPort
// =============================================================================

export type SmartScope = "global" | "project"

export interface SmartStatusOutput {
  readonly active: boolean
  readonly reason: string
  readonly brainActive: boolean
  readonly routingActive: boolean
  readonly routingProfile: string | null
  readonly hierarchyRole: string | null
  readonly indicatorState: SmartState.SmartIndicatorState
  readonly degradedReason: string | null
  readonly fallbackText: string | null
}

export type SmartError = { readonly type: "unavailable"; readonly reason: string } | { readonly type: "not_implemented" }

export interface SmartPort {
  readonly status: () => Effect.Effect<SmartStatusOutput, SmartError>
  readonly enable: (scope: SmartScope) => Effect.Effect<SmartStatusOutput, SmartError>
  readonly disable: (scope: SmartScope) => Effect.Effect<SmartStatusOutput, SmartError>
  /** Policy-driven auto — distinct from permission-mode `auto`. */
  readonly setAuto: (scope: SmartScope) => Effect.Effect<SmartStatusOutput, SmartError>
}

// =============================================================================
// Budget Port (inbound, read-only) — mirrors contracts/ports.ts BudgetPort
// =============================================================================

export type BudgetObserveScope = "session" | "project"

export interface BudgetStatusOutput {
  readonly policy: Budget.Policy
  readonly consumption: Budget.Consumption
  readonly remaining: Budget.Consumption
  readonly scope: BudgetObserveScope
}

export interface BudgetLimitsOutput {
  readonly hardMaximums: Budget.Policy
  readonly perProfile: Record<string, Budget.Policy>
  readonly perRole: Record<string, Budget.Policy>
}

export type BudgetError = { readonly type: "unavailable"; readonly reason: string } | { readonly type: "not_implemented" }

export interface BudgetPort {
  readonly status: (scope: BudgetObserveScope) => Effect.Effect<BudgetStatusOutput, BudgetError>
  readonly limits: () => Effect.Effect<BudgetLimitsOutput, BudgetError>
}

// =============================================================================
// Pools Port (inbound, read-only) — mirrors contracts/ports.ts PoolsPort
// =============================================================================

export interface PoolSummary {
  readonly id: string
  readonly role: string
  readonly candidateCount: number
  readonly catalogVersion: string
  readonly health: "ok" | "degraded" | "unavailable"
}

export interface CandidateDetail {
  readonly modelId: string
  readonly provider: string
  readonly tier: string
  readonly healthy: boolean
}

export interface PoolsListOutput {
  readonly pools: PoolSummary[]
}

export interface PoolsShowOutput {
  readonly pool: PoolSummary & { readonly candidates: CandidateDetail[] }
}

export type PoolsError =
  | { readonly type: "not_found"; readonly poolId: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export interface PoolsPort {
  readonly list: (role?: string) => Effect.Effect<PoolsListOutput, PoolsError>
  readonly show: (poolId: string) => Effect.Effect<PoolsShowOutput, PoolsError>
}

// =============================================================================
// Outbound dependency ports — the seams the routing service composes.
// Concrete implementations arrive in T027 (catalog/config/event adapters) and
// the composition root; the routing domain stays framework-free behind these.
// =============================================================================

export type RoutingConfigOrigin = "global" | "project" | "default"

export interface RoutingConfigResolution {
  readonly config: RoutingConfig.Info
  readonly policyVersion: string
  readonly origin: RoutingConfigOrigin
}

/** Effective routing configuration resolution (Config.Service via Feature 007). Offline-capable. */
export interface RoutingConfigSource {
  readonly resolve: () => Promise<RoutingConfigResolution>
}

export interface CandidateQuery {
  readonly routingProfile: Enums.RoutingProfile
  readonly taskClass: Enums.TaskClass
  readonly config: RoutingConfig.Info
  readonly scope: Budget.Scope
}

export interface CandidateResolution {
  /** The candidate set for the query, resolved from Catalog.Service/ModelsDev only. */
  readonly candidates: ReadonlyArray<EvaluationCandidate>
  /** Model ids backing the decision-model pool, in pool order. */
  readonly decisionPoolModelIds: ReadonlyArray<string>
  readonly catalogVersion: string
}

export interface CandidateSourceStatus {
  readonly catalogVersion: string
  readonly health: "ok" | "degraded" | "unavailable"
  readonly offline: boolean
  readonly reason: string | null
  readonly recommendedAction: string | null
}

/** Candidate resolution from the canonical catalog — never hardcoded model ids. */
export interface CandidateSource {
  readonly resolve: (query: CandidateQuery) => Promise<CandidateResolution>
  readonly inspect: (modelId?: string) => Promise<ReadonlyArray<Capability.Record>>
  readonly status: () => Promise<CandidateSourceStatus>
}

export interface TaskAnalyzerInput {
  readonly taskDescription: string
  readonly scope: Budget.Scope
}

export interface TaskAnalysis {
  readonly inputs: Decision.DecisionInputs
  readonly requirements: DimensionRequirements
  readonly ranking: RankingCriteria
}

/**
 * Deterministic, model-free derivation of the structured routing signals from a
 * task description. Keeps the "zero LLM call" invariant honest: the raw string
 * never reaches a model — a local heuristic (composition root) produces the
 * structured DecisionInputs, capability requirements and ranking criteria.
 */
export interface TaskAnalyzer {
  readonly analyze: (input: TaskAnalyzerInput) => TaskAnalysis
}

/** Decision persistence: idempotent commit + by-id read for explain/replay. */
export interface DecisionStore {
  readonly commit: (decision: Decision.RoutingDecision) => Promise<Decision.RoutingDecision>
  readonly findById: (decisionId: string) => Promise<Decision.RoutingDecision | null>
}

export interface RoutingDecisionTelemetry {
  readonly decisionId: string
  readonly taskClass: Enums.TaskClass
  readonly routingProfile: Enums.RoutingProfile
  readonly authorizedCount: number
  readonly decisionModelCalled: boolean
  readonly latencyMs: number
  readonly offline: boolean
}

/**
 * Non-blocking routing telemetry sink. The hot path MUST never block on
 * telemetry (plan.md "hot paths never block on telemetry"): implementations
 * enqueue and return immediately, and `recordDecision` never throws.
 */
export interface RoutingTelemetry {
  readonly recordDecision: (event: RoutingDecisionTelemetry) => void
}
