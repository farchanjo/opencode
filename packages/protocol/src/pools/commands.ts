/**
 * Feature 013 — Pools protocol payloads (T004).
 *
 * TypeScript mirror of the pools operator-surface projection contract from
 * doc/arch/schemas/operator-config-domains/pools.cue (FR1, FR5). `pools` is a
 * PROJECTION of `RoutingConfig.Models.role_pools`
 * (packages/schema/src/routing/config.ts) — not a standalone store — so the
 * `pools.*` verbs read and mutate that map over the SAME routing Config.Service
 * authority the budget/smart domains bind (FR5, FR9). This file defines the
 * bounded projection read model, the `set`/`reset` mutation inputs (each carrying
 * an `expectedVersion` CAS token), the `validate` output, and the typed error
 * union; the `PoolsPort` interface that consumes them lives in ./ports.
 *
 * Structure mirrors `packages/protocol/src/langlock/{commands,ports}.ts`. The
 * camelCase protocol shapes here are the operator-surface projection consumed by
 * Feature 007 adapters, distinct from the persisted snake_case routing config.
 * No payload carries a plaintext secret or a free-form command id (FR11).
 */

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/operator-config-domains/shared.cue)
// =============================================================================

/** A role-pool key from the `RoutingConfig.Models.role_pools` map; content-free (FR5). */
export type RolePoolName = string

/** One candidate model id bound to a role pool; content-free (FR5). */
export type ModelId = string

/**
 * Opaque Config.Service CAS version token carried on the handled result and
 * echoed back as `expectedVersion` on the next mutation; never parsed (FR7, FR12).
 */
export type ConfigVersion = string

/** Feature 007 audit id returned by every mutation (FR7). */
export type AuditId = string

// =============================================================================
// Role-pool bindings (wire shape: pools.cue #RolePoolBinding, #RolePoolBindingList)
// =============================================================================

/** One role-pool key mapped to its ordered candidate model set (FR5). */
export interface RolePoolBinding {
  readonly role: RolePoolName
  readonly models: readonly ModelId[]
}

/** The named collection of role-pool bindings projected from `role_pools` (FR5). */
export type RolePoolBindingList = readonly RolePoolBinding[]

// =============================================================================
// Pools projection read model (wire shape: pools.cue #PoolsProjection)
// =============================================================================

/**
 * The pools read model surfaced by `pools.status`/`pools.show`: the projected
 * bindings over the effective routing config plus the config-derived flags
 * (FR5). `available` is `false` when the live routing config is unreachable —
 * never a fabricated availability (FR8). Never carries file text or path content.
 */
export interface PoolsProjection {
  readonly configured: boolean
  readonly available: boolean
  readonly valid: boolean
  readonly bindings: RolePoolBindingList
  readonly updatedAt: string // ISO-8601
  readonly version: ConfigVersion
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principal permitted to mutate the role-pool bindings (FR9). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// PoolsPort payloads — resolve / set / reset / validate (FR5, FR7, FR8)
// =============================================================================

/** Backs `pools.status` and `pools.show`; redacted, content-free projection read. */
export interface PoolsResolveOutput {
  readonly projection: PoolsProjection
}

/** Backs `pools.set`; CAS-writes the whole role-pool map on the routing authority (FR5, FR7). */
export interface PoolsSetInput {
  readonly bindings: RolePoolBindingList
  readonly expectedVersion: ConfigVersion
  readonly principal: OperatorPrincipal
}

export interface PoolsSetOutput {
  readonly projection: PoolsProjection
  readonly auditId: AuditId
}

/** Backs `pools.reset`; reverts the map to the routing default under CAS (FR5, FR7). */
export interface PoolsResetInput {
  readonly expectedVersion: ConfigVersion
  readonly principal: OperatorPrincipal
}

export interface PoolsResetOutput {
  readonly projection: PoolsProjection
  readonly auditId: AuditId
}

/**
 * Backs `pools.validate`; reports validity of the effective role-pool bindings
 * without mutating (FR5). The `valid` flag is never asserted blindly (FR8).
 */
export interface PoolsValidateOutput {
  readonly valid: boolean
  readonly projection: PoolsProjection
}

// =============================================================================
// Typed error union (wire shape: enums.cue #MutationOutcome minus success)
// =============================================================================

/**
 * The typed envelope a pools verb degrades to; never a fabricated success (FR7,
 * FR8). Mirrors `#MutationOutcome` (`version_conflict` | `invalid_argument` |
 * `unauthorized` | `unavailable`) plus the `not_implemented` stub sentinel.
 */
export type PoolsError =
  | { readonly type: "version_conflict"; readonly expectedVersion: ConfigVersion; readonly actualVersion: ConfigVersion }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
