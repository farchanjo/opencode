// Pure direct-child-only projection for the process panel (Feature 002 /
// T036, FR52, FR58a, C22). No I/O, no solid-js — safe to recompute on every
// render, mirroring packages/tui/src/routing-state/index.ts.
//
// Session views MUST NOT flatten grandchildren (FR52): a row is a direct
// child of the current Session iff `parent_session_id === currentSessionId`.
// Deeper descendants stay hidden until their own Session is opened (FR58a).

import { ProcessCard, type ProcessCardInput, type ProcessCardView } from "./card"

/** Raw session signal the caller assembles from live application state. */
export interface ProcessPanelSignal {
  readonly currentSessionId: string
  readonly cards: readonly ProcessCardInput[]
}

/**
 * Safe default: no current session, no cards. Used until a live push source
 * exists (T026 observation service); the panel renders nothing rather than
 * inventing rows. See ../../component/prompt/index.tsx's
 * `INACTIVE_SMART_ROUTING_SIGNAL` wiring point for the precedent this
 * mirrors, and doc/arch/sdd/002-.../data-model.md for the source-of-truth
 * corpus this awaits.
 */
export const EMPTY_PROCESS_PANEL_SIGNAL: ProcessPanelSignal = { currentSessionId: "", cards: [] }

/**
 * Bounded row count rendered per Session view. C22 leaves the exact figure a
 * provisional plan-phase UX constant; this bound only guards against an
 * unbounded render — it is not the accepted numeric.
 */
export const MAX_VISIBLE_CARDS = 50

/**
 * Direct-child-only, bounded, oldest-first card list for the current Session
 * (FR52, FR58a, C22). Never includes grandchildren; never exceeds
 * `MAX_VISIBLE_CARDS`.
 */
export function deriveDirectChildCards(signal: ProcessPanelSignal): readonly ProcessCardView[] {
  if (!signal.currentSessionId) return []
  const directChildren = signal.cards.filter(
    (card) => card.row.lineage.relations.parent_session_id === signal.currentSessionId,
  )
  return directChildren.slice(0, MAX_VISIBLE_CARDS).map(ProcessCard.deriveCardView)
}

export * as ProcessPanelState from "./state"
