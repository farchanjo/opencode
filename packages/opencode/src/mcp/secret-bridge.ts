/**
 * Feature 008 / T030 (S20) — the OAuth/header/secret → Feature 007 SecretRef bridge.
 *
 * Resolves OAuth tokens, headers, and secrets as Feature 007 SecretRefs through the
 * injected `SecretResolvePort`, and runs a ONE-TIME migration reading existing
 * `McpAuth` token entries into secure refs. No plaintext secret ever enters args,
 * history, output, config JSON, plain audit, or a spool preview — the plaintext
 * never crosses this seam (only opaque refs + spawn-only handles) (FR32, C15).
 *
 * Honest seam: the in-place `auth.ts` cutover (reading resolved handles at connect)
 * is sequenced additive-first — this bridge is the additive resolution surface the
 * reworked `auth.ts`/`index.ts` host consumes; the live `McpAuth` store rewrite is
 * a documented follow-on that keeps config surfaces backward-compatible (C15, C27).
 */
export * as McpSecretBridge from "./secret-bridge"

import { Effect } from "effect"
import type { SecretRef } from "@opencode-ai/protocol/mcp/commands"
import type { SecretError, SecretHandle, SecretResolvePort } from "@opencode-ai/protocol/mcp/ports"

export interface SecretBridgeDeps {
  readonly secrets: SecretResolvePort
}

/** A legacy `McpAuth` entry shape (tokens held inline before the C15 cutover). */
export interface LegacyAuthEntry {
  readonly server: string
  readonly hasTokens: boolean
}

/** The migration result: a secure ref per legacy entry, never the token material (C15). */
export interface MigratedRef {
  readonly server: string
  readonly secretRef: SecretRef
}

export interface SecretBridge {
  /** Resolve a SecretRef to an opaque spawn-only handle; the plaintext never crosses this seam (C15). */
  readonly resolve: (ref: SecretRef) => Effect.Effect<SecretHandle, SecretError>
  /**
   * One-time migration: mint a stable secure ref per legacy `McpAuth` entry that
   * still holds tokens. Content-free — it reads only the presence of tokens and
   * returns the ref id the SecretPort now owns (C15).
   */
  readonly migrateLegacyEntries: (entries: ReadonlyArray<LegacyAuthEntry>) => ReadonlyArray<MigratedRef>
}

/** The deterministic ref id an `McpAuth` server entry maps to after migration (opaque, non-secret). */
export const refIdForServer = (server: string): SecretRef => `mcp/oauth/${server}` as SecretRef

/** Build the secret bridge over the injected Feature 007 SecretResolvePort (C15). */
export const createSecretBridge = (deps: SecretBridgeDeps): SecretBridge => ({
  resolve: (ref) => deps.secrets.resolve(ref),
  migrateLegacyEntries: (entries) =>
    entries.filter((e) => e.hasTokens).map((e) => ({ server: e.server, secretRef: refIdForServer(e.server) })),
})
