export * as SpoolInstruments from "./spool-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../observability/telemetry-instruments"

// Feature 005 / T023 (S25) — OutputSpool telemetry instruments (Observability,
// FR5, C9, C22, AC18).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP
// foundation (bounded async sink, drop-oldest/drop backpressure, redaction)
// stays the only export path, and async bounded export never blocks the
// append/read/seal hot path (AC18). Content, path, OutputRef, `session_id`,
// `process_id`, and `user_id` are NEVER metric labels — they stay in traces/logs
// only (C22, AC18); every dynamic label is passed through
// `TelemetryInstruments.boundEnum` / `createCardinalityAllowlist` so an
// out-of-budget value collapses to `OTHER` instead of growing cardinality
// unbounded. Every metric is content-free: only bounded enums, buckets, and
// counts (Security 5, C22). The `reasoning` channel is never emitted to OTEL
// (C9, AC22) — `isChannelExportable` gates it out before any label is recorded.

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans --------------------------------------------------------
// The five output.* concept spans (Observability). They link to — never replace —
// the Feature 001 concept spans `task.execute`, `session.execution`,
// `llm.request`, `tool.execute`, and `fallback`; the content plane runs no
// second executor (C20, C22).

export const SpanName = {
  append: "output.append",
  read: "output.read",
  seal: "output.seal",
  reconcile: "output.reconcile",
  cleanup: "output.cleanup",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/** The existing spans the output.* spans correlate with (Observability, C22). */
export const CorrelatedSpanName = {
  taskExecute: TelemetryInstruments.SpanName.taskExecute,
  sessionExecution: "session.execution",
  llmRequest: TelemetryInstruments.SpanName.llmRequest,
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
  fallback: TelemetryInstruments.SpanName.fallback,
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ---------------------------------------------------
// Local literals mirroring `@opencode-ai/schema/outputspool/enums` so this module
// carries no cross-package dependency; the schema package stays the source of
// truth for the value sets (mirrors `jobs/jobs-instruments.ts` and
// `langlock/langlock-instruments.ts` Labels). Every dynamic value is passed
// through `boundEnum` at record time so a label never exceeds its enum budget.
// `channel` deliberately OMITS `reasoning`: the reasoning channel is never
// exported to OTEL (C9, AC22).

export const Labels = {
  channel: ["assistant-text", "stdout", "stderr", "tool-result", "error", "artifact"] as const,
  group_state: ["open", "sealing", "sealed", "aborted", "corrupt", "expired", "unknown"] as const,
  durability_tier: ["durable", "console", "disposable"] as const,
  admission_fault: ["none", "enospc", "fd_exhaustion", "quota", "permission", "latency"] as const,
  quota_scope: ["global", "root", "session", "process", "channel"] as const,
  reconcile_outcome: ["sealed", "open", "aborted", "corrupt", "unknown"] as const,
} as const

/** The channels emittable to OTEL — every channel except `reasoning` (C9, AC22). */
export const EMITTABLE_CHANNELS = Labels.channel

/**
 * Whether a channel may be emitted to OTEL. The `reasoning` channel is never
 * exported — no span, metric label, or preview (C9, AC22).
 */
export const isChannelExportable = (channel: string): boolean =>
  channel !== "reasoning" && (EMITTABLE_CHANNELS as ReadonlyArray<string>).includes(channel)

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its
// export interval (C22). Names namespaced under `output.*`. Content-free: only
// byte/latency/depth buckets and bounded-enum counts.

// Byte throughput buckets (Observability): appended / read. Values are byte
// counts, never content.
export const bytesAppended = Metric.histogram("output.bytes.appended", {
  description: "Bytes appended to a channel per batched writer drain",
  boundaries: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304],
})
export const bytesRead = Metric.histogram("output.bytes.read", {
  description: "Bytes returned per paged read",
  boundaries: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576],
})

// Queue depth and latency buckets (Observability). Depth is bounded and never
// grows unbounded (C3); latency measures the writer drain and the paged read.
export const queueDepthBytes = Metric.histogram("output.queue.depth_bytes", {
  description: "Bounded producer-queue depth at enqueue time, in bytes",
  boundaries: [256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304],
})
export const writerLatencyMs = Metric.histogram("output.writer.latency_ms", {
  description: "Batched writer drain latency, in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
})
export const readLatencyMs = Metric.histogram("output.read.latency_ms", {
  description: "Positional paged read latency, in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
})

// Terminal-state counters (Observability): sealed / aborted / corrupt / expired,
// plus a gauge for currently-open channels. Feature 005 owns content-plane
// settlement; these count outcomes, never a second terminal authority (C20).
export const channelsOpen = Metric.gauge("output.channels.open", {
  description: "Current count of channels in the open state",
})
export const channelsSealed = Metric.counter("output.channels.sealed", {
  description: "Count of channels that reached sealed",
  incremental: true,
})
export const channelsAborted = Metric.counter("output.channels.aborted", {
  description: "Count of channels that reached aborted",
  incremental: true,
})
export const channelsCorrupt = Metric.counter("output.channels.corrupt", {
  description: "Count of channels that reached corrupt",
  incremental: true,
})
export const channelsExpired = Metric.counter("output.channels.expired", {
  description: "Count of channels that reached expired",
  incremental: true,
})

// Spill / fault / cleanup counters (Observability). Faults are first-class and
// never swallowed (FR10, C4); labels are bounded enums only.
export const spillCount = Metric.counter("output.spill.count", {
  description: "Count of oversized non-streaming sources spilled to the spool under caps",
  incremental: true,
})
export const quotaFaults = Metric.counter("output.faults.quota", {
  description: "Count of quota-exceeded admission faults",
  incremental: true,
})
export const diskFaults = Metric.counter("output.faults.disk", {
  description: "Count of disk admission faults (enospc / fd_exhaustion / permission / latency)",
  incremental: true,
})
export const cleanupBatches = Metric.counter("output.cleanup.batches", {
  description: "Count of bounded ref-aware retention cleanup batches run",
  incremental: true,
})
