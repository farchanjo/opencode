// Pure signal-and-projection layer for the OutputSpool panel (Feature 005 /
// T039, FR38, FR41, C22, C23, AC20). No I/O, no solid-js — safe to recompute
// on every render, mirroring packages/tui/src/operator/langlock/state.ts
// (Feature 004 T036) and the direct-child filter in
// packages/tui/src/routes/session/process-panel/state.ts (Feature 002 T036).
//
// Direct-child-only (FR38, AC20): Feature 002 owns the Session hierarchy; this
// panel never recurses into grandchildren. A row is a direct child of the
// current Session iff its `parentSessionId` equals `currentSessionId`,
// exactly mirroring process-panel's `parent_session_id` filter.

import type { OutputStat } from "@opencode-ai/protocol/outputspool/commands"
import { deriveEntryCardView, type OutputEntryCardView } from "./card"
import { derivePageView, type LoadedOutputPage, type OutputPageView } from "./page"
import { emptyFallback, isPresent, isRecord, projected, shapeMismatch, type PanelProjection } from "../projection"

/** One channel entry plus the Feature 002 Session it is a direct child of (FR38, AC20). */
export interface OutputPanelEntry {
  readonly parentSessionId: string
  readonly stat: OutputStat
}

/**
 * Raw output signal the caller assembles from the Feature 007 registry's
 * `SpoolReaderPort.stat`/`read`/`follow` reads. Every field here is already
 * the bounded, redacted, content-free operator-surface projection — this
 * module never widens or resolves anything further, and never fetches a page
 * itself (FR38, C23: "loads content only on authorized expand/read").
 * `pages` holds only the pages a caller has ALREADY loaded via an authorized
 * `output.read`/`output.follow` call in response to an `onExpand`/`onFollow`
 * callback (see ./index.tsx); an entry absent from `pages` renders an honest
 * "not loaded" state rather than an invented page.
 */
export interface OutputPanelSignal {
  readonly currentSessionId: string
  readonly entries: readonly OutputPanelEntry[]
  readonly pages: Readonly<Record<string, LoadedOutputPage>>
}

/**
 * Safe default: no current session, no entries, no loaded pages. Used until a
 * live `SpoolReaderPort` source is wired into this component; the panel
 * renders nothing rather than inventing a row or a page. See
 * ../langlock/state.ts's `EMPTY_LANGLOCK_PANEL_SIGNAL` wiring point for the
 * identical precedent this mirrors: the TUI operator surface
 * (`packages/tui/src/context/operator-slash.tsx`) currently exposes only a
 * request/response `tryHandle` returning an `OperatorSlashDisplay` (title/
 * message/variant/outcome strings), not a structured `SpoolReaderPort` query
 * result or a live `output.*` observation stream, so there is no live
 * `OutputPanelSignal` source to wire yet. Once either seam exists — or the
 * Feature 002 process panel (`packages/tui/src/routes/session/process-panel/
 * **`) threads its direct-child OutputRef set through — wire it through
 * `<OutputPanel signal={...} />` (see ./index.tsx) without changing this
 * module's shape.
 */
export const EMPTY_OUTPUT_PANEL_SIGNAL: OutputPanelSignal = { currentSessionId: "", entries: [], pages: {} }

/** Bounded row count rendered per panel view (mirrors jobs'/process-panel's C22 bound). */
export const MAX_VISIBLE_ENTRIES = 50

/** Direct-child-only, bounded, order-preserving entry card list (FR38, AC20, C22). */
export function deriveDirectChildEntries(signal: OutputPanelSignal): readonly OutputEntryCardView[] {
  if (!signal.currentSessionId) return []
  return signal.entries
    .filter((entry) => entry.parentSessionId === signal.currentSessionId)
    .slice(0, MAX_VISIBLE_ENTRIES)
    .map((entry) => deriveEntryCardView(entry.stat))
}

/** The loaded page view for one OutputRef, or null when not yet loaded (honest "not loaded" baseline). */
export function derivePanelPageView(signal: OutputPanelSignal, outputRef: string): OutputPageView | null {
  const loaded = signal.pages[outputRef]
  return loaded === undefined ? null : derivePageView(loaded)
}

/**
 * The action an expand/click on one entry should take (FR41, C14, C18, C23):
 * - `already-expanded` — collapse; nothing is fetched.
 * - `load` — no page cached yet; the caller performs a bounded
 *   `output.read` (content loads only on authorized expand, never eagerly).
 * - `resume` — a page is cached but not `eof` and carries a follow cursor;
 *   the caller resumes via `output.follow(cursor)` rather than re-reading
 *   from offset 0, exactly the "resume from an opaque cursor on reconnect"
 *   contract (C14, C18).
 * - `loaded` — a page is cached and either `eof` or carries no cursor;
 *   nothing further to fetch.
 */
export type OutputExpandAction =
  | { readonly kind: "already-expanded" }
  | { readonly kind: "load" }
  | { readonly kind: "resume"; readonly cursor: string }
  | { readonly kind: "loaded" }

/** Pure decision function backing the panel's expand/click handler (see ./index.tsx). */
export function resolveExpandAction(
  signal: OutputPanelSignal,
  expandedRef: string | null,
  outputRef: string,
): OutputExpandAction {
  if (expandedRef === outputRef) return { kind: "already-expanded" }
  const loaded = signal.pages[outputRef]
  if (loaded === undefined) return { kind: "load" }
  if (!loaded.page.eof && loaded.cursor) return { kind: "resume", cursor: loaded.cursor }
  return { kind: "loaded" }
}

// =============================================================================
// Structured-result projection (Feature 012 / T006, FR4, FR8)
// =============================================================================

/** Content-free `OutputStat` guard; validates the redacted ref + channel + byte fields. */
function isOutputStat(value: unknown): value is OutputStat {
  return (
    isRecord(value) &&
    typeof value.outputRef === "string" &&
    typeof value.channel === "string" &&
    typeof value.state === "string" &&
    typeof value.committedBytes === "number" &&
    typeof value.updatedAt === "string"
  )
}

/** One panel entry guard: a direct-child Session ref plus a valid `OutputStat`. */
function isOutputPanelEntry(value: unknown): value is OutputPanelEntry {
  return isRecord(value) && typeof value.parentSessionId === "string" && isOutputStat(value.stat)
}

/**
 * Total projection of an `output.stat`/`read` structured-result `effective`
 * payload onto the `OutputPanelSignal` (FR4, FR8). `output` reads are honest-
 * unavailable today (FR8), so the runtime path resolves to `empty_fallback` until
 * a later backend feature; the projection is written total regardless. Absent →
 * `empty_fallback`; a malformed shape → `shape_mismatch`; both degrade to
 * `EMPTY_OUTPUT_PANEL_SIGNAL`. Never throws, never fetches a page. `pages` stays
 * empty: a stat/read list never carries loaded page bodies — the panel loads them
 * lazily on an authorized expand (see `resolveExpandAction`, C23).
 */
export function projectOutputSignal(effective: unknown): PanelProjection<OutputPanelSignal> {
  if (!isPresent(effective)) return emptyFallback(EMPTY_OUTPUT_PANEL_SIGNAL)
  if (!isRecord(effective) || typeof effective.currentSessionId !== "string" || !Array.isArray(effective.entries)) {
    return shapeMismatch(EMPTY_OUTPUT_PANEL_SIGNAL)
  }
  if (!effective.entries.every(isOutputPanelEntry)) return shapeMismatch(EMPTY_OUTPUT_PANEL_SIGNAL)
  return projected({ currentSessionId: effective.currentSessionId, entries: effective.entries, pages: {} })
}

export * as OutputPanelState from "./state"
