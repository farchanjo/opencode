// Shared projection outcome model for the Feature 012 per-domain panel
// projections (FR4, FR8). Mirrors
// doc/arch/schemas/operator-result-signal/{enums,projection}.cue: a projection is
// a TOTAL function mapping a structured result's opaque `effective` payload onto
// one read domain's panel signal, recording how it resolved. It never throws and
// never fabricates rows — an absent payload degrades to the caller's honest
// EMPTY_*_SIGNAL as `empty_fallback`, and a malformed payload degrades to the same
// baseline as `shape_mismatch`. The consumer (Feature 012 T009) reads `.signal`;
// the `.outcome` is the observable projection record (mirrors `#PanelProjection`).

/** How a panel projection resolved (CUE `enums.cue #ProjectionOutcome`, FR4, FR8). */
export type ProjectionOutcome = "projected" | "empty_fallback" | "shape_mismatch"

/** One panel projection result: the outcome plus the resulting panel signal (CUE `projection.cue #PanelProjection`). */
export interface PanelProjection<Signal> {
  readonly outcome: ProjectionOutcome
  readonly signal: Signal
}

/** A valid effective payload projected into a typed signal (FR4). */
export function projected<Signal>(signal: Signal): PanelProjection<Signal> {
  return { outcome: "projected", signal }
}

/** Absent/unavailable effective → the honest empty baseline (FR8). */
export function emptyFallback<Signal>(empty: Signal): PanelProjection<Signal> {
  return { outcome: "empty_fallback", signal: empty }
}

/** Malformed effective → the honest empty baseline, never a throw (FR8). */
export function shapeMismatch<Signal>(empty: Signal): PanelProjection<Signal> {
  return { outcome: "shape_mismatch", signal: empty }
}

/** Narrow an opaque payload to a plain object (arrays and null excluded). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True when `value` is a present (non-null/undefined) opaque payload — the absence gate before any shape check. */
export function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null
}

export * as OperatorProjection from "./projection"
