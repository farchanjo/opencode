/**
 * Feature 004 / T019 (S8) — deterministic advisory language-signal contract.
 *
 * Framework-free, deterministic, zero I/O in the hot logic. Implements the advisory
 * detection contract over the injected `DetectorPort`: it produces a
 * `ConfidenceBucket` plus `DetectorProvenance` for an eligible prose kind, records an
 * `unknown` outcome on detector failure that NEVER blocks the prompt/execution/tool
 * hot path, and NEVER issues a translation-model call (FR16, FR21, C5, C6, AC8,
 * AC11). Mirrors `detection.cue`. Advisory detection is observation only — it never
 * gates a write (FR20, C6).
 */
export * as AdvisoryDetector from "./advisory-detector"

import type { ConfidenceBucket, DetectorProvenance, PathKind } from "@opencode-ai/schema/langlock/enums"
import { isAdvisoryEligible } from "./path-kind"

/**
 * The provisional minimum confidence at which a language mismatch is recorded as a
 * flag (data-model.md `advisory_min_confidence`, AC8). Overridable data, never
 * inlined; a mismatch below this bucket is not flagged.
 */
export const DEFAULT_ADVISORY_MIN_CONFIDENCE: ConfidenceBucket = "medium"

/** Ordered confidence buckets for the minimum-confidence comparison (AC8, AC14). */
const CONFIDENCE_ORDER: ReadonlyArray<ConfidenceBucket> = ["low", "medium", "high"]

function meetsMinimum(bucket: ConfidenceBucket, minimum: ConfidenceBucket): boolean {
  const observed = CONFIDENCE_ORDER.indexOf(bucket)
  const floor = CONFIDENCE_ORDER.indexOf(minimum)
  return observed >= 0 && floor >= 0 && observed >= floor
}

/** A content-free language signal produced by the injected detector (FR21, C5, AC14). */
export interface DetectorSignal {
  /** The detected canonical tag, or `null` on an unknown/failed detection (FR21, C5). */
  readonly detected_tag: string | null
  readonly confidence: ConfidenceBucket
  readonly provenance: DetectorProvenance
}

/** The content-free inputs handed to the injected detector (no file text; Security 5). */
export interface DetectorRequest {
  readonly path_kind: PathKind
  readonly expected_tag: string
}

/**
 * The injected deterministic detector port (FR16, FR21, C5, C6). It returns a
 * content-free `DetectorSignal`, or `null` / throws to signal a failure — either is
 * absorbed as an `unknown` outcome that never blocks. The port NEVER performs a
 * translation-model call (C6, Out of Scope).
 */
export interface DetectorPort {
  readonly detect: (request: DetectorRequest) => DetectorSignal | null
}

/** Tuning for a detection pass; the minimum confidence to record a flag (AC8). */
export interface DetectOptions {
  readonly minConfidence?: ConfidenceBucket
}

/**
 * The advisory-detection outcome (plan.md "Advisory validation lifecycle", C5, C6).
 * All variants are non-blocking observations.
 *   - `not_eligible`: the path kind is not advisory-eligible (generic code, exempt) —
 *     never a detection target (FR20, C5, AC11).
 *   - `compliant`: the detected language matches the expected lock tag.
 *   - `flagged`: a language mismatch at or above the minimum confidence (AC8).
 *   - `unknown`: a low-confidence signal or a detector failure/unknown; recorded,
 *     never blocking (FR21, NFR Availability).
 */
export type AdvisoryOutcome =
  | { readonly kind: "not_eligible"; readonly path_kind: PathKind }
  | { readonly kind: "compliant"; readonly confidence: ConfidenceBucket; readonly provenance: DetectorProvenance }
  | {
      readonly kind: "flagged"
      readonly detected_tag: string
      readonly confidence: ConfidenceBucket
      readonly provenance: DetectorProvenance
    }
  | { readonly kind: "unknown"; readonly confidence: ConfidenceBucket; readonly provenance: DetectorProvenance }

/**
 * Run advisory detection for one model-authored artifact context (FR16, FR21, C5,
 * C6, AC8, AC11). Deterministic and total: it returns exactly one `AdvisoryOutcome`
 * and never throws — a detector that returns `null` or throws is absorbed as
 * `unknown`, so detection never blocks the hot path. It runs only on an
 * advisory-eligible prose kind; a non-eligible kind short-circuits to `not_eligible`
 * without calling the detector. No translation-model call is ever issued (C6).
 */
export function detectAdvisory(
  request: DetectorRequest,
  port: DetectorPort,
  options?: DetectOptions,
): AdvisoryOutcome {
  if (!isAdvisoryEligible(request.path_kind)) {
    return { kind: "not_eligible", path_kind: request.path_kind }
  }

  const minimum = options?.minConfidence ?? DEFAULT_ADVISORY_MIN_CONFIDENCE
  let signal: DetectorSignal | null
  try {
    signal = port.detect(request)
  } catch {
    signal = null
  }

  if (signal === null || signal.detected_tag === null || signal.confidence === "unknown") {
    const confidence = signal?.confidence ?? "unknown"
    const provenance = signal?.provenance ?? "none"
    return { kind: "unknown", confidence, provenance }
  }

  if (signal.detected_tag === request.expected_tag) {
    return { kind: "compliant", confidence: signal.confidence, provenance: signal.provenance }
  }

  if (!meetsMinimum(signal.confidence, minimum)) {
    return { kind: "unknown", confidence: signal.confidence, provenance: signal.provenance }
  }

  return {
    kind: "flagged",
    detected_tag: signal.detected_tag,
    confidence: signal.confidence,
    provenance: signal.provenance,
  }
}
