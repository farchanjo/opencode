/**
 * Feature 004 / T033 (S16) — the typed `langlock.*` domain implementation backing
 * the Feature 007 operator control plane (C3, FR31–FR35).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and the
 * reserved-name guard; Feature 004 supplies ONLY this typed `LangLockPolicyPort`
 * domain implementation plus its audit events. This port registers NO command ids
 * and makes ZERO provider/model calls, tokens, or cost (FR33, AC13): `resolve`
 * projects the redacted, content-free `LangLockPolicySummary` the injected backend
 * carries, and every mutation (`set`/`reset`) carries an operator principal +
 * explicit scope + version/CAS + idempotency enforced by the backend, returning a
 * Feature 007 audit-correlation id. The reserved `langlock.status|show|set|reset`
 * ids already live in `packages/core/src/operator/catalog.ts` at
 * `RESERVED_CATALOG_VERSION` — no catalog bump is performed and no id is added here.
 *
 * The backend seam (`LangLockBackend`) is the un-audited domain surface the
 * Feature 004 application adapters (`packages/opencode/src/langlock/**`:
 * persistence T025, authorization T029, audit T030) collectively provide; the
 * composition root injects the real implementations. This module never resolves
 * Feature 005 output content and never carries secrets/payloads/paths in a view
 * (Security 5). The bounded, secret-free operator access audit is emitted at the
 * command-port seam, which carries the Feature 007 principal for every command
 * (`langlock-command-port.ts`).
 */
export * as LangLockOperatorPort from "./langlock-port"

import { Effect } from "effect"
import type {
  LangLockPolicyError,
  LangLockPolicySummary,
  PolicyResetInput,
  PolicyResolveInput,
  PolicySetInput,
} from "@opencode-ai/protocol/langlock/commands"
import type { LangLockPolicyPort } from "@opencode-ai/protocol/langlock/ports"

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
 * `set`/`reset` return the settled summary WITHOUT the audit id — the operator
 * port authors that.
 */
export interface LangLockBackend {
  readonly resolve: (input: PolicyResolveInput) => Effect.Effect<LangLockPolicySummary, LangLockPolicyError>
  readonly set: (input: PolicySetInput) => Effect.Effect<LangLockPolicySummary, LangLockPolicyError>
  readonly reset: (input: PolicyResetInput) => Effect.Effect<LangLockPolicySummary, LangLockPolicyError>
}

export interface LangLockPortDeps {
  readonly backend: LangLockBackend
}

// =============================================================================
// Audit-correlation id
// =============================================================================

const AUDIT_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A fresh Feature 007 audit-correlation id returned by every mutation. */
function auditId(): string {
  let rand = ""
  for (let i = 0; i < 16; i++) rand += AUDIT_ID_ALPHABET[Math.floor(Math.random() * 32)]
  return `evt_langlockaudit_${rand}`
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Build the typed `LangLockPolicyPort` over the injected domain backend. `resolve`
 * passes through the bounded redacted summary; each mutation attaches a fresh
 * audit id. Zero provider/model calls (FR33, AC13).
 */
export function createLangLockPort(deps: LangLockPortDeps): LangLockPolicyPort {
  const b = deps.backend
  return {
    resolve: (input) => b.resolve(input).pipe(Effect.map((policy) => ({ policy }))),
    set: (input) => b.set(input).pipe(Effect.map((policy) => ({ policy, auditId: auditId() }))),
    reset: (input) => b.reset(input).pipe(Effect.map((policy) => ({ policy, auditId: auditId() }))),
  }
}
