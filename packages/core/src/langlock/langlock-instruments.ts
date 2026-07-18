export * as LangLockInstruments from "./langlock-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../observability/telemetry-instruments"

// Feature 004 / T023 (S17) — Lang Lock telemetry instruments (Observability, FR27,
// C8, AC14).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP
// foundation (bounded async sink, drop-oldest/drop backpressure, redaction) stays
// the only export path, and async bounded export never blocks the prompt,
// execution, or tool hot path (AC14). `session_id`/`execution_id`/file/path are
// NEVER metric labels — they stay in traces/logs only (C8, AC14); every bounded
// enum below reuses `TelemetryInstruments.boundEnum` / `createCardinalityAllowlist`
// so an out-of-budget dynamic value collapses to `OTHER` instead of growing label
// cardinality unbounded. Every metric is content-free: only bounded enums, buckets,
// and counts (Security 5, C8).

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans --------------------------------------------------------
// The five langlock.* concept spans (Observability). They link to — never replace —
// the Feature 001 concept spans `task.execute`, `session.execution`, `llm.request`,
// `tool.execute`, and `fallback`; Lang Lock runs no second executor (C8).

export const SpanName = {
  resolve: "langlock.resolve",
  inject: "langlock.inject",
  stamp: "langlock.stamp",
  detect: "langlock.detect",
  audit: "langlock.audit",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/** The existing spans the langlock.* spans correlate with (Observability, C8). */
export const CorrelatedSpanName = {
  taskExecute: TelemetryInstruments.SpanName.taskExecute,
  sessionExecution: "session.execution",
  llmRequest: TelemetryInstruments.SpanName.llmRequest,
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
  fallback: TelemetryInstruments.SpanName.fallback,
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ---------------------------------------------------
// Local literals mirroring `@opencode-ai/schema/langlock/enums(-event)` so this
// module carries no cross-package dependency; the schema package stays the source of
// truth for the value sets (mirrors `lifecycle/lifecycle-instruments.ts` and
// `jobs/jobs-instruments.ts` Labels). Every dynamic value is passed through
// `boundEnum` at record time so a label never exceeds its enum budget. The effective
// `tag` is a bounded allowlisted enum, never a free-form id (C8, AC14).

export const Labels = {
  enabled: ["true", "false"] as const,
  effective_tag: ["en-US", "en-CA", "en-GB", "en-AU", "pt-BR", "es-ES", "es-MX", "es-AR"] as const,
  scope: ["global", "project", "root", "session"] as const,
  origin: ["default", "global", "project", "managed"] as const,
  enforcement_mode: ["advisory", "strict_deferred"] as const,
  path_kind: [
    "prose_markdown",
    "docs",
    "instruction_file",
    "commit_text",
    "generic_code",
    "exempt",
    "unknown",
  ] as const,
  confidence_bucket: ["low", "medium", "high", "unknown"] as const,
  exception_category: [
    "i18n_resource",
    "vendor_generated",
    "lockfile",
    "legal",
    "external_contract",
    "golden_fixture",
    "exact_string",
  ] as const,
  override_authorized: ["true", "false"] as const,
} as const

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its export
// interval (C8). Names namespaced under `langlock.*`.

// Effective-policy gauges (Observability): enabled state, effective tag, scope,
// origin, enforcement mode, and override-authorized state carried as bounded labels.
export const policyResolved = Metric.counter("langlock.policy.resolved", {
  description: "Count of effective-policy resolutions (labelled by enabled/tag/scope/origin/mode)",
  incremental: true,
})
export const overrideEvaluated = Metric.counter("langlock.override.evaluated", {
  description: "Count of project-override evaluations (applied/retained by authorized/floor)",
  incremental: true,
})

// Injection / reapply / stamping counters (Observability): non-blocking enforcement
// observations that follow the system-prompt and envelope seams.
export const policyInjected = Metric.counter("langlock.policy.injected", {
  description: "Count of effective-language injections into a V1/V2 system prompt",
  incremental: true,
})
export const policyReapplied = Metric.counter("langlock.policy.reapplied", {
  description: "Count of lock reapplications after experimental.chat.system.transform",
  incremental: true,
})
export const envelopeStamped = Metric.counter("langlock.envelope.stamped", {
  description: "Count of execution envelopes stamped with tag/version/source/mode",
  incremental: true,
})

// Advisory-detection counters (Observability): flagged / compliant / unknown, plus a
// bounded advisory-violation count. Detection never gates a write (FR20, C6).
export const advisoryFlagged = Metric.counter("langlock.advisory.flagged", {
  description: "Count of advisory language mismatches flagged on classified prose",
  incremental: true,
})
export const advisoryCompliant = Metric.counter("langlock.advisory.compliant", {
  description: "Count of advisory detections that matched the effective lock",
  incremental: true,
})
export const detectorUnknown = Metric.counter("langlock.detector.unknown", {
  description: "Count of advisory detections resolved to unknown/failure (never blocking)",
  incremental: true,
})
export const advisoryCount = Metric.gauge("langlock.advisory.open", {
  description: "Current count of open (unacknowledged) advisory violations for a scope",
})

// Exception-match counter (Observability), labelled by the bounded exemption category.
export const exceptionMatched = Metric.counter("langlock.exception.matched", {
  description: "Count of write targets matched to an operator-owned exemption category",
  incremental: true,
})

// Audit-projection counter (Observability): content-free langlock.* audit events
// projected over the single EventV2 authority.
export const auditProjected = Metric.counter("langlock.audit.projected", {
  description: "Count of content-free langlock.* audit/advisory events projected on EventV2",
  incremental: true,
})
