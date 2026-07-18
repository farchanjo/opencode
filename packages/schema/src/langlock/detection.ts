export * as Detection from "./detection"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/detection.cue one-to-one. The content-free
// advisory-detection shapes (FR20, FR21, C5, C6). Advisory detection runs only on
// confidently classified prose and NEVER gates the write; generic source code is
// never blocked in V1 (FR20, C14, AC11). A record carries no file text, diff,
// prompt or path — only bounded enums plus an opaque execution_id (FR21,
// Security 5). Detector unknown/failure is a recorded outcome that never blocks a
// hot path (FR21, NFR Availability).

// DetectorClassification carries the path kind, detector provenance and confidence bucket (FR20, FR21, C5).
export const DetectorClassification = Schema.Struct({
  path_kind: Enums.PathKind,
  provenance: Enums.DetectorProvenance,
  confidence: Enums.ConfidenceBucket, // bucket, never a raw score (AC14)
}).annotate({ identifier: "LangLockDetection.DetectorClassification" })
export type DetectorClassification = Schema.Schema.Type<typeof DetectorClassification>

// DetectorResult is the content-free outcome of one advisory detection pass (FR21, C5, AC14).
export const DetectorResult = Schema.Struct({
  classification: DetectorClassification,
  policy_version: Values.PolicyVersion,
  remediation: Enums.RemediationStatus,
  detected_tag: Schema.NullOr(Ids.LanguageTag), // null on unknown/failure (FR21, C5)
}).annotate({ identifier: "LangLockDetection.DetectorResult" })
export type DetectorResult = Schema.Schema.Type<typeof DetectorResult>

// AdvisoryRecord binds a detector result to its execution context; it never gates the write (FR21, C6, AC8).
export const AdvisoryRecord = Schema.Struct({
  result: DetectorResult,
  expected_tag: Ids.LanguageTag,
  execution_id: Ids.ExecutionId, // opaque correlation only (Observability)
  reason: TextValues.Reason, // bounded; no content (Security 5)
}).annotate({ identifier: "LangLockDetection.AdvisoryRecord" })
export type AdvisoryRecord = Schema.Schema.Type<typeof AdvisoryRecord>
