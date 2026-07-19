export * as NativeInstruments from "./native-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../../observability/telemetry-instruments"

// Feature 010 / T019 (S16) — native FFI backend-selection telemetry (Observability,
// FR23, FR24, C14, AC17).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP foundation
// (bounded async sink, drop-oldest/drop backpressure, redaction) stays the only export
// path. Every metric is content-free — only bounded enums and counts. No file
// contents, paths, patch bodies, command strings, or session ids ever appear as a
// label (Security, ADR-0001, C14, AC17); those stay in traces/logs. Every dynamic
// value is passed through `boundEnum` at record time so a label never exceeds its
// bounded budget (mirrors `langlock/langlock-instruments.ts` and
// `lifecycle/lifecycle-instruments.ts`).

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans ----------------------------------------------------------
// The two native.* concept spans. They link to — never replace — the Feature 001
// concept span `tool.execute`; Feature 010 runs no second executor (C14). The PTY
// lifecycle is observed under `native.pty` with bounded lifecycle-phase labels.

export const SpanName = {
  invoke: "native.invoke",
  pty: "native.pty",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

/** The existing span the native.* spans correlate with (Observability, C14). */
export const CorrelatedSpanName = {
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ----------------------------------------------------
// Local literals mirroring `doc/arch/schemas/ffi/*.cue` / `data-model.md` so this
// module carries no cross-package dependency; the CUE corpus stays the source of
// truth for the value sets. Every dynamic value is bounded at record time.

export const Labels = {
  // The six native built-ins plus the PTY surface (mirrors CUE `#NativeToolName` + `pty`).
  tool: ["read", "write", "edit", "apply_patch", "glob", "grep", "pty"] as const,
  // Which implementation served the call (CUE `#NativeBackend`).
  backend: ["native", "typescript"] as const,
  // Why the native path was unavailable (CUE `#NativeUnavailableGapReason`).
  gap_reason: ["library_missing", "dlopen_failed", "abi_mismatch", "disabled"] as const,
  // The PTY session lifecycle phase (bounded, never a session id).
  pty_phase: ["spawn", "kill", "close"] as const,
} as const

/** A content-free backend-selection observation: bounded tool + backend (+ gap reason). */
export interface BackendSelection {
  readonly tool: string
  readonly backend: string
  readonly gap_reason?: string
}

/**
 * Bound a backend-selection observation to the label allowlists so no unbounded value
 * ever reaches the exporter (C14, AC17). An off-allowlist value collapses to `OTHER`.
 */
export function selectionLabels(input: BackendSelection): {
  readonly tool: string
  readonly backend: string
  readonly gap_reason: string
} {
  return {
    tool: boundEnum(Labels.tool, input.tool),
    backend: boundEnum(Labels.backend, input.backend),
    gap_reason: input.gap_reason === undefined ? OTHER : boundEnum(Labels.gap_reason, input.gap_reason),
  }
}

/** Bound a PTY lifecycle phase to the allowlist (spawn/kill/close), never a session id. */
export function ptyPhaseLabel(phase: string): string {
  return boundEnum(Labels.pty_phase, phase)
}

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its export
// interval (C14). Names namespaced under `native.*`.

// Backend-selection counter (Observability): every tool call that resolved to either
// the native path or the TypeScript fallback, labelled by the bounded `tool`/`backend`.
export const backendSelected = Metric.counter("native.backend.selected", {
  description: "Count of tool calls served by the native or TypeScript backend (labelled tool/backend)",
  incremental: true,
})

// Native-unavailable gap counter (Observability): every fallback to TypeScript with the
// bounded `gap_reason` (library_missing/dlopen_failed/abi_mismatch/disabled). Mirrors
// the Feature 006 `milvus_unavailable` capability-gap posture (C14).
export const nativeUnavailable = Metric.counter("native.unavailable", {
  description: "Count of native_unavailable capability gaps (labelled tool/gap_reason)",
  incremental: true,
})

// PTY lifecycle counters (Observability): spawn/kill/close counts as bounded enums; no
// raw command string, path, or session id is ever a label (C14, C20).
export const ptySpawned = Metric.counter("native.pty.spawned", {
  description: "Count of native PTY sessions spawned",
  incremental: true,
})
export const ptyKilled = Metric.counter("native.pty.killed", {
  description: "Count of native PTY sessions killed (one killpg per call)",
  incremental: true,
})
export const ptyClosed = Metric.counter("native.pty.closed", {
  description: "Count of native PTY sessions closed (idempotent single-owner teardown)",
  incremental: true,
})
