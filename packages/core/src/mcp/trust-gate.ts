/**
 * Feature 008 / T021 (S13) — the trust / validation / provenance / size gate.
 *
 * Encodes the C5/C6/C24 gates drawn in `plan.md`, `enums.cue` (`TrustProfile`,
 * `OutputSchemaMode`, `ProvenanceClass`) and `values.cue` (FR13a, FR27, C5, C6,
 * C24). Pure and deterministic, no I/O.
 *
 *   - Annotation trust: tool annotations are UNTRUSTED unless the operator elevated
 *     the profile — an unelevated annotation is ignored for gating (FR13a, C6).
 *   - outputSchema mode: `tolerant` (default) surfaces a typed NON-FATAL validation
 *     warning and still spools/delivers; `strict` (per-server opt-in) turns a
 *     structuredContent mismatch into an `isError`-class failure (FR12, C5).
 *   - Provenance: server content is labeled `external`/`untrusted` at the context
 *     boundary; only operator-elevated content is `trusted` (FR27, C24).
 *   - Size / decompression bomb: an oversized or over-ratio payload is REJECTED
 *     before delivery, never decoded into context (FR27, C24).
 */
export * as TrustGate from "./trust-gate"

import type { OutputSchemaMode, ProvenanceClass, TrustProfile } from "@opencode-ai/schema/mcp/enums"

export type { OutputSchemaMode, ProvenanceClass, TrustProfile }

// --- Annotation trust (FR13a, C6) -------------------------------------------

/**
 * Whether a tool annotation may inform gating/hints. Only an operator-`elevated`
 * trust profile trusts annotations; the `untrusted` default ignores them, so a
 * server-supplied annotation is never a safety guarantee (FR13a, C6).
 */
export const annotationsTrusted = (profile: TrustProfile): boolean => profile === "elevated"

/** The default annotation-trust profile — untrusted (FR13a, C6). */
export const DEFAULT_TRUST_PROFILE: TrustProfile = "untrusted"

// --- outputSchema validation (FR12, C5) -------------------------------------

/** The outcome of validating structuredContent against a declared outputSchema (C5). */
export type ValidationOutcome =
  | { readonly kind: "valid" }
  | { readonly kind: "warning"; readonly deliver: true; readonly reason: string }
  | { readonly kind: "error"; readonly deliver: false; readonly reason: string }

/** The default outputSchema mode — tolerant (FR12, C5). */
export const DEFAULT_OUTPUT_SCHEMA_MODE: OutputSchemaMode = "tolerant"

/**
 * Decide the validation outcome for a structuredContent result. A match is `valid`.
 * A mismatch under `tolerant` (default) is a NON-FATAL `warning` that still delivers
 * and spools; under `strict` (per-server opt-in) it is an `isError`-class `error`
 * that does NOT deliver (FR12, C5). Pure.
 */
export const validateOutput = (mode: OutputSchemaMode, matches: boolean): ValidationOutcome => {
  if (matches) return Object.freeze({ kind: "valid" })
  return mode === "strict"
    ? Object.freeze({ kind: "error", deliver: false, reason: "structured_content_schema_mismatch" })
    : Object.freeze({ kind: "warning", deliver: true, reason: "structured_content_schema_mismatch" })
}

// --- Provenance labeling (FR27, C24) ----------------------------------------

/**
 * Label the provenance of a content payload at the context boundary. Operator-
 * elevated content is `trusted`; server content is `external`, or `untrusted` when
 * the payload is flagged untrusted (e.g. a nested resource_link body). Server
 * content is never `trusted` by default (FR27, C24).
 */
export const labelProvenance = (input: { readonly operatorElevated: boolean; readonly untrustedFlag: boolean }): ProvenanceClass => {
  if (input.operatorElevated) return "trusted"
  return input.untrustedFlag ? "untrusted" : "external"
}

// --- Size / decompression-bomb limits (FR27, C24) ---------------------------

/** The pre-delivery size caps; exact bounds are provisional plan constants (C24). */
export interface SizeLimits {
  /** The maximum decoded byte length delivered before spooling (C24). */
  readonly maxBytes: number
  /** The maximum decoded:encoded ratio; a higher ratio is a decompression bomb (C24). */
  readonly maxDecompressionRatio: number
}

/** The size/bomb decision made BEFORE any payload reaches delivery (FR27, C24). */
export type SizeDecision =
  | { readonly kind: "accept" }
  | { readonly kind: "reject"; readonly reason: "size_limit_exceeded" | "decompression_bomb" }

/**
 * Decide whether a payload may be delivered given its decoded and encoded sizes. An
 * over-cap decoded length is rejected `size_limit_exceeded`; a decoded:encoded ratio
 * above the cap is rejected `decompression_bomb` — both BEFORE delivery, so an
 * oversized payload never enters context (FR27, C24). A zero encoded length with a
 * non-zero decoded length is a bomb. Pure.
 */
export const checkSize = (input: { readonly decodedBytes: number; readonly encodedBytes: number }, limits: SizeLimits): SizeDecision => {
  if (input.decodedBytes > limits.maxBytes) return Object.freeze({ kind: "reject", reason: "size_limit_exceeded" })
  const ratio = input.encodedBytes <= 0 ? (input.decodedBytes > 0 ? Infinity : 0) : input.decodedBytes / input.encodedBytes
  if (ratio > limits.maxDecompressionRatio) return Object.freeze({ kind: "reject", reason: "decompression_bomb" })
  return Object.freeze({ kind: "accept" })
}
