/**
 * Feature 013 — Budget protocol payloads (T003).
 *
 * TypeScript mirror of the budget-domain operator-surface ValueObjects from
 * doc/arch/schemas/operator-config-domains/{budget,enums,shared,persistence}.cue
 * (FR1, FR4, FR7, FR8). The `budget.*` verbs read and mutate
 * `RoutingConfig.Enforcement.budget` (packages/schema/src/routing/budget.ts,
 * seeded from `DEFAULT_ROUTING_BUDGET`) over the SAME routing Config.Service
 * authority the smart/pools domains bind; the ceiling is never silently relaxed.
 * The `BudgetPort` interface lives in ./ports — this file defines only the payload
 * shapes and the typed `BudgetError` union it consumes.
 *
 * This mirror never redefines the reused effective-config schema
 * (`packages/schema/src/routing/budget.ts`); the camelCase operator-surface view
 * here is the bounded, redacted projection consumed by Feature 007 adapters,
 * distinct from the persisted snake_case routing budget policy. No payload carries
 * a plaintext secret or a free-form command id (Feature 007 owns registration).
 */

// =============================================================================
// Shared identifiers (wire shape: operator-config-domains/shared.cue)
// =============================================================================

/** Opaque Config.Service CAS version token carried on a read/result; never parsed by the TUI (shared.cue #Version, FR7). */
export type Version = string

/** Bounded, secret-free reason carried on a typed unavailable/invalid envelope (shared.cue #ReasonText, FR8). */
export type ReasonText = string

/** Feature 007 audit correlation returned by every mutation (FR7). */
export type AuditId = string

// =============================================================================
// Closed enums (wire shape: operator-config-domains/enums.cue)
// =============================================================================

/** The reserved `budget.*` verb surface backed by the routing enforcement budget (enums.cue #BudgetVerb, FR4). */
export const BUDGET_VERBS = ["status", "show", "set", "reset", "validate"] as const
export type BudgetVerb = (typeof BUDGET_VERBS)[number]

/**
 * The typed envelope a mutation degrades to; never a fabricated success
 * (enums.cue #MutationOutcome, persistence.cue #MutationEnvelope, FR7, FR8).
 * The non-`success` members map one-for-one to the `BudgetError` discriminants.
 */
export type MutationOutcome = "success" | "version_conflict" | "invalid_argument" | "unauthorized" | "unavailable"

/**
 * The scope a budget read/mutation targets over the routing Config.Service
 * authority: `project` binds config key `routing`, `global` binds `global:routing`
 * (persistence.cue #CasExpectation.authority, FR4, FR9).
 */
export type BudgetScope = "global" | "project"

// =============================================================================
// Effective budget read model (wire shape: operator-config-domains/budget.cue)
// =============================================================================

/** One bounded non-negative limit value in the effective budget view (budget.cue #BudgetCount, FR4). */
export type BudgetCount = number

/**
 * The bounded projection of the effective turn/token limits surfaced by
 * `budget.show` (budget.cue #BudgetLimitsView, FR4). Not the full nested routing
 * budget policy — a redacted, operator-facing view of it.
 */
export interface BudgetLimitsView {
  readonly maxTurns: BudgetCount
  readonly maxContextTokens: BudgetCount
  readonly maxOutputTokens: BudgetCount
  readonly maxWorkers: BudgetCount
  readonly tokenBudget: BudgetCount
}

/**
 * The budget read model surfaced by `budget.status`/`budget.show`
 * (budget.cue #BudgetSummary, FR4). `valid` reports the outcome of
 * `budget.validate` over the effective config; never asserted blindly.
 */
export interface BudgetSummary {
  readonly configured: boolean
  readonly available: boolean
  readonly valid: boolean
  readonly limits: BudgetLimitsView
  readonly updatedAt: string // ISO-8601 (shared.cue #Iso8601)
  readonly version: Version
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to mutate the effective budget (FR7). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// BudgetPort payloads — status / show / set / reset / validate (FR4, FR7)
// =============================================================================

export interface BudgetStatusInput {
  readonly scope: BudgetScope
}

export interface BudgetStatusOutput {
  readonly summary: BudgetSummary
}

export interface BudgetShowInput {
  readonly scope: BudgetScope
}

export interface BudgetShowOutput {
  readonly summary: BudgetSummary
}

/**
 * `budget.set` — CAS write of the bounded limits view over
 * `RoutingConfig.Enforcement.budget`; the default ceiling is never silently
 * relaxed (FR4, FR7).
 */
export interface BudgetSetInput {
  readonly scope: BudgetScope
  readonly limits: BudgetLimitsView
  readonly expectedVersion: Version
  readonly principal: OperatorPrincipal
}

export interface BudgetSetOutput {
  readonly summary: BudgetSummary
  readonly auditId: AuditId
}

/** `budget.reset` — CAS write reverting the effective budget to `DEFAULT_ROUTING_BUDGET` (FR4, FR7). */
export interface BudgetResetInput {
  readonly scope: BudgetScope
  readonly expectedVersion: Version
  readonly principal: OperatorPrincipal
}

export interface BudgetResetOutput {
  readonly summary: BudgetSummary
  readonly auditId: AuditId
}

/** `budget.validate` — reports validity over the effective config without mutating (FR4). */
export interface BudgetValidateInput {
  readonly scope: BudgetScope
}

export interface BudgetValidateOutput {
  readonly valid: boolean
  readonly limits: BudgetLimitsView
  readonly reason: ReasonText | null // bounded, secret-free reason when invalid; null when valid
}

/**
 * The typed budget error union (persistence.cue #MutationEnvelope non-`success`
 * outcomes plus the honest-degradation guards, FR7, FR8). Every failure path
 * degrades to one of these — never a fabricated success or synthesized effective
 * state; no discriminant leaks a config payload fragment.
 */
export type BudgetError =
  | { readonly type: "version_conflict"; readonly expectedVersion: Version; readonly actualVersion: Version }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
