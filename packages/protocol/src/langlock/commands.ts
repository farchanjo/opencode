/**
 * Feature 004 — Lang Lock protocol payloads (T015).
 *
 * TypeScript mirror of the shared identifiers, closed enums, the 15-member
 * `langlock.*` event vocabulary (durable/live split), the request/response
 * payloads, and the typed `LangLockPolicyError`/`DetectionError`/`AdvisoryError`
 * unions from
 * doc/arch/sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/contracts/ports.ts
 * (FR7, FR21, FR34, FR35, C2, C3, C6, C8). The `LangLockPolicyPort`/
 * `DetectionPort`/`AdvisoryPort` interfaces live in ./ports — this file defines
 * only the payload shapes they consume.
 *
 * Single-vocabulary discipline (T015): the closed enums whose authority is the
 * CUE corpus (doc/arch/schemas/langlock/*.cue) — `Scope`, `Origin`,
 * `EnforcementMode`, `Axis`, `PathKind`, `ConfidenceBucket`, `DetectorProvenance`,
 * `RemediationStatus`, `ExceptionCategory` and the 15-member `LangLockEventType`
 * — are SOURCED from `@opencode-ai/schema/langlock/*` rather than re-declared, so
 * the transport contract can never diverge from the wire shape. This mirror never
 * redefines the `packages/schema/src/langlock/*` event payload schemas (C8). The
 * camelCase protocol shapes here are the operator-surface projection consumed by
 * Feature 007 adapters, distinct from the persisted snake_case domain records.
 */

import type {
  Axis as SchemaAxis,
  ConfidenceBucket as SchemaConfidenceBucket,
  DetectorProvenance as SchemaDetectorProvenance,
  EnforcementMode as SchemaEnforcementMode,
  ExceptionCategory as SchemaExceptionCategory,
  Origin as SchemaOrigin,
  PathKind as SchemaPathKind,
  RemediationStatus as SchemaRemediationStatus,
  Scope as SchemaScope,
} from "@opencode-ai/schema/langlock/enums"
import type { LangLockEventType as SchemaLangLockEventType } from "@opencode-ai/schema/langlock/event-types"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/langlock/ids.cue)
// =============================================================================

/** Canonical BCP 47 tag validated via `Intl.getCanonicalLocales` plus the allowlist (FR1, FR4). */
export type LanguageTag = string

/** Human/native picker label; never the canonical tag, technical slug, or charset name (FR4, C13). */
export type DisplayName = string

/** Monotonic policy version captured into the execution envelope at start (FR7, FR26, C11). */
export type PolicyVersion = number

/** Config.Service key-space version distinct from the domain `PolicyVersion` (C2). */
export type ConfigVersion = number

export type PolicyId = string
export type AdvisoryId = string
export type ExceptionId = string

// =============================================================================
// Closed enums — SOURCED from @opencode-ai/schema/langlock/* (T015, single vocabulary)
// =============================================================================

/** The four scopes over which a Lang Lock policy resolves; default `project` (FR5, C2). */
export type Scope = SchemaScope

/** Where an effective value was sourced from; the 4-member CUE authority (FR7, C2). */
export type Origin = SchemaOrigin

/** V1 ships `advisory` only; `strict_deferred` names the deferred mode (FR16, FR22, C5, C14). */
export type EnforcementMode = SchemaEnforcementMode

/** The four independent language axes; changing `artifact` never alters the other three (FR2, C1). */
export type Axis = SchemaAxis

/** Path-kind classification gating advisory eligibility; the 7-member CUE authority (FR20, C5). */
export type PathKind = SchemaPathKind

/** Bounded confidence bucket recorded content-free alongside a detection outcome (FR21). */
export type ConfidenceBucket = SchemaConfidenceBucket

/** Advisory detector provenance; content-free (FR21, C5). */
export type DetectorProvenance = SchemaDetectorProvenance

/** Advisory follow-up state; it never gates the write (FR21, C6, AC8). */
export type RemediationStatus = SchemaRemediationStatus

/** Operator-owned exemption categories matched by the manifest before use (FR14, C16). */
export type ExceptionCategory = SchemaExceptionCategory

/**
 * The advisory validation lifecycle (plan.md "State machines" → "Advisory
 * validation lifecycle", C5, C6). `exempt`, `not_eligible`, `compliant`, and
 * `unknown` are absorbing; `advisory_flagged` is followed by an operator-driven
 * `acknowledged` or `suppressed` outcome. Protocol-surface concept; not a CUE
 * schema enum.
 */
export type AdvisoryState =
  | "written"
  | "classified"
  | "exempt"
  | "not_eligible"
  | "detected"
  | "compliant"
  | "advisory_flagged"
  | "unknown"
  | "acknowledged"
  | "suppressed"

/**
 * Enforcement-envelope-stamping contexts (FR9, FR18, FR19, C4, C10). Every value
 * maps to a seam enumerated in plan.md "Packages and modules"; none is a
 * model-controlled tool argument. Protocol-surface concept; not a CUE schema enum.
 */
export type ArtifactContext =
  | "task_prompt"
  | "subagent_internal_return"
  | "write_tool"
  | "edit_tool"
  | "apply_patch_tool"
  | "shell_commit"
  | "todo_text"
  | "commit_message"

// =============================================================================
// langlock.* event vocabulary (wire shape: doc/arch/schemas/langlock/event-types.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and replay through `EventV2.readAggregate` (C8). Policy-mutation,
 * override authorization outcomes, and exception-use audit; never coalesced or
 * dropped. Reconciled to the six CUE audit members (T015) — the advisory
 * lifecycle members are LIVE, matching `@opencode-ai/schema/langlock/events-audit`.
 */
export const DURABLE_LANGLOCK_EVENT_TYPES = [
  "langlock.policy_set",
  "langlock.policy_reset",
  "langlock.override_authorized",
  "langlock.override_denied",
  "langlock.exception_registered",
  "langlock.exception_revoked",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay). Non-blocking
 * injection/reapply/stamping observations plus the advisory/detector/resolution
 * lifecycle deltas (C8), matching `@opencode-ai/schema/langlock/events-advisory`.
 */
export const LIVE_LANGLOCK_EVENT_TYPES = [
  "langlock.policy_injected",
  "langlock.policy_reapplied",
  "langlock.envelope_stamped",
  "langlock.advisory_flagged",
  "langlock.advisory_acknowledged",
  "langlock.advisory_suppressed",
  "langlock.detector_unknown",
  "langlock.resolution_retained",
  "langlock.unknown",
] as const

export type DurableLangLockEventType = (typeof DURABLE_LANGLOCK_EVENT_TYPES)[number]
export type LiveLangLockEventType = (typeof LIVE_LANGLOCK_EVENT_TYPES)[number]

/**
 * The 15-member closed `langlock.*` event vocabulary (C8), SOURCED from
 * `@opencode-ai/schema/langlock/event-types` so protocol and schema never drift.
 */
export type LangLockEventType = SchemaLangLockEventType

// =============================================================================
// Policy and effective config (wire shape: doc/arch/schemas/langlock/policy.cue, effective.cue)
// =============================================================================

/**
 * Redacted effective policy read model surfaced by `langlock.status`/
 * `langlock.show` and stamped into the execution envelope (FR7, FR35, C4, C11).
 * Never file text, prompt, or path content.
 */
export interface LangLockPolicySummary {
  readonly enabled: boolean
  readonly tag: LanguageTag
  readonly displayName: DisplayName
  readonly scope: Scope
  readonly origin: Origin
  readonly policyVersion: PolicyVersion
  readonly enforcementMode: EnforcementMode
  readonly hardPolicyFloorTag: LanguageTag
  readonly overrideAuthorized: boolean
  readonly updatedAt: string // ISO-8601
}

// =============================================================================
// Advisory record (wire shape: doc/arch/schemas/langlock/detection.cue)
// =============================================================================

/**
 * Content-free advisory outcome (FR21, C5, C6). Never carries artifact text,
 * diff, prompt, message, path, snippet, reasoning, or tool payload.
 */
export interface AdvisoryRecord {
  readonly advisoryId: AdvisoryId
  readonly policyVersion: PolicyVersion
  readonly pathKind: PathKind
  readonly confidenceBucket: ConfidenceBucket
  readonly detectorProvenance: DetectorProvenance
  readonly state: AdvisoryState
  readonly remediationStatus: RemediationStatus
  readonly createdAt: string // ISO-8601
  readonly updatedAt: string // ISO-8601
}

// =============================================================================
// Exception manifest entry (wire shape: doc/arch/schemas/langlock/exception.cue)
// =============================================================================

/**
 * Operator-owned, schema-validated exemption match record (FR14, Security 2,
 * Security 6, C16). Untrusted LLM/plugin/prompt requests can never create an
 * exception; only a match/deny result and bounded metadata are recorded.
 */
export interface ExceptionManifestEntry {
  readonly exceptionId: ExceptionId
  readonly category: ExceptionCategory
  readonly authority: "operator"
  readonly scope: Scope
  readonly result: "matched" | "denied"
  readonly recordedAt: string // ISO-8601
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to mutate policy or acknowledge advisories (C3). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// LangLockPolicyPort payloads — resolve / set / reset (C2, C3)
// =============================================================================

export interface PolicyResolveInput {
  readonly scope: Scope
  readonly scopeId: string
}

export interface PolicyResolveOutput {
  readonly policy: LangLockPolicySummary
}

export interface PolicySetInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly tag: LanguageTag
  readonly expectedVersion: PolicyVersion
  readonly principal: OperatorPrincipal
}

export interface PolicySetOutput {
  readonly policy: LangLockPolicySummary
  readonly auditId: string
}

export interface PolicyResetInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly expectedVersion: PolicyVersion
  readonly principal: OperatorPrincipal
}

export interface PolicyResetOutput {
  readonly policy: LangLockPolicySummary
  readonly auditId: string
}

export type LangLockPolicyError =
  | { readonly type: "unauthorized"; readonly reason: string } // guards Security 1, FR6, C2
  | { readonly type: "floor_violation"; readonly requestedTag: LanguageTag; readonly floorTag: LanguageTag } // guards FR5, C2
  | { readonly type: "invalid_tag"; readonly tag: string } // guards FR4, C13 canonical/allowlist rejection
  | { readonly type: "version_conflict"; readonly expectedVersion: PolicyVersion; readonly actualVersion: PolicyVersion }
  | { readonly type: "reserved_name"; readonly id: string } // guards C3 langlock.* collision
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// DetectionPort payloads — classify (advisory-only, C5, C6)
// =============================================================================

export interface DetectionClassifyInput {
  readonly pathKind: PathKind
  readonly artifactContext: ArtifactContext
  readonly policyVersion: PolicyVersion
  readonly expectedTag: LanguageTag
}

export interface DetectionClassifyOutput {
  readonly state: AdvisoryState
  readonly confidenceBucket: ConfidenceBucket
  readonly detectorProvenance: DetectorProvenance
}

export type DetectionError =
  | { readonly type: "not_eligible"; readonly pathKind: PathKind } // guards FR20 — generic code never a detection target
  | { readonly type: "detector_unavailable"; readonly reason: string } // guards FR21, NFR Availability — never blocks the hot path
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// AdvisoryPort payloads — record / list / ack (FR21, C5, C6)
// =============================================================================

export interface AdvisoryRecordInput {
  readonly policyVersion: PolicyVersion
  readonly pathKind: PathKind
  readonly confidenceBucket: ConfidenceBucket
  readonly detectorProvenance: DetectorProvenance
  readonly state: AdvisoryState
}

export interface AdvisoryRecordOutput {
  readonly advisory: AdvisoryRecord
}

export interface AdvisoryListInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly stateFilter?: AdvisoryState
  readonly limit: number
  readonly cursor?: string
}

export interface AdvisoryListOutput {
  readonly advisories: readonly AdvisoryRecord[]
  readonly cursor: string | null
}

export interface AdvisoryAckInput {
  readonly advisoryId: AdvisoryId
  readonly action: "acknowledge" | "suppress"
  readonly principal: OperatorPrincipal
}

export interface AdvisoryAckOutput {
  readonly advisory: AdvisoryRecord
}

export type AdvisoryError =
  | { readonly type: "not_found"; readonly advisoryId: AdvisoryId }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
