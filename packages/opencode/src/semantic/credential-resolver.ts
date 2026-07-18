/**
 * Feature 006 / T032 (S21) — SecretRef-only credential resolution.
 *
 * Provider and Milvus credentials are resolved ONLY through a Feature 007
 * `SecretRef` (`{ backend, name, version }`) — the OS keychain is mandatory for
 * stored secrets and an env-ref is allowed for CI only. A resolved secret is
 * applied to an outbound request through the injected SecretPort proxy; it never
 * appears in args, history, output, config JSON, or audit (C19). `rotate-secret`
 * changes only the `secret_ref`/version and NEVER the endpoint/model/binding
 * identity, and the rotation event is redacted and audited (FR35, FR31, C19).
 *
 * The plaintext-leak guard reuses the Feature 007 `findPlaintextSecretFields`
 * scanner so any output that would carry a raw secret is caught by one owner.
 */
export * as CredentialResolver from "./credential-resolver"

import { findPlaintextSecretFields, isExactSecretRef } from "@opencode-ai/core/operator/secret"
import type { SecretBackend, SecretRef } from "@opencode-ai/core/operator/secret"

export type { SecretRef, SecretBackend }

/** Context that gates env-ref: an env-ref is honored only in CI (the keychain is mandatory otherwise). */
export interface ResolveContext {
  readonly ci: boolean
}

export type ResolveDecision =
  | { readonly ok: true; readonly ref: SecretRef }
  | { readonly ok: false; readonly reason: "env_ref_requires_ci" | "invalid_ref" }

/**
 * Decide whether a `SecretRef` may be resolved in the given context: a keychain
 * ref is always allowed; an env-ref is allowed only under CI (C19). An
 * ill-formed ref is rejected before any resolution attempt.
 */
export const resolvePolicy = (ref: unknown, context: ResolveContext): ResolveDecision => {
  if (!isExactSecretRef(ref)) return { ok: false, reason: "invalid_ref" }
  if (ref.backend === "env-ref" && !context.ci) return { ok: false, reason: "env_ref_requires_ci" }
  return { ok: true, ref }
}

/** An opaque credential handle — the ref and its backend only, NEVER plaintext (C19). */
export interface CredentialHandle {
  readonly ref: SecretRef
  readonly backend: SecretBackend
}

/** Project a resolved ref to an opaque handle carrying no secret material (C19). */
export const asHandle = (ref: SecretRef): CredentialHandle => ({ ref, backend: ref.backend })

/**
 * The injected SecretPort proxy: applies the secret to an outbound request inside
 * `use` without ever returning it to the caller (the merkle/vault.spawn proxy
 * posture). The resolver itself never touches plaintext.
 */
export interface SecretResolvePort {
  readonly withSecret: <A>(ref: SecretRef, use: (authorization: string) => Promise<A>) => Promise<A>
}

/** The immutable identity a rotation must preserve (FR31). */
export interface BindingIdentity {
  readonly providerProfileId: string
  readonly modelDescriptorId: string
  readonly bindingId: string
}

export interface RotateInput {
  readonly identity: BindingIdentity
  readonly currentRef: SecretRef
  readonly newRef: SecretRef
}

export interface RotateResult {
  readonly identity: BindingIdentity
  readonly ref: SecretRef
  readonly changed: "secret_ref_only"
}

/**
 * Rotate a secret: return the SAME binding identity with only the `secret_ref`
 * swapped for `newRef`. The endpoint/model/binding identity is unchanged, so a
 * rotation never re-pins or re-selects a binding (FR31, C19, AC30, AC35).
 */
export const rotateSecret = (input: RotateInput): RotateResult => ({
  identity: input.identity,
  ref: input.newRef,
  changed: "secret_ref_only",
})

/**
 * A bounded, redacted audit record for a rotation — the new ref (an exact
 * `SecretRef` coordinate, never the secret material) plus the version delta. The
 * ref is embedded as an exact `SecretRef` so the plaintext scanner recognizes it
 * as an allowed coordinate rather than a leak (C19).
 */
export interface RotationAudit {
  readonly bindingId: string
  readonly ref: SecretRef
  readonly fromVersion: number
  readonly toVersion: number
}

/** Project a redacted, content-free rotation audit event (no plaintext, C19). */
export const auditRotation = (input: RotateInput): RotationAudit => ({
  bindingId: input.identity.bindingId,
  ref: input.newRef,
  fromVersion: input.currentRef.version,
  toVersion: input.newRef.version,
})

/** True when a value would leak a raw secret into output; a bare SecretRef is allowed (C19). */
export const containsPlaintextSecret = (value: unknown): boolean =>
  findPlaintextSecretFields(value).length > 0
