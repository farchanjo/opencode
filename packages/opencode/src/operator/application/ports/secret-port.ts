/**
 * SecretPort — put/get/rotate refs only (Feature 007 / T018–T021).
 * Never returns plaintext to audit or CommandResult.
 */
import type { SecretBackend, SecretRef } from "@opencode-ai/core/operator"

export type SecretPortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: "secret_backend" | "unavailable" | "invalid_argument"; readonly reason: string }

export type SecretPort = {
  readonly put: (input: {
    backend: SecretBackend
    name: string
    /** Plaintext accepted only at this boundary; never stored in CommandResult. */
    plaintext: string
  }) => Promise<SecretPortResult<SecretRef>>
  readonly getRef: (input: { backend: SecretBackend; name: string }) => Promise<SecretPortResult<SecretRef>>
  /**
   * Resolve material for internal use only (adapters). Callers MUST NOT place
   * the string into CommandResult/audit/config.
   */
  readonly resolveMaterial: (ref: SecretRef) => Promise<SecretPortResult<"__redacted__">>
  readonly rotate: (input: {
    backend: SecretBackend
    name: string
    plaintext: string
  }) => Promise<SecretPortResult<SecretRef>>
}

export * as OperatorSecretPort from "./secret-port"
