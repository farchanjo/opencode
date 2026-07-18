/**
 * Feature 004 / T020 (S9) — operator-owned exception-manifest matcher.
 *
 * Framework-free, deterministic, zero I/O. Matches a write target against the
 * operator-owned `ExceptionManifest` (i18n / vendor / lockfile / legal /
 * external-contract / golden / exact) over the injected manifest port, returning a
 * bounded `matched` / `denied` result, and rejecting any untrusted LLM / plugin /
 * prompt / MCP / custom-command attempt to create an exemption (FR14, FR15,
 * Security 6, C16, AC9, AC10, AC18). Mirrors `exception.cue`. The matcher reads only
 * bounded, content-free entry metadata; it never carries file text or paths
 * (Security 5).
 */
export * as ExceptionMatcher from "./exception-matcher"

import type { ExceptionCategory, Scope } from "@opencode-ai/schema/langlock/enums"

/** A content-free matched exemption record surfaced by the injected manifest port (FR14, C16). */
export interface ExceptionMatch {
  readonly category: ExceptionCategory
  readonly scope: Scope
}

/**
 * The injected operator-owned manifest port (FR14, C16). Content-free: it resolves a
 * write target to a matched exemption entry, or `null` when no operator-owned entry
 * matches. The manifest is never mutated through this port — creation is gated
 * separately by `authorizeExceptionCreate` (Security 6, AC10).
 */
export interface ManifestPort {
  readonly match: (target: MatchTarget) => ExceptionMatch | null
}

/** The bounded, content-free descriptor of a write target used for matching (Security 5). */
export interface MatchTarget {
  /** An opaque, operator-recognizable target key (never raw file text; Security 5). */
  readonly key: string
}

/**
 * The outcome of matching a write target against the manifest (FR14, C16, AC9).
 *   - `matched`: an operator-owned exemption of the returned category applies.
 *   - `denied`: no operator-owned entry matched; the lock still governs the target.
 */
export type MatchOutcome =
  | { readonly kind: "matched"; readonly category: ExceptionCategory; readonly scope: Scope }
  | { readonly kind: "denied"; readonly reason: "no_match" }

/**
 * Match a write target against the operator-owned manifest (FR14, C16, AC9, AC10).
 * Deterministic and total. A `matched` result means an operator registered the
 * exemption; a `denied` result keeps the target under the lock (AC10 literal
 * preservation is a matched-entry concern; a non-match never invents an exemption).
 */
export function matchException(target: MatchTarget, manifest: ManifestPort): MatchOutcome {
  const match = manifest.match(target)
  if (match === null) {
    return { kind: "denied", reason: "no_match" }
  }
  return { kind: "matched", category: match.category, scope: match.scope }
}

/**
 * The actor requesting an exemption creation. Only `operator` is trusted; every other
 * actor is an untrusted source that can never create an exemption (Security 6, C16,
 * AC10, AC18).
 */
export type CreateActor = "operator" | "llm" | "plugin" | "prompt" | "mcp" | "custom_command"

/**
 * The outcome of an exemption-creation authorization check (Security 6, AC10).
 *   - `accepted`: an operator principal may register the exemption.
 *   - `rejected`: an untrusted actor's request is refused; exemptions are operator-owned.
 */
export type CreateOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: "untrusted_actor"; readonly actor: CreateActor }

/**
 * Authorize an exemption-creation request (FR14, Security 6, C16, AC10, AC18).
 * Deterministic and total. Only an `operator` principal is accepted; an LLM, plugin,
 * prompt, MCP, or custom-command request is rejected as `untrusted_actor` — untrusted
 * sources can never create an exemption.
 */
export function authorizeExceptionCreate(actor: CreateActor): CreateOutcome {
  if (actor === "operator") {
    return { kind: "accepted" }
  }
  return { kind: "rejected", reason: "untrusted_actor", actor }
}
