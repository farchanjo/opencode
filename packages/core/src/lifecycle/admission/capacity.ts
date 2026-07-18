/**
 * Feature 002 / T019 — Capacity signals surface.
 *
 * Measured CPU/mem/provider/SQLite/event-queue/OTEL saturation is an explicit,
 * overridable data-constant surface (FR2, FR34, C11) rather than an inlined
 * threshold buried inside the admission algorithm. This module owns:
 *   - the `Admission.CapacitySignals` shape (reused from schema, not
 *     redeclared) and an explicit "unmeasured" default (never a fabricated
 *     reading);
 *   - the scope -> signal mapping used to decide which measured signal gates
 *     a given `AdmissionScope`;
 *   - the saturation-reject threshold, exported as a named constant so
 *     nothing hardcodes it inline.
 *
 * Zero framework deps: no I/O. Real CPU/mem/provider/SQLite/queue measurement
 * adapters are wired at the application layer (Feature 002 Phase 3); this
 * module only defines the pure data surface and the threshold decision over
 * it, per plan.md's `capacity.ts # measured CPU/mem/provider/SQLite/event-queue/
 * OTEL/queue signals (FR2)`.
 */
export * as Capacity from "./capacity"

import type { Admission } from "@opencode-ai/schema/lifecycle/admission"
import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"

/**
 * "No measurement taken yet" default — zero saturation is never fabricated as
 * a positive reading; callers that have not wired a real capacity reader get
 * this explicit, named baseline instead of an implicit `0` scattered inline.
 */
export const UNMEASURED_CAPACITY_SIGNALS: Admission.CapacitySignals = {
  cpu_saturation: 0,
  mem_saturation: 0,
  provider_saturation: 0,
  sqlite_saturation: 0,
  event_queue_saturation: 0,
  otel_queue_saturation: 0,
}

/**
 * Saturation at/above this confidence gates new admission for the mapped
 * scope (queued, never a silent unbounded grant). Overridable — never
 * inlined into `isSaturated` callers.
 */
export const SATURATION_REJECT_THRESHOLD = 0.95

const SIGNAL_KEYS = [
  "cpu_saturation",
  "mem_saturation",
  "provider_saturation",
  "sqlite_saturation",
  "event_queue_saturation",
  "otel_queue_saturation",
] as const satisfies ReadonlyArray<keyof Admission.CapacitySignals>

/** Worst (highest) saturation across every measured signal. */
export function worstSaturation(signals: Admission.CapacitySignals): number {
  let worst = 0
  for (const key of SIGNAL_KEYS) {
    const value = signals[key]
    if (Number.isFinite(value) && value > worst) worst = value
  }
  return worst
}

/**
 * Scopes with a directly-measured signal read that signal; every other scope
 * (global/root/session/child/agent/tool/token/cost) has no single owning
 * resource, so it reads the worst measured signal instead of guessing one
 * (C11, FR2).
 */
const DIRECT_SIGNAL: Partial<Record<EnumsObservation.AdmissionScope, keyof Admission.CapacitySignals>> = {
  provider: "provider_saturation",
  sqlite: "sqlite_saturation",
  event_queue: "event_queue_saturation",
  otel_queue: "otel_queue_saturation",
}

/** Saturation reading that gates admission for one `AdmissionScope` (C11). */
export function saturationFor(scope: EnumsObservation.AdmissionScope, signals: Admission.CapacitySignals): number {
  const field = DIRECT_SIGNAL[scope]
  return field ? signals[field] : worstSaturation(signals)
}

/**
 * True when the scope's measured saturation is at/above `threshold`
 * (default `SATURATION_REJECT_THRESHOLD`). The admission controller consults
 * this before touching the token bucket so a saturated resource produces
 * observable backpressure instead of draining tokens it cannot service.
 */
export function isSaturated(
  scope: EnumsObservation.AdmissionScope,
  signals: Admission.CapacitySignals,
  threshold: number = SATURATION_REJECT_THRESHOLD,
): boolean {
  return saturationFor(scope, signals) >= threshold
}
