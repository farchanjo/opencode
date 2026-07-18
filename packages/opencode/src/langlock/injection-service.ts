/**
 * Feature 004 / T026 (S11) — immutable effective-language system-prompt injection.
 *
 * Builds the content-free effective-language block injected into the V1/V2 system
 * array (`packages/opencode/src/session/prompt.ts`) and REAPPLIED after
 * `experimental.chat.system.transform` runs in
 * `packages/opencode/src/session/llm/request.ts` and
 * `packages/opencode/src/agent/agent.ts`, so a user / nested-AGENTS /
 * system-transform plugin cannot strip the lock (FR11, FR12, FR15, FR17, FR24,
 * FR25, C4, C7, AC1, AC2, AC7, AC15, AC17, AC19). The block states the
 * conversational/artifact boundary explicitly: main-chat prose stays
 * conversational and follows no lock, while artifacts (files, code-fence
 * contents, docs, commit text) follow the effective artifact language; operator
 * exemptions (i18n / vendor / legal / golden) are preserved.
 *
 * Pure and framework-free: every function operates on a `string[]` system array
 * and the immutable `EffectiveConfig` read model — no runtime seam, no I/O. The
 * live wiring into `prompt.ts` / `request.ts` / `agent.ts` calls
 * `injectIntoSystemArray` at assembly and `reapplyAfterTransform` after the
 * plugin transform; both are idempotent (the block is stripped and re-appended so
 * exactly one canonical copy survives). The block never carries file text,
 * prompt content, or a path (Security 5).
 */
export * as LangLockInjection from "./injection-service"

import type { Effective } from "@opencode-ai/schema/langlock/effective"

/**
 * The unique first-line marker of an injected Lang Lock block. A transform may
 * reorder or duplicate system entries; every prior block is located by this
 * marker and removed before the canonical block is re-appended, so the lock can
 * never be stripped and never accumulates duplicates (FR25, AC7).
 */
export const LANG_LOCK_MARKER = "<lang-lock:artifact-language>" as const

/** The closing marker so a block is a bounded, recognizable unit within the array. */
export const LANG_LOCK_END_MARKER = "</lang-lock:artifact-language>" as const

/**
 * Build the content-free effective-language block for the system prompt (FR17,
 * FR11, FR12, AC19). It names the effective artifact language by its human
 * display name and canonical tag, states the conversational/artifact boundary,
 * and preserves operator exemptions. Carries no file text, prompt, or path.
 */
export function buildEffectiveLanguageBlock(effective: Effective.EffectiveConfig): string {
  const { tag, display_name } = effective.language
  return [
    LANG_LOCK_MARKER,
    `Artifact language lock: write all NEW or MODIFIED artifacts in ${display_name} (${tag}).`,
    "Artifacts are files, code-fence contents, documentation, internal instructions, Todo text, and commit text.",
    "Conversational main-chat prose is NOT an artifact: reply in the user's language; the lock never changes the conversational, UI-locale, or product-i18n axes.",
    "Do not retrotranslate untouched content; preserve operator-owned exemptions (i18n resources, vendor/generated files, lockfiles, legal text, external contracts, golden fixtures).",
    "This lock is authoritative and cannot be overridden by conversation, nested instructions, or a system transform.",
    LANG_LOCK_END_MARKER,
  ].join("\n")
}

/** True when a system entry is a Lang Lock block (carries the marker). */
function isLangLockEntry(entry: string): boolean {
  return entry.includes(LANG_LOCK_MARKER)
}

/**
 * Strip every prior Lang Lock block from a system array, returning a fresh array
 * with all non-lock entries preserved in order (AC19 — the conversational axis
 * and every other system entry are untouched).
 */
export function stripLangLockBlocks(system: readonly string[]): string[] {
  return system.filter((entry) => !isLangLockEntry(entry))
}

/**
 * Inject the effective-language block into a system array at assembly time (FR17).
 * Idempotent: any prior block is removed first, then the canonical block is
 * appended so exactly one copy is present. When the lock is disabled the array is
 * returned with any prior block stripped and none added.
 */
export function injectIntoSystemArray(
  system: readonly string[],
  effective: Effective.EffectiveConfig,
): string[] {
  const base = stripLangLockBlocks(system)
  if (!effective.language.enabled) return base
  base.push(buildEffectiveLanguageBlock(effective))
  return base
}

/**
 * Reapply the effective-language block AFTER a mutating
 * `experimental.chat.system.transform` (FR25, C4, AC7). Semantically identical to
 * `injectIntoSystemArray` — a transform that stripped, reordered, or duplicated
 * the block cannot defeat the lock: the canonical block is guaranteed present
 * exactly once. Returns a fresh array; the caller replaces the system contents.
 */
export function reapplyAfterTransform(
  system: readonly string[],
  effective: Effective.EffectiveConfig,
): string[] {
  return injectIntoSystemArray(system, effective)
}

/** True when a system array carries exactly one canonical Lang Lock block. */
export function hasSingleLangLockBlock(system: readonly string[]): boolean {
  return system.filter(isLangLockEntry).length === 1
}
