// Native OutputSpool panel — Feature 007 operator surface for Feature 005's
// canonical paged content plane (T039, FR38, FR41, C23, AC20). Renders the
// bounded, redacted, content-free channel entries for the current Session's
// direct children plus a paged read/follow/tail drill-down, as a thin adapter
// over the Feature 007 registry's `SpoolReaderPort` (`output.stat`/`output.
// read`/`output.follow`; never a divergent hardcoded verb set, never a second
// command registry). Text states are always present alongside any color,
// never color-only, mirroring packages/tui/src/operator/jobs/index.tsx and
// packages/tui/src/operator/langlock/index.tsx conventions.
//
// Content loads only on authorized expand — never the complete output by
// default (FR41, C23) — and a reconnect on an already-loaded, non-eof page
// resumes from that page's opaque follow cursor rather than re-reading from
// offset 0 (C14, C18, C20); see `resolveExpandAction` (./state.ts) for the
// pure decision this component drives.
//
// Wiring point (deliberately not done here): render `<OutputPanel signal=
// {...} onExpand={...} onFollow={...} />` from the Feature 002 process panel
// (packages/tui/src/routes/session/process-panel/**) once a structured
// `SpoolReaderPort` query result — or a live `output.*` watch over the
// observation seam — is threaded through `OperatorSlashPort`
// (packages/tui/src/context/operator-slash.tsx). Today that port only
// returns an `OperatorSlashDisplay` (title/message/variant/outcome strings)
// from `tryHandle`, so there is no structured, redacted `OutputPanelSignal`
// source reachable from the TUI yet. With `signal` omitted the component
// renders `EMPTY_OUTPUT_PANEL_SIGNAL` (no entries, no pages) — a real, honest
// empty state, not a stub — exactly mirroring `EMPTY_LANGLOCK_PANEL_SIGNAL`
// (../langlock/state.ts).
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import {
  deriveDirectChildEntries,
  derivePanelPageView,
  EMPTY_OUTPUT_PANEL_SIGNAL,
  resolveExpandAction,
  type OutputPanelSignal,
} from "./state"
import type { OutputEntryCardView } from "./card"
import type { OutputPageView } from "./page"

export {
  deriveDirectChildEntries,
  derivePanelPageView,
  EMPTY_OUTPUT_PANEL_SIGNAL,
  MAX_VISIBLE_ENTRIES,
  resolveExpandAction,
  type OutputExpandAction,
  type OutputPanelEntry,
  type OutputPanelSignal,
} from "./state"
export { deriveEntryCardView, type OutputEntryCardView } from "./card"
export { decodeBoundedText, derivePageView, MAX_PREVIEW_BYTES, type LoadedOutputPage, type OutputPageView } from "./page"

function EntryRow(props: { view: OutputEntryCardView; expanded: boolean; onOpen: () => void }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => props.onOpen()}
      backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
    >
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text fg={theme.text}>
          <b>{props.view.channelText}</b>
        </text>
        <text fg={theme.textMuted}>{props.view.stateText}</text>
      </box>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.committedBytesText} · {props.view.durabilityTierText}
        {props.view.languageTagText ? ` · ${props.view.languageTagText}` : ""}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        updated {props.view.updatedAtText} · {props.expanded ? "expanded" : "collapsed"}
      </text>
    </box>
  )
}

function PageDetail(props: { view: OutputPageView | null }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show
        when={props.view}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            content not loaded — expand to load a bounded page
          </text>
        }
      >
        {(view) => (
          <box flexDirection="column">
            <text fg={theme.text}>{view().text.length > 0 ? view().text : "(empty page)"}</text>
            {view().truncated ? <text fg={theme.textMuted}>… truncated</text> : null}
            <text fg={theme.textMuted} wrapMode="none">
              next offset {view().nextOffsetText} · committed {view().committedBytesText} · {view().caughtUpText} ·{" "}
              {view().eofText}
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}

export function OutputPanel(props: {
  /** Honest-empty-baseline until a live `SpoolReaderPort` source exists; see ./state.ts. */
  signal?: () => OutputPanelSignal
  /** Fired when an entry with no cached page is expanded; the caller performs `output.read` (FR41, C23). */
  onExpand?: (outputRef: string) => void
  /** Fired when a cached, non-eof page is re-opened; the caller resumes `output.follow(cursor)` (C14, C18). */
  onFollow?: (outputRef: string, cursor: string) => void
}) {
  const { theme } = useTheme()
  const signal = createMemo<OutputPanelSignal>(() => props.signal?.() ?? EMPTY_OUTPUT_PANEL_SIGNAL)
  const [expandedRef, setExpandedRef] = createSignal<string | null>(null)

  const entries = createMemo(() => deriveDirectChildEntries(signal()))
  const pageView = createMemo<OutputPageView | null>(() => {
    const ref = expandedRef()
    return ref === null ? null : derivePanelPageView(signal(), ref)
  })

  function open(outputRef: string) {
    const action = resolveExpandAction(signal(), expandedRef(), outputRef)
    switch (action.kind) {
      case "already-expanded":
        setExpandedRef(null)
        return
      case "load":
        setExpandedRef(outputRef)
        props.onExpand?.(outputRef)
        return
      case "resume":
        setExpandedRef(outputRef)
        props.onFollow?.(outputRef, action.cursor)
        return
      case "loaded":
        setExpandedRef(outputRef)
        return
    }
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show
        when={entries().length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no direct-child output
          </text>
        }
      >
        <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
          <For each={entries()}>
            {(view) => (
              <>
                <EntryRow view={view} expanded={expandedRef() === view.outputRef} onOpen={() => open(view.outputRef)} />
                <Show when={expandedRef() === view.outputRef}>
                  <PageDetail view={pageView()} />
                </Show>
              </>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
