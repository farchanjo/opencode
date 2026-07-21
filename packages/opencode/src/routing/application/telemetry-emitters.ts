/**
 * Feature 047 — routing telemetry emitters.
 *
 * Pure, SDK-free attribute-mapping functions that project the routing stack's
 * four domains (routing decisions, budget consumption + breach, fan-out
 * admission, orchestration outcomes) onto content-free `TelemetrySignal`s drawn
 * from a CLOSED structural allow-list (doc/arch/schemas/emit-real-...cue
 * `#EmissionAttributeKey`), plus armed-gated `emit*` wrappers that feed them to
 * the shipped process-singleton OTLP export pipeline (`telemetry-export.ts`).
 *
 * Safety contract (ADR-0047; mirrors F037/F043):
 *   - NON-BLOCKING (FR6): each `emit*` does a bounded in-memory enqueue and
 *     returns; the network export happens on the pipeline's background flush.
 *   - HANG/CRASH-SAFE (FR7): every `emit*` swallows its own error and never
 *     propagates to the session; a down collector only affects the background
 *     flush, never the caller's turn.
 *   - BYTE-IDENTICAL WHEN OFF (FR8): `isTelemetryArmed()` short-circuits BEFORE a
 *     signal object or attribute bag is built, so a disabled authority allocates
 *     nothing on the hot path.
 *   - NO SECRET LEAKAGE (FR9): only structural scalars are mapped; the shipped
 *     redaction pass in the adapter `offer` runs as defense-in-depth.
 *
 * The builders are exported separately from the `emit*` wrappers so the pure
 * attribute mapping is unit-testable in isolation from the SDK/pipeline.
 */
export * as RoutingTelemetryEmitters from "./telemetry-emitters"

import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { TelemetrySignal } from "@/routing/adapters/outbound/otlp-adapter"
import { isTelemetryArmed, recordDomainSignal } from "@/routing/telemetry-export"

/** Upper bound for a bounded, secret-free reason/label attribute (never user text). */
const MAX_REASON_LENGTH = 128

/** Clamp a typed reason to a short, single-line, bounded string. */
function boundReason(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  const nonEmpty = trimmed.length === 0 ? "unspecified" : trimmed
  return nonEmpty.length > MAX_REASON_LENGTH ? nonEmpty.slice(0, MAX_REASON_LENGTH) : nonEmpty
}

/**
 * Sanitize a string label whose SOURCE is an unconstrained non-empty string (a
 * model id / pool id). A self-hosted/custom provider id can embed auth material
 * that the name-keyed redaction pass cannot see (it never value-scans), so this
 * VALUE-scans and scrubs secret-shaped content BEFORE it can reach the collector,
 * then bounds the length (defense-in-depth, FR9). Structural ids
 * (`openai/gpt-oss-120b`, `gpt-5.6-sol-fast`) pass through unchanged.
 */
export function sanitizeLabel(value: string): string {
  const scrubbed = value
    // Inline URL credentials: scheme://user:pass@host → scheme://[redacted]@host
    .replace(/:\/\/[^/@\s]+@/g, "://[redacted]@")
    // Bearer auth material.
    .replace(/[Bb]earer\s+\S+/g, "Bearer [redacted]")
    // `key=value` auth material (redact the value, keep the key for context).
    .replace(/\b(api[_-]?key|apikey|token|password|secret|authorization)=\S+/gi, "$1=[redacted]")
    // Provider secret-key prefixes (OpenAI-style `sk-...`, GitHub-style `ghp_...`).
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{6,}/g, "[redacted]")
  const trimmed = scrubbed.trim()
  const nonEmpty = trimmed.length === 0 ? "unspecified" : trimmed
  return nonEmpty.length > MAX_REASON_LENGTH ? nonEmpty.slice(0, MAX_REASON_LENGTH) : nonEmpty
}

/**
 * The CLOSED set of fan-out denial reasons — the pure engine's
 * `DispatchRejectionReason` union plus the seam-level synthetic reasons this
 * feature adds. An unknown value collapses to `unspecified` so no free-form text
 * can ever reach a metric/span label (FR9, value-domain safety).
 */
const DENIED_REASONS = new Set<string>([
  "illegal_transition",
  "depth_exceeded",
  "parent_not_orchestrator",
  "admission_denied",
  "model_unresolved",
])

export function boundDeniedReason(reason: string): string {
  return DENIED_REASONS.has(reason) ? reason : "unspecified"
}

// =============================================================================
// Routing decision (FR2) — span `routing.decision`.
// =============================================================================

export interface RoutingDecisionEmission {
  readonly taskClass: Enums.TaskClass
  readonly routingProfile: Enums.RoutingProfile
  readonly hierarchyRole: Enums.HierarchyRole
  readonly selectedModel: string
  readonly scope: Budget.Scope
  readonly authorizedCount: number
  readonly decisionModelCalled: boolean
  readonly offline: boolean
  readonly latencyMs: number
}

export function routingDecisionSignal(e: RoutingDecisionEmission): TelemetrySignal {
  return {
    kind: "traces",
    name: "routing.decision",
    attributes: {
      "routing.task_class": e.taskClass,
      "routing.routing_profile": e.routingProfile,
      "routing.hierarchy_role": e.hierarchyRole,
      "routing.selected_model": sanitizeLabel(e.selectedModel),
      "routing.scope": e.scope,
      "routing.authorized_count": e.authorizedCount,
      "routing.decision_model_called": e.decisionModelCalled,
      "routing.offline": e.offline,
      "routing.latency_ms": e.latencyMs,
    },
  }
}

export function emitRoutingDecision(e: RoutingDecisionEmission): void {
  if (!isTelemetryArmed()) return
  try {
    recordDomainSignal(routingDecisionSignal(e))
  } catch {
    /* telemetry never blocks or breaks the routing hot path */
  }
}

// =============================================================================
// Budget consumption + breach (FR3) — metric `budget.consumption` / `budget.breach`.
// =============================================================================

export interface BudgetConsumptionEmission {
  readonly turnsUsed: number
  readonly contextTokensUsed: number
  readonly outputTokensUsed: number
  readonly costUsdUsed: number
  readonly scope: Budget.Scope
}

/**
 * The per-turn consumption is emitted as a SPAN (not a metric), because its
 * fields are MONOTONIC per-turn running totals: as metric-point dimensions they
 * would mint a fresh time-series every turn (unbounded cardinality). On a span
 * each turn is its own event, so the numeric breakdown is cardinality-safe
 * (ADR-0047; FIX 1). The breach counter below stays a metric — its labels are
 * bounded enums.
 */
export function budgetConsumptionSignal(e: BudgetConsumptionEmission): TelemetrySignal {
  return {
    kind: "traces",
    name: "budget.consumption",
    attributes: {
      "budget.turns_used": e.turnsUsed,
      "budget.context_tokens_used": e.contextTokensUsed,
      "budget.output_tokens_used": e.outputTokensUsed,
      "budget.cost_usd_used": e.costUsdUsed,
      "budget.scope": e.scope,
    },
  }
}

export interface BudgetBreachEmission {
  readonly outcome: string
  readonly dimension: string
  readonly scope: Budget.Scope
}

export function budgetBreachSignal(e: BudgetBreachEmission): TelemetrySignal {
  return {
    kind: "metrics",
    name: "budget.breach",
    attributes: {
      value: 1,
      "budget.outcome": boundReason(e.outcome),
      "budget.dimension": boundReason(e.dimension),
      "budget.scope": e.scope,
    },
  }
}

/** Emit the per-turn consumption point and, when present, the breach counter. */
export function emitBudgetConsumption(consumption: BudgetConsumptionEmission, breach?: BudgetBreachEmission): void {
  if (!isTelemetryArmed()) return
  try {
    recordDomainSignal(budgetConsumptionSignal(consumption))
    if (breach) recordDomainSignal(budgetBreachSignal(breach))
  } catch {
    /* telemetry never blocks or breaks the budget seam */
  }
}

// =============================================================================
// Fan-out admission (FR4) — span `hierarchy.fanout`.
// =============================================================================

export interface FanoutAdmissionEmission {
  readonly parentRole: Enums.HierarchyRole
  readonly childRole: Enums.HierarchyRole
  readonly fanoutRequested: number
  readonly fanoutGranted: number
  readonly admitted: boolean
  readonly deniedReason?: string
}

export function fanoutAdmissionSignal(e: FanoutAdmissionEmission): TelemetrySignal {
  const attributes: Record<string, unknown> = {
    "hierarchy.parent_role": e.parentRole,
    "hierarchy.child_role": e.childRole,
    "hierarchy.fanout_requested": e.fanoutRequested,
    "hierarchy.fanout_granted": e.fanoutGranted,
    "hierarchy.admitted": e.admitted,
  }
  if (e.deniedReason !== undefined) attributes["hierarchy.denied_reason"] = boundDeniedReason(e.deniedReason)
  return { kind: "traces", name: "hierarchy.fanout", attributes }
}

export function emitFanoutAdmission(e: FanoutAdmissionEmission): void {
  if (!isTelemetryArmed()) return
  try {
    recordDomainSignal(fanoutAdmissionSignal(e))
  } catch {
    /* telemetry never blocks or breaks the spawn seam */
  }
}

// =============================================================================
// Orchestration outcome (FR5) — span `orchestration.worker` / metric `orchestration.gate`.
// =============================================================================

export type OrchestrationValidation = "accepted" | "rejected" | "none"

export interface OrchestrationWorkerEmission {
  readonly lifecycle: "done" | "failed" | "aborted"
  readonly delivery: "foreground" | "background"
  readonly validation: OrchestrationValidation
  readonly failAction?: string
}

export function orchestrationWorkerSignal(e: OrchestrationWorkerEmission): TelemetrySignal {
  const attributes: Record<string, unknown> = {
    "orchestration.worker_lifecycle": e.lifecycle,
    "orchestration.delivery": e.delivery,
    "orchestration.validation": e.validation,
  }
  if (e.failAction !== undefined) attributes["orchestration.fail_action"] = e.failAction
  return { kind: "traces", name: "orchestration.worker", attributes }
}

export function emitOrchestrationWorker(e: OrchestrationWorkerEmission): void {
  if (!isTelemetryArmed()) return
  try {
    recordDomainSignal(orchestrationWorkerSignal(e))
  } catch {
    /* telemetry never blocks or breaks the orchestration seam */
  }
}

export interface CompletionGateEmission {
  readonly pendingWorkers: number
}

export function completionGateSignal(e: CompletionGateEmission): TelemetrySignal {
  return {
    kind: "metrics",
    name: "orchestration.gate",
    attributes: { value: e.pendingWorkers, "orchestration.pending_workers": e.pendingWorkers },
  }
}

export function emitCompletionGate(e: CompletionGateEmission): void {
  if (!isTelemetryArmed()) return
  try {
    recordDomainSignal(completionGateSignal(e))
  } catch {
    /* telemetry never blocks or breaks the completion gate */
  }
}
