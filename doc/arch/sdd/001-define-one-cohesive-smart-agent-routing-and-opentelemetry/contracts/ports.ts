/**
 * Feature 001 — Application Ports
 *
 * These interfaces define the inbound ports owned by Feature 001.
 * They are implemented by the routing/telemetry domain services and
 * consumed by Feature 007 operator control plane adapters.
 *
 * Domain: routing, telemetry, smart mode, budget observation, pools observation.
 * All mutations require operator principal, explicit scope, CAS, idempotency, audit.
 * Read operations are model-independent, offline-capable, zero LLM cost.
 */

import type { Effect } from "effect"
import type { RoutingDecision } from "./decision.js"
import type { CapabilityRecord } from "./capability.js"
import type { BudgetPolicy, BudgetConsumption } from "./budget.js"
import type { TelemetryConfig } from "./telemetry-config.js"
import type { SmartIndicatorState } from "./smart-state.js"

// =============================================================================
// Routing Port
// =============================================================================

export interface RoutingPort {
  /**
   * Evaluate a routing decision for the given task inputs.
   * Returns the persisted RoutingDecision record.
   * Zero LLM calls; deterministic local evaluation + optional decision model.
   */
  readonly evaluate: (input: RoutingEvaluateInput) => Effect.Effect<RoutingDecision, RoutingError>

  /**
   * Explain a routing decision by ID.
   * Reads persisted score, hard-gate, candidate, rejection, fallback, and confidence
   * data. Never asks a model for explanation.
   * Zero LLM calls, zero cost.
   */
  readonly explain: (decisionId: string) => Effect.Effect<RoutingExplainOutput, RoutingError>

  /**
   * Deterministic local simulation of the routing baseline.
   * Reads persisted state + canonical metadata + hard gates + configured scoring.
   * Zero decision/executor/provider model calls, zero model tokens, zero cost.
   * Reports: "no external model call was made".
   */
  readonly test: (input: RoutingTestInput) => Effect.Effect<RoutingTestOutput, RoutingError>

  /**
   * Inspect tool-call capability metadata for a candidate.
   * Returns redacted declared and observed single-tool capability dimensions.
   * Zero LLM calls, zero cost.
   */
  readonly capabilityInspect: (modelId?: string) => Effect.Effect<CapabilityInspectOutput, RoutingError>

  /**
   * Get current effective routing configuration and health.
   * Works offline, with no configured model/provider, when all candidates fail.
   * Zero LLM calls, zero cost.
   */
  readonly status: () => Effect.Effect<RoutingStatusOutput, RoutingError>
}

export interface RoutingEvaluateInput {
  readonly sessionId: string
  readonly turnId: string
  readonly taskDescription: string
  readonly taskFingerprint: string // deterministic hash for cache/replay
  readonly scope: "global" | "project" | "session"
}

export interface RoutingExplainOutput {
  readonly decisionId: string
  readonly taskClass: string
  readonly routingProfile: string
  readonly gates: GateExplain[]
  readonly candidates: CandidateExplain[]
  readonly scoreBreakdown: Record<string, number>
  readonly decisionModelCalled: boolean
  readonly selectedAgent: string
  readonly selectedModel: string
  readonly fallbackAttempted: boolean
  readonly fallbackReason: string | null
  readonly confidence: number
  readonly redacted: true // never contains prompts, secrets, file content, tool payloads
}

export interface GateExplain {
  readonly dimension: string
  readonly passed: boolean
  readonly reason: string
  readonly requirement: string
  readonly candidateValue: string
}

export interface CandidateExplain {
  readonly agentId: string
  readonly modelId: string
  readonly passed: boolean
  readonly score: number
  readonly rank: number
  readonly rejectionReasons: string[]
}

export interface RoutingTestInput {
  readonly taskDescription: string
  readonly scope: "global" | "project" | "session"
}

export interface RoutingTestOutput {
  readonly taskClass: string
  readonly routingProfile: string
  readonly authorizedCandidates: CandidateExplain[]
  readonly hardGateSummary: GateExplain[]
  readonly budgetPolicy: BudgetPolicy
  readonly noExternalModelCall: true
  readonly redacted: true
}

export interface CapabilityInspectOutput {
  readonly records: CapabilityRecord[]
  readonly redacted: true
}

export interface RoutingStatusOutput {
  readonly enabled: boolean
  readonly mode: "always" | "auto" | "never"
  readonly strictGates: boolean
  readonly decisionModelPool: string[]
  readonly rolePools: Record<string, string[]> // RolePoolID → ModelID[]
  readonly catalogVersion: string
  readonly policyVersion: string
  readonly health: "ok" | "degraded" | "unavailable"
  readonly reason: string | null
  readonly recommendedAction: string | null
  readonly offline: boolean
}

export type RoutingError =
  | { type: "no_authorized_candidate"; reason: string }
  | { type: "catalog_mismatch"; decisionId: string; catalogVersion: string }
  | { type: "mutation_risky"; reason: string; agentId: string; modelId: string }
  | { type: "unavailable"; reason: string }
  | { type: "invalid_argument"; field: string; reason: string }
  | { type: "not_implemented" }

// =============================================================================
// Telemetry Port
// =============================================================================

export interface TelemetryPort {
  /**
   * Get current effective telemetry configuration and export health.
   * Works offline.
   * Zero LLM calls, zero cost.
   */
  readonly status: () => Effect.Effect<TelemetryStatusOutput, TelemetryError>

  /**
   * Enable telemetry at the given scope.
   * Persists via Config.Service; validates config before activation.
   */
  readonly enable: (scope: "global" | "project") => Effect.Effect<TelemetryStatusOutput, TelemetryError>

  /**
   * Disable telemetry at the given scope.
   */
  readonly disable: (scope: "global" | "project") => Effect.Effect<TelemetryStatusOutput, TelemetryError>

  /**
   * Show current effective configuration (secrets redacted).
   * Zero LLM calls, zero cost.
   */
  readonly show: () => Effect.Effect<TelemetryShowOutput, TelemetryError>

  /**
   * Open persistent Settings flow for telemetry configuration.
   * Never accepts raw secrets in prompt or slash arguments.
   */
  readonly configure: (scope: "global" | "project") => Effect.Effect<void, TelemetryError>

  /**
   * Emit a clearly-marked test signal or validate OTLP connectivity.
   * No user content exported.
   * Mode: "signal" (emit test signal) or "connectivity" (validate connection).
   */
  readonly test: (mode: "signal" | "connectivity") => Effect.Effect<TelemetryTestOutput, TelemetryError>

  /**
   * Flush pending telemetry and return counts.
   * Admin operation, requires confirmation.
   */
  readonly flush: () => Effect.Effect<TelemetryFlushOutput, TelemetryError>
}

export interface TelemetryStatusOutput {
  readonly enabled: boolean
  readonly config: TelemetryShowOutput["config"]
  readonly exportHealth: "ok" | "degraded" | "unavailable"
  readonly queueDepth: number
  readonly queueCapacity: number
  readonly dropCount: number
  readonly exportErrorCount: number
  readonly offline: boolean
}

export interface TelemetryShowOutput {
  readonly config: {
    readonly endpoint: string
    readonly transport: "http/protobuf" | "grpc"
    readonly signals: {
      readonly metrics: boolean
      readonly logs: boolean
      readonly traces: boolean
      readonly profiling: boolean
    }
    readonly queue: {
      readonly capacity: number
      readonly batch_size: number
      readonly drop_policy: "drop" | "backpressure"
    }
    readonly redact: {
      readonly prompts: boolean
      readonly secrets: boolean
      readonly file_paths: boolean
      readonly tool_payloads: boolean
    }
  }
  readonly origin: "global" | "project" | "default"
}

export interface TelemetryTestOutput {
  readonly mode: "signal" | "connectivity"
  readonly outcome: "ok" | "unavailable" | "error"
  readonly reason: string | null
  readonly testSignalEmitted: boolean
  readonly noUserContentExported: true
}

export interface TelemetryFlushOutput {
  readonly flushedRecords: number
  readonly discardedRecords: number
  readonly durationMs: number
}

export type TelemetryError =
  | { type: "validation_failed"; fields: Record<string, string> }
  | { type: "connection_failed"; reason: string }
  | { type: "unavailable"; reason: string }
  | { type: "not_implemented" }

// =============================================================================
// Smart Port
// =============================================================================

export interface SmartPort {
  /** Get effective Smart mode state. Zero LLM calls, zero cost. */
  readonly status: () => Effect.Effect<SmartStatusOutput, SmartError>

  /** Enable Smart mode at scope. Zero LLM calls. */
  readonly enable: (scope: "global" | "project") => Effect.Effect<SmartStatusOutput, SmartError>

  /** Disable Smart mode at scope. Zero LLM calls. */
  readonly disable: (scope: "global" | "project") => Effect.Effect<SmartStatusOutput, SmartError>

  /**
   * Set Smart mode to policy-driven auto.
   * Distinct from permission-mode `auto`; textually differentiated.
   * Zero LLM calls.
   */
  readonly setAuto: (scope: "global" | "project") => Effect.Effect<SmartStatusOutput, SmartError>
}

export interface SmartStatusOutput {
  readonly active: boolean
  readonly reason: string
  readonly brainActive: boolean
  readonly routingActive: boolean
  readonly routingProfile: string | null
  readonly hierarchyRole: string | null
  readonly indicatorState: SmartIndicatorState
  readonly degradedReason: string | null
  readonly fallbackText: string | null
}

export type SmartError = { type: "unavailable"; reason: string } | { type: "not_implemented" }

// =============================================================================
// Budget Port (read-only observation)
// =============================================================================

export interface BudgetPort {
  /** Get effective budget policy and consumption for a scope. Zero LLM calls. */
  readonly status: (scope: "session" | "project") => Effect.Effect<BudgetStatusOutput, BudgetError>

  /** Get hard maximum limits. Zero LLM calls. */
  readonly limits: () => Effect.Effect<BudgetLimitsOutput, BudgetError>
}

export interface BudgetStatusOutput {
  readonly policy: BudgetPolicy
  readonly consumption: BudgetConsumption
  readonly remaining: BudgetConsumption // budget - consumption
  readonly scope: "session" | "project"
}

export interface BudgetLimitsOutput {
  readonly hardMaximums: BudgetPolicy
  readonly perProfile: Record<string, BudgetPolicy>
  readonly perRole: Record<string, BudgetPolicy>
}

export type BudgetError = { type: "unavailable"; reason: string } | { type: "not_implemented" }

// =============================================================================
// Pools Port (read-only observation)
// =============================================================================

export interface PoolsPort {
  /** List configured role pools. Zero LLM calls. */
  readonly list: (role?: string) => Effect.Effect<PoolsListOutput, PoolsError>

  /** Show details of a specific pool. Zero LLM calls. */
  readonly show: (poolId: string) => Effect.Effect<PoolsShowOutput, PoolsError>
}

export interface PoolsListOutput {
  readonly pools: PoolSummary[]
}

export interface PoolSummary {
  readonly id: string
  readonly role: string
  readonly candidateCount: number
  readonly catalogVersion: string
  readonly health: "ok" | "degraded" | "unavailable"
}

export interface PoolsShowOutput {
  readonly pool: PoolSummary & {
    readonly candidates: CandidateDetail[]
  }
}

export interface CandidateDetail {
  readonly modelId: string
  readonly provider: string
  readonly tier: string
  readonly healthy: boolean
}

export type PoolsError =
  | { type: "not_found"; poolId: string }
  | { type: "unavailable"; reason: string }
  | { type: "not_implemented" }
