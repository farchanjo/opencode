// Pure signal-and-projection layer for the Settings "Lang Lock" row (Feature
// 004 / T034, FR31, FR4, C13). No I/O, no solid-js — mirrors
// packages/tui/src/operator/jobs/card.ts's text-derivation style.
//
// Presents the artifact-language picker with human/native display names; the
// canonical BCP 47 tag is stored but NEVER surfaced as the primary label
// (FR4, AC3). This row is distinct from any "UI Language" row
// (packages/app/src/context/language.tsx,
// packages/desktop/src/renderer/i18n/index.ts) — Lang Lock never reads or
// mutates that axis (C1).

import { Allowlist } from "@opencode-ai/schema/langlock/allowlist"
import type { LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"

export const SETTINGS_ROW_LABEL = "Artifact language"

export interface LangLockSettingsRowView {
  readonly labelText: string
  /** Human/native display; never the raw canonical tag alone (FR4, AC3). */
  readonly valueText: string
  /** The value actually persisted; never shown as the row's primary label. */
  readonly canonicalTag: string
  readonly enabledText: string
  readonly scopeText: string
  readonly originText: string
}

function nativeNameFor(tag: string): string | undefined {
  return Allowlist.INITIAL_ALLOWLIST.find((entry) => entry.tag === tag)?.native_name
}

function displayValueText(displayName: string, nativeName: string | undefined): string {
  if (!nativeName || nativeName === displayName) return displayName
  return `${displayName} / ${nativeName}`
}

/** Honest empty baseline: no policy resolved yet (no live status query wired); see ./index.tsx. */
export const EMPTY_LANGLOCK_SETTINGS_ROW: LangLockSettingsRowView = {
  labelText: SETTINGS_ROW_LABEL,
  valueText: "not configured",
  canonicalTag: "",
  enabledText: "disabled",
  scopeText: "-",
  originText: "-",
}

/** Derive the row view from a resolved `LangLockPolicySummary` (FR31, C13). */
export function deriveLangLockSettingsRow(policy: LangLockPolicySummary): LangLockSettingsRowView {
  return {
    labelText: SETTINGS_ROW_LABEL,
    valueText: displayValueText(policy.displayName, nativeNameFor(policy.tag)),
    canonicalTag: policy.tag,
    enabledText: policy.enabled ? "enabled" : "disabled",
    scopeText: policy.scope,
    originText: policy.origin,
  }
}

export interface LangLockAllowlistOptionView {
  readonly tag: string
  /** Primary picker label — the human display name, never the canonical tag (FR4, AC3). */
  readonly titleText: string
  readonly descriptionText: string
}

/** Derive the fixed 8-entry allowlist picker options (FR3, FR4, C13). */
export function deriveAllowlistOptions(): readonly LangLockAllowlistOptionView[] {
  return Allowlist.INITIAL_ALLOWLIST.map((entry) => ({
    tag: entry.tag,
    titleText: entry.display_name,
    descriptionText:
      entry.native_name === entry.display_name ? entry.tag : `${entry.native_name} · ${entry.tag}`,
  }))
}

export * as LangLockSettingsRowState from "./row"
