/**
 * Feature 013 / T006 — the typed `smart.*` domain implementation backing the
 * Feature 007 operator control plane (FR3, FR7, FR8).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and the
 * reserved-name guard; Feature 013 supplies ONLY this typed `SmartPort` domain
 * implementation plus its audit events. This port registers NO command ids and
 * makes ZERO provider/model calls, tokens, or cost: `resolve` projects the
 * content-free `SmartSummary` the injected backend carries (the projected
 * `RoutingConfig.Activation` enabled/mode state), and every mutation
 * (`on`/`off`/`auto`) is an optimistic CAS write over the routing Config.Service
 * authority that returns a Feature 007 audit-correlation id. The reserved
 * `smart.status|on|off|auto` ids already live in the catalog — no catalog bump is
 * performed and no id is added here (FR9, FR11).
 *
 * The backend seam (`SmartBackend`) is the un-audited domain surface the live
 * composition (`backend-live.ts`) provides over the reused routing config; this
 * module never re-authors the routing schema and never carries a secret, payload,
 * or path in a view (FR8). The bounded, secret-free operator access audit is
 * emitted at the command-port seam, which carries the Feature 007 principal for
 * every command (`smart-command-port.ts`).
 */
export * as SmartOperatorPort from "./smart-port"

import { Effect } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { SmartError, SmartMutationInput, SmartSummary } from "@opencode-ai/protocol/smart/commands"

// =============================================================================
// Audit sink — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a config payload/secret). */
export interface SmartAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "invalid"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface SmartAuditSink {
  readonly record: (event: SmartAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Backend seam — the un-audited domain surface (backend-live.ts)
// =============================================================================

/**
 * The narrow domain seam the live composition provides over the reused routing
 * config. `resolve` returns the bounded `SmartSummary` (`smart.status`);
 * `planOn`/`planOff`/`planAuto` VALIDATE and return an `OperatorMutationPlan`
 * (routing authority + pure transform) the dispatcher commits via `mutateAuthority`
 * — the backend never self-commits.
 */
export interface SmartBackend {
  readonly resolve: () => Effect.Effect<SmartSummary, SmartError>
  readonly planOn: (input: SmartMutationInput) => Effect.Effect<OperatorMutationPlan, SmartError>
  readonly planOff: (input: SmartMutationInput) => Effect.Effect<OperatorMutationPlan, SmartError>
  readonly planAuto: (input: SmartMutationInput) => Effect.Effect<OperatorMutationPlan, SmartError>
}
