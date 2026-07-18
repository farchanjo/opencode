// Derives the text-plus-theme view rendered by the Smart indicator from a
// resolved SmartIndicatorState. Pure and cheap: safe to recompute on every
// render (spec item 32 — text-first, theme-aware, never color-only).

import type { SmartIndicatorState } from "@opencode-ai/schema/tui/smart-state"

export type SmartLabelTone = "critical" | "default"

export interface SmartLabelView {
  /** Rendered label text. "Smart" when active, the fallback text otherwise. */
  readonly text: string
  /** Caller maps this to a theme color; "critical" -> theme.error. */
  readonly tone: SmartLabelTone
  /** Degraded reason surfaced alongside the fallback label, if any. */
  readonly detail: string | null
}

const SMART_ACTIVE_TEXT = "Smart"

export function deriveSmartLabel(state: SmartIndicatorState): SmartLabelView {
  if (state.active) {
    return { text: SMART_ACTIVE_TEXT, tone: "critical", detail: null }
  }
  return { text: state.fallback_text, tone: "default", detail: state.degraded_reason }
}
