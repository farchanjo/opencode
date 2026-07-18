export * as JobsInstruments from "./jobs-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../observability/telemetry-instruments"

// Feature 003 / T019 — jobs telemetry instruments (Observability, C18, AC15, AC16).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP
// foundation (bounded async sink, drop-oldest/drop backpressure, redaction)
// stays the only export path, and the Feature 002 lifecycle events are reused
// unchanged (C18). Async bounded export never blocks the trigger/execution hot
// path (AC15). `job_definition_id`/`occurrence_id`/`session_id`/`process_id` are
// NEVER metric labels — they stay in traces/logs only (AC16); every bounded
// enum below reuses `TelemetryInstruments.boundEnum` /
// `createCardinalityAllowlist` so an out-of-budget dynamic value collapses to
// `OTHER` instead of growing label cardinality unbounded.

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans --------------------------------------------------------
// The eight job.* concept spans (Observability). They correlate with — never
// replace — the Feature 001 concept spans `task.execute`, `session.execution`,
// `llm.request`, `tool.execute`, and `fallback`, and the Feature 002 lifecycle
// spans; the scheduler never runs a second executor (C16, C18).

export const SpanName = {
  schedule: "job.schedule",
  trigger: "job.trigger",
  claim: "job.claim",
  notify: "job.notify",
  dispatch: "job.dispatch",
  execute: "job.execute",
  retry: "job.retry",
  reconcile: "job.reconcile",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/** The existing spans the job.* spans correlate with (Observability, C18). */
export const CorrelatedSpanName = {
  taskExecute: TelemetryInstruments.SpanName.taskExecute,
  sessionExecution: "session.execution",
  llmRequest: TelemetryInstruments.SpanName.llmRequest,
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
  fallback: TelemetryInstruments.SpanName.fallback,
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ---------------------------------------------------
// Local literals mirroring `@opencode-ai/schema/jobs/enums(-notification)` so
// this module carries no cross-package dependency; the schema package stays the
// source of truth for the value sets (mirrors `lifecycle/lifecycle-instruments.ts`
// Labels). Every dynamic value is passed through `boundEnum` at record time so a
// label never exceeds its enum budget.

export const Labels = {
  occurrence_state: [
    "due",
    "claimed",
    "admitted",
    "executing",
    "completed",
    "failed",
    "cancelled",
    "timed_out",
    "skipped",
    "coalesced",
    "misfired",
    "overlap_rejected",
    "overlap_replaced",
    "reconciled",
    "unknown",
  ] as const,
  registration_state: ["pending", "registered", "unregistered", "unknown", "reconciled"] as const,
  misfire_policy: ["skip", "fire_once", "bounded_catch_up", "coalesce"] as const,
  overlap_policy: ["allow", "forbid", "queue", "replace"] as const,
  capability_surface: ["in_process", "os_level"] as const,
  reconcile_outcome: ["reconciled", "unknown"] as const,
  job_source: ["runtime", "scheduler", "executor", "reconciler", "operator"] as const,
  notification_type: [
    "occurrence_settled",
    "occurrence_failed",
    "occurrence_cancelled",
    "occurrence_timed_out",
    "misfire",
    "reconciled",
    "operator_advisory",
  ] as const,
  notification_priority: ["low", "normal", "high", "urgent"] as const,
  delivery_state: ["enqueued", "queued", "coalesced", "delivered", "expired"] as const,
  ack_state: ["unacknowledged", "acknowledged", "expired"] as const,
  terminal_reason: [
    "completed_ok",
    "error",
    "cancelled_by_operator",
    "timed_out",
    "reconciled_unknown",
  ] as const,
} as const

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its
// export interval (C18). Names namespaced under `job.*`.

// Enabled-definition and registration gauges (Observability).
export const definitionsEnabled = Metric.gauge("job.definitions.enabled", {
  description: "Current count of enabled Job Definitions",
})
export const registrationsActive = Metric.gauge("job.registrations.active", {
  description: "Current count of schedules in the registered state",
})

// Trigger-fan-out counters (Observability): due / triggered / misfired /
// skipped / coalesced.
export const triggerDue = Metric.counter("job.trigger.due", {
  description: "Count of in-process Bun.cron callbacks that observed a due time",
  incremental: true,
})
export const triggerTriggered = Metric.counter("job.trigger.triggered", {
  description: "Count of occurrences created from a due trigger before admission",
  incremental: true,
})
export const triggerMisfired = Metric.counter("job.trigger.misfired", {
  description: "Count of missed triggers resolved to an explicit misfire outcome",
  incremental: true,
})
export const triggerSkipped = Metric.counter("job.trigger.skipped", {
  description: "Count of missed triggers skipped per the misfire policy",
  incremental: true,
})
export const triggerCoalesced = Metric.counter("job.trigger.coalesced", {
  description: "Count of missed triggers coalesced into one occurrence",
  incremental: true,
})

// Schedule lag / queue wait / execution duration (Observability). Lag is
// measured from the nominal due instant, never wall-clock arrival (FR19, AC4).
export const scheduleLagMs = Metric.histogram("job.schedule.lag_ms", {
  description: "Occurrence schedule lag measured from the nominal due instant, in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
})
export const queueWaitMs = Metric.histogram("job.queue.wait_ms", {
  description: "Time an occurrence spent queued under Feature 002 admission backpressure, in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
})
export const executionDurationMs = Metric.histogram("job.execution.duration_ms", {
  description: "Occurrence execution duration, in milliseconds",
  boundaries: [10, 50, 100, 250, 500, 1000, 5000, 10000, 30000, 60000, 300000, 600000],
})

// Terminal-outcome counters (Observability): success / failure / cancel /
// timeout. Feature 002 owns terminal status; these count occurrence outcomes
// observed by the scheduler, never a second terminal authority (C16).
export const executionCompleted = Metric.counter("job.execution.completed", {
  description: "Count of occurrences that reached completed",
  incremental: true,
})
export const executionFailed = Metric.counter("job.execution.failed", {
  description: "Count of occurrences that reached failed",
  incremental: true,
})
export const executionCancelled = Metric.counter("job.execution.cancelled", {
  description: "Count of occurrences that reached cancelled",
  incremental: true,
})
export const executionTimedOut = Metric.counter("job.execution.timed_out", {
  description: "Count of occurrences that reached timed_out",
  incremental: true,
})

// Overlap / retry counters (Observability). Retry counts only an explicit
// mutation-safe policy selection, never a blind re-execution of an ambiguous
// mutating effect (FR14, C11).
export const overlapEvaluated = Metric.counter("job.overlap.evaluated", {
  description: "Count of overlap-policy evaluations (rejected/replaced/allowed/queued)",
  incremental: true,
})
export const retryScheduled = Metric.counter("job.retry.scheduled", {
  description: "Count of retries scheduled under an explicit mutation-safe policy",
  incremental: true,
})

// Notification counters and queue depth (Observability): queue / delivery /
// ack / expiry. Queues never grow unbounded (C19); depth is bounded and gauged.
export const notificationEnqueued = Metric.counter("job.notification.enqueued", {
  description: "Count of notifications enqueued",
  incremental: true,
})
export const notificationDelivered = Metric.counter("job.notification.delivered", {
  description: "Count of notifications delivered at a safe active-turn boundary",
  incremental: true,
})
export const notificationAcknowledged = Metric.counter("job.notification.acknowledged", {
  description: "Count of delivered notifications acknowledged",
  incremental: true,
})
export const notificationExpired = Metric.counter("job.notification.expired", {
  description: "Count of notifications that reached TTL and expired",
  incremental: true,
})
export const notificationQueueDepth = Metric.gauge("job.notification.queue_depth", {
  description: "Current depth of the bounded per-scope notification queue",
})

// Saturation and reconciliation (Observability). Reconciliation never re-executes
// effects (FR14, C11); this counts reconciliation sweeps and their outcomes only.
export const saturationGauge = Metric.gauge("job.admission.saturation", {
  description: "Measured saturation [0,1] for the scheduler trigger/notification queues",
})
export const reconciled = Metric.counter("job.reconcile.settled", {
  description: "Count of registration/occurrence reconciliations settled (reconciled/unknown)",
  incremental: true,
})
