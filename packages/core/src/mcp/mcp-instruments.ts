export * as McpInstruments from "./mcp-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../observability/telemetry-instruments"

// Feature 008 / T022 (S14) — MCP telemetry instruments (Observability, FR54, FR55,
// FR56, C26, AC22).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP
// foundation (bounded async sink, drop-oldest/drop backpressure, redaction) stays
// the only export path, and async bounded export never blocks the connect / list /
// call / read / subscribe hot path — when OTEL is unavailable a call proceeds and
// metric loss does not block it (AC22). URIs, content, call IDs, and session IDs are
// NEVER metric labels — they stay in traces/logs only (C26, AC22); every dynamic
// value is passed through `TelemetryInstruments.boundEnum` / `createCardinalityAllowlist`
// so an out-of-budget value collapses to `OTHER` instead of growing cardinality
// unbounded, and Process Table child IDs correlate on traces, never labels (FR56).
// Every metric is content-free: only bounded enums, buckets, and counts.

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans --------------------------------------------------------
// The eleven mcp.* concept spans (Observability). They link to — never replace —
// the Feature 001 routing/session/LLM spans and the Feature 002 Process Table job
// spans; Feature 008 runs no second router, executor, or Process Table (C26).

export const SpanName = {
  connect: "mcp.connect",
  negotiate: "mcp.negotiate",
  list: "mcp.list",
  call: "mcp.call",
  progress: "mcp.progress",
  read: "mcp.read",
  subscribe: "mcp.subscribe",
  reconnect: "mcp.reconnect",
  cancel: "mcp.cancel",
  taskStatus: "mcp.task.status",
  taskResult: "mcp.task.result",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/** The existing spans the mcp.* spans correlate with — session/routing/LLM + Process Table (FR54, C26). */
export const CorrelatedSpanName = {
  routingEvaluate: TelemetryInstruments.SpanName.routingEvaluate,
  taskExecute: TelemetryInstruments.SpanName.taskExecute,
  sessionExecution: "session.execution",
  llmRequest: TelemetryInstruments.SpanName.llmRequest,
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
  jobExecute: "job.execute",
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ---------------------------------------------------
// Local literals mirroring `@opencode-ai/schema/mcp/enums(-state|-event)` so this
// module carries no cross-package dependency; the schema package stays the source of
// truth for the value sets (mirrors `semantic/semantic-instruments.ts` and
// `langlock/langlock-instruments.ts` Labels). Every dynamic value is passed through
// `boundEnum` at record time so a label never exceeds its enum budget. No label is a
// URI, content, call id, or session id (C26, AC22).

export const Labels = {
  transport: ["stdio", "streamable-http", "sse"] as const,
  connection_state: ["configured", "connecting", "negotiating", "recording", "connected", "reconnecting"] as const,
  terminal_branch: ["disabled", "failed", "needs_auth", "needs_client_registration"] as const,
  catalog_state: ["stale", "walking", "fresh", "guard_tripped"] as const,
  subscription_state: ["unsubscribed", "subscribing", "subscribed", "unsubscribing", "fail_closed"] as const,
  call_outcome: ["completed", "tool_error", "protocol_error", "cancelled"] as const,
  cancel_outcome: ["acknowledged", "cancel_requested", "unknown_remote"] as const,
  cancel_wire: ["notifications_cancelled", "tasks_cancel"] as const,
  capability_gap: ["none", "mcp_unavailable", "feature_unsupported", "needs_auth", "needs_client_registration"] as const,
  task_status: ["working", "input_required", "completed", "failed", "cancelled"] as const,
  content_kind: ["text", "image", "audio", "resource", "resource_link", "structured"] as const,
  outcome: ["success", "failure", "blocked", "degraded"] as const,
} as const

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its export
// interval (C26). Names namespaced under `mcp.*`. Content-free: only latency/byte
// buckets and bounded-enum counts.

// Connect / negotiate / call / read latency buckets (Observability). Milliseconds, never content.
export const connectLatencyMs = Metric.histogram("mcp.connect.latency_ms", {
  description: "MCP connect+negotiate+record latency in milliseconds",
  boundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
})
export const callLatencyMs = Metric.histogram("mcp.call.latency_ms", {
  description: "tools/call end-to-end latency in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
})
export const readLatencyMs = Metric.histogram("mcp.read.latency_ms", {
  description: "resources/read end-to-end latency in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
})

// Bytes spooled per call/read (Observability): byte count, never the content itself (FR56).
export const bytesSpooled = Metric.histogram("mcp.bytes_spooled", {
  description: "Byte length routed to the Feature 005 OutputSpool per call/read",
  boundaries: [1024, 8192, 65536, 262144, 1048576, 10485760, 52428800],
})

// Progress-notification count per call (Observability): a count, never the progress payload (FR55).
export const progressCount = Metric.counter("mcp.progress.count", {
  description: "Count of monotonic progress notifications observed per call",
  incremental: true,
})

// Reconnect count (Observability): bounded backoff attempts, labelled by transport only (FR29, C14).
export const reconnectCount = Metric.counter("mcp.reconnect.count", {
  description: "Count of Streamable HTTP reconnect attempts under bounded backoff",
  incremental: true,
})

// Update-coalesce count (Observability): resources/updated merged into the bounded queue (FR23, C9).
export const updateCoalesceCount = Metric.counter("mcp.update.coalesce.count", {
  description: "Count of resources/updated notifications coalesced into the bounded queue",
  incremental: true,
})

// Failure counter (Observability): classified by the bounded gap/outcome enums only, never content.
export const failureCount = Metric.counter("mcp.failures", {
  description: "Count of MCP lifecycle/call/read failures classified by bounded gap/outcome",
  incremental: true,
})
