export * as LifecycleInstruments from "./lifecycle-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../observability/telemetry-instruments"

// Feature 002 / T023 — lifecycle telemetry instruments (FR43-FR47, C18).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP
// foundation (bounded async sink, drop-oldest/drop backpressure, redaction)
// stays the only export path (C18). `task_id`/`session_id`/`process_id` are
// NEVER metric labels — they stay in traces/logs only (FR45, AC17); every
// bounded enum below reuses `TelemetryInstruments.boundEnum` /
// `createCardinalityAllowlist` so an out-of-budget dynamic value collapses to
// `OTHER` instead of growing label cardinality unbounded.

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans --------------------------------------------------------
// Five lifecycle spans (FR43). They correlate with — never replace — the
// Feature 001 concept spans `task.execute`, `session.execution`,
// `llm.request`, `tool.execute`, and `fallback`.

export const SpanName = {
  admission: "admission",
  queueWait: "queue.wait",
  cancel: "cancel",
  handoff: "handoff",
  reconciliation: "reconciliation",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/** The existing spans lifecycle spans correlate with (FR43, C18). */
export const CorrelatedSpanName = {
  taskExecute: TelemetryInstruments.SpanName.taskExecute,
  sessionExecution: "session.execution",
  llmRequest: TelemetryInstruments.SpanName.llmRequest,
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
  fallback: TelemetryInstruments.SpanName.fallback,
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ---------------------------------------------------
// Local literals mirroring `@opencode-ai/schema/lifecycle/enums(-observation)`
// so this module carries no cross-package dependency; the schema package
// stays the source of truth for the value sets (mirrors
// `observability/telemetry-instruments.ts` Labels).

export const Labels = {
  process_state: [
    "created",
    "queued",
    "waiting",
    "running",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
    "zombie",
    "unknown",
  ] as const,
  admission_scope: [
    "global",
    "root",
    "session",
    "child",
    "provider",
    "agent",
    "tool",
    "event_queue",
    "otel_queue",
    "sqlite",
    "token",
    "cost",
  ] as const,
  admission_decision: ["granted", "partial", "queued", "rejected"] as const,
  watchdog_outcome: ["owner_lost", "zombie_detected", "unknown", "reconciled"] as const,
  cancel_outcome: ["requested", "accepted", "rejected", "unknown", "unconfirmed"] as const,
  terminal_reason: [
    "completed_ok",
    "error",
    "cancelled_by_operator",
    "cancelled_by_root",
    "zombie",
    "owner_lost",
    "reconciled_unknown",
  ] as const,
  // Reused verbatim from Feature 001 (C15).
  hierarchy_role: TelemetryInstruments.Labels.hierarchy_role,
} as const

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its
// export interval (C18). Names namespaced under `lifecycle.*`.

// Process-count instruments (Observability alignment: active/started/
// completed/failed/cancelled/zombie/unknown counts, FR44).
export const processActive = Metric.gauge("lifecycle.process.active", {
  description: "Current count of non-terminal Process Table rows",
})
export const processStarted = Metric.counter("lifecycle.process.started", {
  description: "Count of processes that reached running",
  incremental: true,
})
export const processCompleted = Metric.counter("lifecycle.process.completed", {
  description: "Count of processes that reached completed",
  incremental: true,
})
export const processFailed = Metric.counter("lifecycle.process.failed", {
  description: "Count of processes that reached failed",
  incremental: true,
})
export const processCancelled = Metric.counter("lifecycle.process.cancelled", {
  description: "Count of processes that reached cancelled",
  incremental: true,
})
export const processZombie = Metric.counter("lifecycle.process.zombie", {
  description: "Count of processes that reached zombie",
  incremental: true,
})
export const processUnknown = Metric.counter("lifecycle.process.unknown", {
  description: "Count of processes that reached unknown",
  incremental: true,
})

// Queue-wait / TTFT / tokens-per-second / saturation (FR44).
export const queueWaitMs = Metric.histogram("lifecycle.queue.wait_ms", {
  description: "Time a process spent admitted-but-not-running, in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
})
export const ttftMs = Metric.histogram("lifecycle.ttft_ms", {
  description: "Time-to-first-token in milliseconds",
  boundaries: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
})
export const tokensPerSecond = Metric.histogram("lifecycle.tokens_per_second", {
  description: "Valid tokens/s, computed only from monotonic elapsed time (C21)",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500],
})
export const saturationGauge = Metric.gauge("lifecycle.admission.saturation", {
  description: "Measured saturation [0,1] for a capacity source (CPU/mem/provider/SQLite/event-queue/OTEL)",
})

// Queue depth / overflow, terminal preservation and subscriber lag (FR44).
export const eventQueueDepth = Metric.gauge("lifecycle.event_queue.depth", {
  description: "Current depth of the bounded lifecycle event bus queue",
})
export const subscriberLag = Metric.gauge("lifecycle.observation.subscriber_lag", {
  description: "Events an observation subscriber has not yet consumed",
})
export const terminalPreserved = Metric.counter("lifecycle.terminal.preserved", {
  description: "Count of terminal events preserved across bounded-queue overflow (C5)",
  incremental: true,
})

// Retry/fallback (FR44); reconciliation never retries (FR40, C13) — this
// counts fallback candidate selection only, never an automatic effect retry.
export const fallbackSelected = Metric.counter("lifecycle.fallback.selected", {
  description: "Count of fallback candidate selections after an execution failure",
  incremental: true,
})

// --- Local evidence window/confidence/TTL for Smart Routing (FR47, C18) ----
//
// Smart Routing consumes local validated lifecycle evidence with a window,
// confidence floor, and TTL from this in-memory store — never a remote query
// per Task (FR47, AC16). Numeric defaults mirror data-model.md's provisional
// plan constants (`evidence_window_ms`, `evidence_confidence_floor`,
// `evidence_ttl_ms`); overridable, never hidden.

export const DEFAULT_EVIDENCE_WINDOW_MS = 300_000 // 5 min (AC16)
export const DEFAULT_EVIDENCE_CONFIDENCE_FLOOR = 0.6 // AC16
export const DEFAULT_EVIDENCE_TTL_MS = 600_000 // 10 min (AC16)

export interface EvidenceRecord {
  readonly role: (typeof Labels.hierarchy_role)[number]
  readonly validation_outcome: "passed" | "failed" | "low_confidence" | "escalated"
  readonly confidence: number
  readonly recorded_at_ms: number
}

export interface EvidenceStoreOptions {
  readonly windowMs?: number
  readonly confidenceFloor?: number
  readonly ttlMs?: number
  readonly capacity?: number
}

export interface EvidenceStore {
  readonly record: (entry: EvidenceRecord) => void
  /** Validated evidence within the window and above the confidence floor, newest first. */
  readonly query: (nowMs: number, role?: EvidenceRecord["role"]) => ReadonlyArray<EvidenceRecord>
  readonly size: () => number
  readonly clear: () => void
}

/**
 * Bounded, TTL-evicting, windowed evidence store. Pure data structure — no
 * I/O, no remote read. `capacity` bounds worst-case memory even under a
 * pathological record rate.
 */
export function createEvidenceStore(options?: EvidenceStoreOptions): EvidenceStore {
  const windowMs = options?.windowMs ?? DEFAULT_EVIDENCE_WINDOW_MS
  const confidenceFloor = options?.confidenceFloor ?? DEFAULT_EVIDENCE_CONFIDENCE_FLOOR
  const ttlMs = options?.ttlMs ?? DEFAULT_EVIDENCE_TTL_MS
  const capacity = options?.capacity ?? 4096
  let entries: EvidenceRecord[] = []

  function evictExpired(nowMs: number) {
    entries = entries.filter((entry) => nowMs - entry.recorded_at_ms < ttlMs)
  }

  return {
    record(entry) {
      evictExpired(entry.recorded_at_ms)
      entries.push(entry)
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity)
    },
    query(nowMs, role) {
      evictExpired(nowMs)
      return entries
        .filter((entry) => {
          const age = nowMs - entry.recorded_at_ms
          return age >= 0 && age <= windowMs && entry.confidence >= confidenceFloor && (role === undefined || entry.role === role)
        })
        .sort((a, b) => b.recorded_at_ms - a.recorded_at_ms)
    },
    size: () => entries.length,
    clear: () => {
      entries = []
    },
  }
}
