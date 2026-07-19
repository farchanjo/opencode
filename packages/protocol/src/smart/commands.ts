/**
 * Feature 013 — Smart protocol payloads (T002).
 *
 * TypeScript mirror of the smart operator-surface projection contract from
 * doc/arch/schemas/operator-config-domains/smart.cue (FR1, FR3). `smart` is a
 * PROJECTION of `RoutingConfig.Activation` (packages/schema/src/routing/config.ts)
 * — not a standalone store — so the `smart.*` verbs read and mutate
 * `Activation.enabled`/`mode` over the SAME routing Config.Service authority the
 * budget/pools domains bind (FR3, FR9). This file defines the projected read
 * model, the `on`/`off`/`auto` mutation input (carrying an `expectedVersion` CAS
 * token), and the typed error union; the `SmartPort` interface that consumes them
 * lives in ./ports.
 *
 * Structure mirrors `packages/protocol/src/langlock/{commands,ports}.ts`. The
 * camelCase protocol shapes here are the operator-surface projection consumed by
 * Feature 007 adapters, distinct from the persisted snake_case routing config.
 * The `enabled`/`mode` types are REUSED from the routing schema so the projection
 * can never drift from the wire shape. No payload carries a plaintext secret or a
 * free-form command id (FR11).
 */

import type { Activation, SmartRoutingEnabled } from "@opencode-ai/schema/routing/config"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/operator-config-domains/shared.cue)
// =============================================================================

/** The Config.Service authority key a smart mutation targets (`routing` / `global:routing`) (FR9). */
export type AuthorityKey = string

/**
 * Opaque Config.Service CAS version token carried on the handled result and
 * echoed back as `expectedVersion` on the next mutation; never parsed (FR7, FR12).
 */
export type ConfigVersion = string

/** Feature 007 audit id returned by every mutation (FR7). */
export type AuditId = string

// =============================================================================
// Reused routing Activation slice (wire shape: RoutingConfig.Activation)
// =============================================================================

/**
 * The routing Activation mode smart projects (`always` | `auto` | `never`);
 * REUSED from the routing schema, never re-declared, so the projection stays in
 * lockstep with `Activation.mode` (FR3). Consumed by the smart domain stack when
 * mapping `smart.auto` onto the routing authority.
 */
export type SmartActivationMode = Activation["mode"]

// =============================================================================
// Smart projection read model (wire shape: smart.cue #SmartSummary)
// =============================================================================

/**
 * The smart read model surfaced by `smart.status`: the enabled/auto state
 * projected from `RoutingConfig.Activation` plus the config-derived flags (FR3).
 * `available` is `false` when the live routing config is unreachable — never a
 * fabricated availability (FR8). Never carries file text or path content.
 */
export interface SmartSummary {
  readonly enabled: SmartRoutingEnabled
  readonly auto: boolean
  readonly configured: boolean
  readonly available: boolean
  readonly authority: AuthorityKey
  readonly updatedAt: string // ISO-8601
  readonly version: ConfigVersion
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principal permitted to mutate the routing Activation state (FR9). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// SmartPort payloads — resolve / on / off / auto (FR3, FR7, FR8)
// =============================================================================

/** Backs `smart.status`; redacted, content-free projection read (FR3). */
export interface SmartResolveOutput {
  readonly summary: SmartSummary
}

/**
 * Shared CAS mutation input for `smart.on`/`smart.off`/`smart.auto`: each flips
 * `Activation.enabled`/`mode` on the routing authority under an `expectedVersion`
 * CAS token, authorized by a Feature 007 principal (FR3, FR7).
 */
export interface SmartMutationInput {
  readonly expectedVersion: ConfigVersion
  readonly principal: OperatorPrincipal
}

/** Handled result of an `on`/`off`/`auto` mutation: the new projection plus an audit id (FR7). */
export interface SmartMutationOutput {
  readonly summary: SmartSummary
  readonly auditId: AuditId
}

// =============================================================================
// Typed error union (wire shape: enums.cue #MutationOutcome minus success)
// =============================================================================

/**
 * The typed envelope a smart verb degrades to; never a fabricated success (FR7,
 * FR8). Mirrors `#MutationOutcome` (`version_conflict` | `invalid_argument` |
 * `unauthorized` | `unavailable`) plus the `not_implemented` stub sentinel.
 */
export type SmartError =
  | { readonly type: "version_conflict"; readonly expectedVersion: ConfigVersion; readonly actualVersion: ConfigVersion }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
