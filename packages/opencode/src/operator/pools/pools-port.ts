/**
 * Feature 013 / T008 — the typed `pools.*` domain implementation backing the
 * Feature 007 operator control plane (FR5, FR7, FR8).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and the
 * reserved-name guard; Feature 013 supplies ONLY this typed `PoolsPort` domain
 * implementation plus its audit events. `pools` is a PROJECTION of
 * `RoutingConfig.Models.role_pools` (`schema/src/routing/config.ts`): `resolve`
 * projects the redacted, content-free `PoolsProjection` the injected backend
 * carries, and every mutation (`set`/`reset`) is an optimistic CAS write over the
 * SAME routing Config.Service authority that returns a Feature 007 audit-correlation
 * id. `validate` reports validity without mutating. This port registers NO command
 * ids and makes ZERO provider/model calls, tokens, or cost — the reserved
 * `pools.status|show|set|reset|validate` ids already live in the catalog, so no
 * catalog bump is performed and no id is added here (FR11).
 *
 * Structure mirrors `packages/opencode/src/operator/langlock/langlock-port.ts`:
 * the backend seam (`PoolsBackend`) is the un-audited domain surface `backend-live.ts`
 * provides over the reused routing config; the composition root injects it. This
 * module never carries secrets/payloads/paths in a view (Security). The bounded,
 * secret-free operator access audit is emitted at the command-port seam, which
 * carries the Feature 007 principal for every command (`pools-command-port.ts`).
 */
export * as PoolsOperatorPort from "./pools-port"

import { Effect } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { PoolsError, PoolsProjection, PoolsResetInput, PoolsSetInput } from "@opencode-ai/protocol/pools/commands"

// =============================================================================
// Audit sink — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a role-pool model id or payload). */
export interface PoolsAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "invalid"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface PoolsAuditSink {
  readonly record: (event: PoolsAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Backend seam — the un-audited domain surface (backend-live.ts)
// =============================================================================

/**
 * The narrow domain seam `createLivePoolsBackend` provides over the reused routing
 * config. `resolve`/`validate` return the bounded projection (`pools.status`/`show`
 * and `pools.validate`); `planSet`/`planReset` VALIDATE and return an
 * `OperatorMutationPlan` (SCOPED routing authority + pure transform) the dispatcher
 * commits via `mutateAuthority` — the backend never self-commits.
 *
 * `requestScopeKind` is the dispatcher-resolved REQUEST scope (`ctx.request.scope.kind`
 * — "global" persists role_pools to `global:routing`; anything else to the project
 * `routing` document). It is OPTIONAL and defaults to `project` for back-compat, so a
 * caller that omits it keeps the pre-Feature-033 project-only behavior.
 */
export interface PoolsBackend {
  readonly resolve: (requestScopeKind?: string) => Effect.Effect<PoolsProjection, PoolsError>
  readonly planSet: (input: PoolsSetInput, requestScopeKind?: string) => Effect.Effect<OperatorMutationPlan, PoolsError>
  readonly planReset: (input: PoolsResetInput, requestScopeKind?: string) => Effect.Effect<OperatorMutationPlan, PoolsError>
  readonly validate: (requestScopeKind?: string) => Effect.Effect<PoolsProjection, PoolsError>
}
