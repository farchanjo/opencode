/**
 * Feature 004 / T016 (S5) — canonical BCP 47 tag validation and allowlisting.
 *
 * Framework-free, deterministic, zero I/O. Validates a candidate artifact-language
 * tag through `Intl.getCanonicalLocales` (canonical BCP 47 form) plus the injected
 * allowlist, rejecting a non-canonical or non-allowlisted tag, and maps a canonical
 * tag to its human/native `DisplayName` (FR4, Security 2, C13, AC3, AC16). The
 * canonical tag is stored and validated but is NEVER surfaced as the primary picker
 * label — pickers show `displayName`/`nativeName` only (FR4, C13); this module
 * therefore returns the display names alongside the validated tag and never a
 * technical slug as the primary label.
 */
export * as TagValidation from "./tag-validation"

import { Allowlist } from "@opencode-ai/schema/langlock/allowlist"

/** A human/native display pair for one allowlisted tag; never a technical slug (FR4, C13). */
export interface AllowlistDisplay {
  readonly displayName: string
  readonly nativeName: string
}

/**
 * The injected allowlist port (FR4, C13). Content-free: it maps a canonical tag to
 * its human/native display names, or returns `null` when the tag is not allowlisted.
 * The domain never reaches a config store or network for this lookup.
 */
export interface AllowlistPort {
  readonly entry: (tag: string) => AllowlistDisplay | null
}

/** The rejection reasons a candidate tag can fail with (FR4, C13, Security 2). */
export type TagRejectionReason = "non_canonical" | "not_allowlisted"

/** The result of validating a candidate tag against canonical BCP 47 plus the allowlist. */
export type TagValidationResult =
  | { readonly ok: true; readonly tag: string; readonly displayName: string; readonly nativeName: string }
  | { readonly ok: false; readonly tag: string; readonly reason: TagRejectionReason }

/**
 * Build an `AllowlistPort` from a static allowlist (defaulting to the eight initial
 * allowlisted entries, FR3). The lookup is exact on the canonical tag; the display
 * names are the human/native labels surfaced by pickers (FR4, C13, AC3).
 */
export function createAllowlistPort(
  entries: ReadonlyArray<{ readonly tag: string; readonly display_name: string; readonly native_name: string }> = Allowlist.INITIAL_ALLOWLIST,
): AllowlistPort {
  const byTag = new Map<string, AllowlistDisplay>(
    entries.map((entry) => [entry.tag, { displayName: entry.display_name, nativeName: entry.native_name }]),
  )
  return { entry: (tag) => byTag.get(tag) ?? null }
}

/** The canonical BCP 47 form of a candidate, or `null` when structurally invalid. */
function canonicalize(candidate: string): string | null {
  try {
    const canonical = Intl.getCanonicalLocales(candidate)
    return canonical.length === 1 ? canonical[0] : null
  } catch {
    return null
  }
}

/**
 * Validate a candidate artifact-language tag (FR4, Security 2, C13). A tag is
 * accepted only when it is already in canonical BCP 47 form (its own canonical
 * identity, not merely canonicalizable) AND present in the injected allowlist;
 * otherwise it is rejected with a typed reason. Deterministic and side-effect-free.
 */
export function validateTag(candidate: string, allowlist: AllowlistPort): TagValidationResult {
  const canonical = canonicalize(candidate)
  if (canonical === null || canonical !== candidate) {
    return { ok: false, tag: candidate, reason: "non_canonical" }
  }
  const entry = allowlist.entry(canonical)
  if (entry === null) {
    return { ok: false, tag: candidate, reason: "not_allowlisted" }
  }
  return { ok: true, tag: canonical, displayName: entry.displayName, nativeName: entry.nativeName }
}

/**
 * Map a validated tag to its human/native display names (FR4, C13, AC3). Returns
 * `null` when the tag is not allowlisted; the caller surfaces the display names in a
 * picker and never the technical tag as the primary label.
 */
export function displayFor(tag: string, allowlist: AllowlistPort): AllowlistDisplay | null {
  return allowlist.entry(tag)
}
