import { Metric } from "effect"

// Feature 001 Phase 1 — bounded-cardinality telemetry instruments.
//
// Concept spans and metric instruments for Smart Agent Routing per ADR-0001
// (doc/arch/adr/0001-opentelemetry-telemetry-foundation.md). Metric labels use
// bounded enums and allowlisted active-catalog identifiers under a configurable
// cardinality budget; over-budget label values map to `other`. Session/message
// and dynamic-skill identifiers are never metric labels — they stay in
// traces/logs.

// Sentinel value for any label whose value is not on the bounded allowlist.
export const OTHER = "other" as const

// --- Concept spans ------------------------------------------------------------

// SpanName — the eight routing/execution concept spans. Mirrors plan.md
// "Observability alignment" and ADR-0001.
export const SpanName = {
  routingEvaluate: "routing.evaluate",
  decisionModel: "decision_model",
  hardGates: "hard_gates",
  rank: "rank",
  taskExecute: "task.execute",
  llmRequest: "llm.request",
  toolExecute: "tool.execute",
  fallback: "fallback",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

// --- Bounded label enums ------------------------------------------------------
// Mirrors @opencode-ai/schema/routing/enums and plan.md bounded-enum labels.
// Kept as local literals so this module carries no cross-package dependency;
// the schema package remains the source of truth for the value sets.

export const Labels = {
  status: ["success", "failure", "blocked", "degraded"] as const,
  task_class: ["small", "medium", "large", "complex"] as const,
  routing_profile: ["direct_worker", "manager"] as const,
  task_effort: ["minimal", "low", "medium", "high", "massive"] as const,
  reasoning_effort: ["minimal", "low", "medium", "high"] as const,
  hierarchy_role: ["architect", "manager", "worker"] as const,
  execution_boundary: ["safe", "retryable", "mutation_risky"] as const,
} as const

// Bounded reasons a queued signal can be dropped or evicted.
export const DropReason = ["queue_full", "backpressure_evict", "stale"] as const
export type DropReason = (typeof DropReason)[number]

// boundEnum — maps a value to itself when it is on the bounded allowlist,
// otherwise to `other`. Guarantees metric labels never exceed the enum budget.
export function boundEnum(allowed: ReadonlyArray<string>, value: string): string {
  return allowed.includes(value) ? value : OTHER
}

// --- Cardinality allowlist for dynamic identifiers ---------------------------
// provider / model / variant / agent use only active allowlisted IDs under a
// configurable cardinality budget; over-budget maps to `other` (ADR-0001).

export interface CardinalityAllowlist {
  // Returns the value when it is already admitted or fits within the budget,
  // otherwise the `other` sentinel. Never throws; never blocks.
  readonly bound: (value: string) => string
  // Current number of admitted distinct values.
  readonly size: () => number
  // Clears admitted values (e.g. on catalog reload).
  readonly reset: () => void
}

// createCardinalityAllowlist — admits up to `budget` distinct values; every
// further distinct value collapses to `other`. A non-positive budget collapses
// everything to `other`.
export function createCardinalityAllowlist(budget: number): CardinalityAllowlist {
  const admitted = new Set<string>()
  return {
    bound(value) {
      if (admitted.has(value)) return value
      if (admitted.size < budget) {
        admitted.add(value)
        return value
      }
      return OTHER
    },
    size: () => admitted.size,
    reset: () => admitted.clear(),
  }
}

// --- Metric instruments -------------------------------------------------------
// Effect metrics; the OTLP metrics exporter snapshots the registry on its
// export interval. Names namespaced by concern.

// Routing decision latency (ms) — distribution across evaluation runs.
export const routingDecisionLatency = Metric.histogram("routing.decision.latency_ms", {
  description: "Latency of a routing decision evaluation in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
})

// Hard-gate rejection count — candidates rejected by hard gates.
export const hardGateRejection = Metric.counter("routing.hard_gate.rejection", {
  description: "Count of candidates rejected by routing hard gates",
  incremental: true,
})

// Authorized-candidate count — distribution of authorized candidates per decision.
export const authorizedCandidates = Metric.histogram("routing.authorized_candidates", {
  description: "Number of authorized candidates produced by a routing decision",
  boundaries: [0, 1, 2, 3, 5, 8, 13, 21],
})

// Export queue depth — current number of signals held in the bounded queue.
export const exportQueueDepth = Metric.gauge("telemetry.export.queue_depth", {
  description: "Current depth of the bounded OTLP export queue",
})

// Export queue capacity — configured maximum queue size.
export const exportQueueCapacity = Metric.gauge("telemetry.export.queue_capacity", {
  description: "Configured capacity of the bounded OTLP export queue",
})

// Export drops — signals dropped/evicted by the queue drop/backpressure policy.
export const exportDrops = Metric.counter("telemetry.export.drops", {
  description: "Count of telemetry signals dropped before export",
  incremental: true,
})

// Exporter errors — failed OTLP export attempts.
export const exporterErrors = Metric.counter("telemetry.export.errors", {
  description: "Count of OTLP exporter errors",
  incremental: true,
})

export * as TelemetryInstruments from "./telemetry-instruments"
