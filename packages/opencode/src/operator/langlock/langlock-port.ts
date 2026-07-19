/**
 * Feature 004 / T033 (S16) — the typed `langlock.*` domain seam backing the
 * Feature 007 operator control plane (C3, FR31–FR35), converted to the Feature 014
 * `OperatorMutationPlan` commit contract (FR5).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, the
 * reserved-name guard, AND the single committed mutation (`mutateAuthority`);
 * Feature 004 supplies ONLY this typed `LangLockBackend` seam plus its bounded
 * audit events. This module registers NO command ids and makes ZERO provider/model
 * calls, tokens, or cost (FR33, AC13): `resolve` projects the redacted, content-free
 * `LangLockPolicySummary`; `planSet`/`planReset` VALIDATE the mutation (tag
 * allowlist + the fail-closed `langlock.override` gate) and hand the dispatcher an
 * `OperatorMutationPlan` (authority + pure transform) so `mutateAuthority` owns the
 * one CAS write under the operator's version and emits the Feature 007 audit
 * correlation — the backend never self-commits (self-committing here previously made
 * a `mutates` verb persist a write while the dispatcher rejected the `query` shape).
 *
 * The backend seam (`LangLockBackend`) is the un-audited domain surface the
 * Feature 004 application adapters (`packages/opencode/src/langlock/**`:
 * persistence T025, authorization T029) collectively provide; the composition root
 * injects the real implementation. This module never resolves Feature 005 output
 * content and never carries secrets/payloads/paths in a view (Security 5). The
 * bounded, secret-free operator access audit is emitted at the command-port seam,
 * which carries the Feature 007 principal for every command (`langlock-command-port.ts`).
 */
export * as LangLockOperatorPort from "./langlock-port"

import { Effect } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  LangLockPolicyError,
  LangLockPolicySummary,
  PolicyResetInput,
  PolicyResolveInput,
  PolicySetInput,
} from "@opencode-ai/protocol/langlock/commands"

// =============================================================================
// Audit sink — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a prompt/payload/path). */
export interface LangLockAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "invalid"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface LangLockAuditSink {
  readonly record: (event: LangLockAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Backend seam — the un-audited domain surface (packages/opencode/src/langlock/**)
// =============================================================================

/**
 * The narrow domain seam the Feature 004 application adapters provide. `resolve`
 * returns the bounded redacted summary (`langlock.status`/`langlock.show`);
 * `planSet`/`planReset` VALIDATE the mutation and return an `OperatorMutationPlan`
 * (authority + pure transform) the dispatcher commits via `mutateAuthority` — the
 * backend never self-commits.
 */
export interface LangLockBackend {
  readonly resolve: (input: PolicyResolveInput) => Effect.Effect<LangLockPolicySummary, LangLockPolicyError>
  readonly planSet: (input: PolicySetInput) => Effect.Effect<OperatorMutationPlan, LangLockPolicyError>
  readonly planReset: (input: PolicyResetInput) => Effect.Effect<OperatorMutationPlan, LangLockPolicyError>
}
