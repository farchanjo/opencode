/**
 * Feature 004 — Application Ports (Lang Lock: Configurable Artifact-Language
 * Enforcement)
 *
 * These interfaces define the inbound ports owned by Feature 004. They are
 * implemented by the domain policy/detection engine
 * (`packages/core/src/langlock/**`) and application adapters
 * (`packages/opencode/src/langlock/**`, `packages/opencode/src/operator/
 * langlock/**`), and are consumed by Feature 007 operator control-plane
 * adapters (Settings/CLI/TUI/palette/native-slash) per ADR-0003 and ADR-0005.
 * Feature 004 never registers a parallel command registry, event bus, config
 * store, or translation authority (C2, C3, C8; plan.md "Non-goals").
 *
 * Domain: canonical BCP 47 tag validation and allowlisting (FR4, C13), global
 * base / permission-gated project override resolution with a non-relaxable
 * hard-policy floor (FR5, C2), advisory-only post-write language detection
 * confined to confidently classified prose (FR16, FR20, FR21, C5, C6), and
 * the `langlock.status|show|set|reset` reserved operator command surface
 * (FR31-FR35, C3). Every mutation (set/reset) requires an operator
 * principal, explicit scope, version/CAS, and audit; detection/advisory
 * observation never gates a write or blocks a hot path (FR21, C6).
 *
 * Wire-shape source of truth: `doc/arch/schemas/langlock/*.cue` (ids.cue,
 * enums.cue, allowlist.cue, policy.cue, effective.cue, detection.cue,
 * exception.cue, events.cue — plan.md "New module tree target"). This file
 * is the TypeScript mirror; it does not redefine event payload schemas owned
 * by `packages/schema/src/langlock/*`.
 */

import type { Effect } from "effect"

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
// Closed enums (wire shape: doc/arch/schemas/langlock/enums.cue)
// =============================================================================

/**
 * The four scopes over which a Lang Lock policy resolves (FR5, C2). Default
 * scope for `langlock.*` keys is `project`; `global` is the copy-on-write
 * base authority; `root`/`session` identify the execution envelope the
 * resolved policy is stamped into, never a separate config authority.
 */
export type Scope = "global" | "project" | "root" | "session"

/** Where an effective value was sourced from; never implies a second store (FR7, C2). */
export type Origin = "default" | "global" | "project"

/**
 * V1 ships `advisory` only; `strict_deferred` names the future mode without
 * shipping it — strict blocking requires a separately approved policy and ADR
 * revision (FR16, FR22, C5, C14).
 */
export type EnforcementMode = "advisory" | "strict_deferred"

/** Path-kind classification gating advisory eligibility; generic code is never a detection target (FR20, C5). */
export type PathKind = "prose" | "generic_code" | "exempt"

/** Bounded confidence bucket recorded content-free alongside a detection outcome (FR21). */
export type ConfidenceBucket = "high" | "medium" | "low" | "unknown"

/** Detector outcome provenance; `unavailable` never blocks the prompt/execution/tool hot path (FR21, NFR Availability). */
export type DetectorProvenance = "deterministic_signal" | "unavailable" | "not_applicable"

/** Advisory follow-up state; `none` is the default until an operator/authorized target acts (C5, C6). */
export type RemediationStatus = "none" | "acknowledged" | "suppressed"

/** Operator-owned exemption categories matched by the manifest before use (FR14, C16). */
export type ExceptionCategory =
  | "i18n_resource"
  | "vendor_generated"
  | "lockfile"
  | "legal_text"
  | "external_contract"
  | "golden_fixture"
  | "exact_string"

/** The four independent language axes; changing `artifact` never alters the other three (FR2, C1). */
export type Axis = "ui_locale" | "product_i18n" | "conversational" | "artifact"

/**
 * The advisory validation lifecycle (plan.md "State machines" → "Advisory
 * validation lifecycle", C5, C6). `exempt`, `not_eligible`, `compliant`, and
 * `unknown` are absorbing; `advisory_flagged` is followed by an operator-
 * driven `acknowledged` or `suppressed` outcome.
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
 * Enforcement-envelope-stamping contexts (FR9, FR18, FR19, C4, C10). Every
 * value maps to a seam enumerated in plan.md "Packages and modules"; none is
 * a model-controlled tool argument.
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
// langlock.* event vocabulary (wire shape: doc/arch/schemas/langlock/events.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and replay through `EventV2.readAggregate` (C8). Policy
 * mutation audit, override authorization outcomes, exception-use audit, and
 * advisory-flag/remediation checkpoints; queryable via `AdvisoryPort.list`
 * and never coalesced or dropped.
 */
export const DURABLE_LANGLOCK_EVENT_TYPES = [
  "langlock.policy_set",
  "langlock.policy_reset",
  "langlock.override_authorized",
  "langlock.override_denied",
  "langlock.exception_matched",
  "langlock.advisory_flagged",
  "langlock.advisory_acknowledged",
  "langlock.advisory_suppressed",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay). Non-blocking
 * advisory-lifecycle deltas and injection/stamping observations only (C8).
 */
export const LIVE_LANGLOCK_EVENT_TYPES = [
  "langlock.written",
  "langlock.classified",
  "langlock.exempt",
  "langlock.not_eligible",
  "langlock.detected",
  "langlock.compliant",
  "langlock.detection_unknown",
  "langlock.injection_applied",
  "langlock.injection_reapplied",
  "langlock.envelope_stamped",
] as const

export type DurableLangLockEventType = (typeof DURABLE_LANGLOCK_EVENT_TYPES)[number]
export type LiveLangLockEventType = (typeof LIVE_LANGLOCK_EVENT_TYPES)[number]

/** The 18-member closed `langlock.*` event vocabulary (C8). */
export type LangLockEventType = DurableLangLockEventType | LiveLangLockEventType

// =============================================================================
// Policy and effective config (wire shape: doc/arch/schemas/langlock/policy.cue, effective.cue)
// =============================================================================

/**
 * Redacted effective policy read model surfaced by `langlock.status`/
 * `langlock.show` and stamped into the execution envelope (FR7, FR35, C4,
 * C11). Never file text, prompt, or path content.
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
// LangLockPolicyPort — resolve / set / reset (C2, C3)
// =============================================================================

/**
 * Backs the reserved `langlock.status|show|set|reset` operator command
 * surface (C3, registered via Feature 007; Feature 004 supplies only these
 * typed domain implementations, ADR-0003). Global configuration is the base
 * authority; a project override applies only when `langlock.override` is
 * authorized and never relaxes the global hard-policy floor (FR5, FR34,
 * Security 1, AC5-AC6). Session, user, LLM, agent, plugin, MCP, and
 * custom-command mutation is prohibited (FR6) — this port has no unauthenticated
 * or LLM-reachable entry point.
 */
export interface LangLockPolicyPort {
  /** Backs `langlock.status` and `langlock.show` (show-effective alias, C3); redacted, content-free (FR7, FR35). */
  readonly resolve: (input: PolicyResolveInput) => Effect.Effect<PolicyResolveOutput, LangLockPolicyError>

  /** Backs `langlock.set`; scope/CAS/idempotency/audit; override-gated for `project` scope (FR34, C2, AC5-AC6). */
  readonly set: (input: PolicySetInput) => Effect.Effect<PolicySetOutput, LangLockPolicyError>

  /** Backs `langlock.reset`; reverts to the global/default policy; CAS/idempotency/audit (FR34). */
  readonly reset: (input: PolicyResetInput) => Effect.Effect<PolicyResetOutput, LangLockPolicyError>
}

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
// DetectionPort — classify (advisory-only, C5, C6)
// =============================================================================

/**
 * Post-write advisory detection confined to confidently classified prose path
 * kinds (Markdown, docs, instruction files, generated commit text); generic
 * source code is never a detection target in V1 and a detector failure/
 * unknown outcome never blocks the prompt, execution, or tool hot path
 * (FR16, FR20, FR21, C5, C6, NFR Availability). This port never gates,
 * blocks, or autotranslates a write (Out of Scope).
 */
export interface DetectionPort {
  /** Classify one model-authored artifact context for a content-free advisory signal. */
  readonly classify: (input: DetectionClassifyInput) => Effect.Effect<DetectionClassifyOutput, DetectionError>
}

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
// AdvisoryPort — record / list / ack (FR21, C5, C6)
// =============================================================================

/**
 * Content-free advisory persistence and remediation follow-up, backing the
 * `advisory_flagged -> acknowledged | suppressed` branch of the advisory
 * lifecycle (plan.md "State machines"). Never gates a write; TUI/App/CLI
 * surfacing and repeat-warning suppression are plan-owned with acceptance
 * hook AC8.
 */
export interface AdvisoryPort {
  /** Record a content-free outcome produced by `DetectionPort.classify` (FR21). */
  readonly record: (input: AdvisoryRecordInput) => Effect.Effect<AdvisoryRecordOutput, AdvisoryError>

  /** Bounded, cursor-paginated, redacted advisory history for an authorized scope. */
  readonly list: (input: AdvisoryListInput) => Effect.Effect<AdvisoryListOutput, AdvisoryError>

  /** Operator/authorized-target acknowledge or repeat-warning suppress on a flagged advisory (C5, C6). */
  readonly ack: (input: AdvisoryAckInput) => Effect.Effect<AdvisoryAckOutput, AdvisoryError>
}

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
