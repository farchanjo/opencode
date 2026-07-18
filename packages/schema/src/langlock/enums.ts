export * as Enums from "./enums"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/enums.cue (package langlock.enums) one-to-one
// for the core policy/detection closed enums (FR2, FR7, FR16, FR20, FR21, C1,
// C5). Event/actor enums live in ./enums-event; the closed langlock.* vocabulary
// lives in ./event-types. Every enum is a ValueObject, never an Entity.

// Scope bounds ownership/visibility of a policy; the langlock.* default scope is project (FR5, C2).
export const Scope = Schema.Literals(["global", "project", "root", "session"]).annotate({
  identifier: "LangLockEnums.Scope",
})
export type Scope = typeof Scope.Type

// Origin names the source that produced the effective value (FR7).
export const Origin = Schema.Literals(["default", "global", "project", "managed"]).annotate({
  identifier: "LangLockEnums.Origin",
})
export type Origin = typeof Origin.Type

// EnforcementMode is advisory in V1; strict blocking is deferred (FR16, FR22, C5, C14).
export const EnforcementMode = Schema.Literals(["advisory", "strict_deferred"]).annotate({
  identifier: "LangLockEnums.EnforcementMode",
})
export type EnforcementMode = typeof EnforcementMode.Type

// Axis names the four independent language axes; Lang Lock governs only artifact (FR2, C1).
export const Axis = Schema.Literals(["ui_locale", "product_docs", "conversational", "artifact"]).annotate({
  identifier: "LangLockEnums.Axis",
})
export type Axis = typeof Axis.Type

// PathKind classifies a write target for advisory eligibility; generic code is never blocked (FR20, C5).
export const PathKind = Schema.Literals([
  "prose_markdown",
  "docs",
  "instruction_file",
  "commit_text",
  "generic_code",
  "exempt",
  "unknown",
]).annotate({ identifier: "LangLockEnums.PathKind" })
export type PathKind = typeof PathKind.Type

// ConfidenceBucket is a bounded detector-confidence bucket; no raw score is exported (FR21, C5, AC14).
export const ConfidenceBucket = Schema.Literals(["low", "medium", "high", "unknown"]).annotate({
  identifier: "LangLockEnums.ConfidenceBucket",
})
export type ConfidenceBucket = typeof ConfidenceBucket.Type

// DetectorProvenance names the advisory detector that produced a result; content-free (FR21, C5).
export const DetectorProvenance = Schema.Literals(["heuristic", "statistical", "declared", "none"]).annotate({
  identifier: "LangLockEnums.DetectorProvenance",
})
export type DetectorProvenance = typeof DetectorProvenance.Type

// RemediationStatus tracks the advisory follow-up; it never gates the write (FR21, C6, AC8).
export const RemediationStatus = Schema.Literals(["none", "flagged", "acknowledged", "suppressed"]).annotate({
  identifier: "LangLockEnums.RemediationStatus",
})
export type RemediationStatus = typeof RemediationStatus.Type

// ExceptionCategory bounds the operator-owned exemption kinds (FR14, C16).
export const ExceptionCategory = Schema.Literals([
  "i18n_resource",
  "vendor_generated",
  "lockfile",
  "legal",
  "external_contract",
  "golden_fixture",
  "exact_string",
]).annotate({ identifier: "LangLockEnums.ExceptionCategory" })
export type ExceptionCategory = typeof ExceptionCategory.Type
