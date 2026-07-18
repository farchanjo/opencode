/**
 * Feature 004 / T028 (S13) — post-write advisory validation on classified prose.
 *
 * Runs advisory detection ONLY on confidently classified, model-authored prose
 * over the framework-free domain (`PathKind` + `AdvisoryDetector`), records a
 * content-free outcome (path-kind / confidence bucket / detector provenance /
 * policy version / remediation status), NEVER gates or blocks the write, and
 * NEVER rewrites a mixed-language file or retrotranslates untouched content (FR8,
 * FR10, FR20, FR21, C5, C6, C12, AC8, AC11, AC20). Mirrors the "Advisory
 * validation lifecycle" statechart.
 *
 * The validator is a thin application seam over the domain: it never issues a
 * translation-model call and never reads file text — only the bounded structural
 * signals about the target and the injected deterministic detector port
 * (Security 5). Generic source code, exempt targets, and untouched
 * (non-model-authored) portions are never detection targets and yield a
 * `not_eligible` outcome without calling the detector.
 */
export * as LangLockAdvisoryValidator from "./advisory-validator"

import { PathKind } from "@opencode-ai/core/langlock/path-kind"
import { AdvisoryDetector } from "@opencode-ai/core/langlock/advisory-detector"
import type {
  ConfidenceBucket,
  DetectorProvenance,
  PathKind as PathKindEnum,
  RemediationStatus,
} from "@opencode-ai/schema/langlock/enums"

/** The bounded, content-free structural signals about a post-write target (Security 5). */
export interface AdvisoryValidateInput {
  /** Lower-case file extension without the dot (empty for none). */
  readonly extension: string
  readonly isInstructionFile?: boolean
  readonly isCommitText?: boolean
  readonly isExempt?: boolean
  /** True only for model-created or model-modified portions (FR10, AC20). */
  readonly modelAuthored: boolean
  /** The effective lock tag the artifact is expected to match. */
  readonly expectedTag: string
  /** The policy version captured for this validation, recorded content-free. */
  readonly policyVersion: number
}

/**
 * The content-free advisory validation record (FR21, C5, C6, AC8). Never carries
 * artifact text, diff, prompt, message, path, snippet, reasoning, or tool
 * payload. `blocked` is always `false` — advisory detection never gates a write
 * (FR20, C6).
 */
export interface AdvisoryValidation {
  readonly outcome: "not_eligible" | "compliant" | "flagged" | "unknown"
  readonly pathKind: PathKindEnum
  readonly confidence: ConfidenceBucket
  readonly provenance: DetectorProvenance
  readonly remediation: RemediationStatus
  readonly policyVersion: number
  /** Invariant: advisory detection is observation only and never blocks the write. */
  readonly blocked: false
}

/** Map an advisory outcome onto its initial remediation status (FR21, AC8). */
function remediationFor(outcome: AdvisoryValidation["outcome"]): RemediationStatus {
  return outcome === "flagged" ? "flagged" : "none"
}

/**
 * Validate one model-authored artifact context post-write (FR8, FR20, FR21, C5,
 * C6, AC8, AC11, AC20). Deterministic and total: it returns exactly one
 * content-free record and never throws or blocks. A non-advisory-target (generic
 * code / exempt / untouched) short-circuits to `not_eligible` without invoking
 * the detector; an eligible prose kind is classified through the domain detector.
 */
export function validateAdvisory(
  input: AdvisoryValidateInput,
  port: AdvisoryDetector.DetectorPort,
  options?: AdvisoryDetector.DetectOptions,
): AdvisoryValidation {
  const pathKind = PathKind.classify(input)
  const isTarget = PathKind.isAdvisoryTarget({ ...input, modelAuthored: input.modelAuthored })

  if (!isTarget) {
    return content({
      outcome: "not_eligible",
      pathKind,
      confidence: "unknown",
      provenance: "none",
      policyVersion: input.policyVersion,
    })
  }

  const detection = AdvisoryDetector.detectAdvisory(
    { path_kind: pathKind, expected_tag: input.expectedTag },
    port,
    options,
  )

  switch (detection.kind) {
    case "not_eligible":
      return content({ outcome: "not_eligible", pathKind, confidence: "unknown", provenance: "none", policyVersion: input.policyVersion })
    case "compliant":
      return content({ outcome: "compliant", pathKind, confidence: detection.confidence, provenance: detection.provenance, policyVersion: input.policyVersion })
    case "flagged":
      return content({ outcome: "flagged", pathKind, confidence: detection.confidence, provenance: detection.provenance, policyVersion: input.policyVersion })
    case "unknown":
      return content({ outcome: "unknown", pathKind, confidence: detection.confidence, provenance: detection.provenance, policyVersion: input.policyVersion })
  }
}

/** Assemble the content-free record with the never-block invariant and derived remediation. */
function content(input: {
  readonly outcome: AdvisoryValidation["outcome"]
  readonly pathKind: PathKindEnum
  readonly confidence: ConfidenceBucket
  readonly provenance: DetectorProvenance
  readonly policyVersion: number
}): AdvisoryValidation {
  return {
    outcome: input.outcome,
    pathKind: input.pathKind,
    confidence: input.confidence,
    provenance: input.provenance,
    remediation: remediationFor(input.outcome),
    policyVersion: input.policyVersion,
    blocked: false,
  }
}
