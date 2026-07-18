// Direct-child-only process panel (Feature 002 / T036, FR52–FR58, FR58a,
// C22). Renders a bounded list of cards for the Session currently in view
// and supports inline drill-down into a child Session's own direct children,
// preserving each level's selection on the way back (AC23a–AC23d). Text
// states are always present alongside any color, never color-only (AC34),
// mirroring packages/tui/src/smart/index.ts + subagent-footer.tsx
// conventions.
//
// Wiring point (deliberately not done here): render `<ProcessPanel
// rootSessionId={route.sessionID} />` near `<SubagentFooter />` in
// packages/tui/src/routes/session/index.tsx once a live `signal` accessor
// exists — that file sits outside this feature's guarded scope
// (doc/arch/speckit.toml), and T026 (observation-service.ts) has not been
// authored yet, so there is no live `ProcessPanelSignal` source to wire.
// With `signal` omitted the component renders `EMPTY_PROCESS_PANEL_SIGNAL`
// (no cards, no breadcrumb) — a real, honest empty state, not a stub —
// exactly mirroring the `INACTIVE_SMART_ROUTING_SIGNAL` seam documented in
// packages/tui/src/component/prompt/index.tsx (Feature 001 T039). See
// doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/plan.md
// slice S10 ("Observation streams") for the corpus this awaits.
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../../context/theme"
import { SplitBorder } from "../../../ui/border"
import {
  breadcrumbPath,
  currentSessionId,
  popBreadcrumb,
  pushBreadcrumb,
  ROOT_BREADCRUMB,
  withSelection,
  type BreadcrumbState,
} from "./breadcrumb"
import { deriveDirectChildCards, EMPTY_PROCESS_PANEL_SIGNAL, type ProcessPanelSignal } from "./state"
import type { ProcessCardView } from "./card"

export { EMPTY_PROCESS_PANEL_SIGNAL, MAX_VISIBLE_CARDS, deriveDirectChildCards } from "./state"
export type { ProcessPanelSignal } from "./state"
export { deriveCardView, type ProcessCardActivity, type ProcessCardInput, type ProcessCardView } from "./card"
export { breadcrumbPath, popBreadcrumb, pushBreadcrumb, ROOT_BREADCRUMB, withSelection } from "./breadcrumb"
export type { BreadcrumbEntry, BreadcrumbState } from "./breadcrumb"
export { deriveCtrlCAction, deriveEscAction, type PanelKeyAction, type PanelKeyContext } from "./keymap"

function statusTone(view: ProcessCardView, theme: ReturnType<typeof useTheme>["theme"]) {
  if (view.statusText === "failed" || view.statusText === "zombie") return theme.error
  if (view.isTerminal) return theme.textMuted
  return theme.text
}

function Card(props: { view: ProcessCardView; onOpen: () => void }) {
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
        <box flexDirection="row" gap={1}>
          <text fg={theme.text}>
            <b>{props.view.agentLabel}</b>
          </text>
          <Show when={props.view.hierarchyRole}>{(role) => <text fg={theme.textMuted}>({role()})</text>}</Show>
        </box>
        <text fg={statusTone(props.view, theme)}>{props.view.statusText}</text>
      </box>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.modelLabel}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.activityText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.usageText}
      </text>
      <Show when={props.view.validationOutcome}>
        {(outcome) => <text fg={theme.textMuted}>validation: {outcome()}</text>}
      </Show>
    </box>
  )
}

export function ProcessPanel(props: {
  /** Root Session id; the panel's breadcrumb path always resolves back to this. */
  rootSessionId: string
  /** Honest-empty-baseline until a live push source exists (T026); see ./state.ts. */
  signal?: () => ProcessPanelSignal
}) {
  const { theme } = useTheme()
  const [breadcrumb, setBreadcrumb] = createSignal<BreadcrumbState>(ROOT_BREADCRUMB)
  const signal = createMemo<ProcessPanelSignal>(() => props.signal?.() ?? EMPTY_PROCESS_PANEL_SIGNAL)

  const viewSessionId = createMemo(() => currentSessionId(breadcrumb(), props.rootSessionId))

  const cards = createMemo(() =>
    deriveDirectChildCards({ currentSessionId: viewSessionId(), cards: signal().cards }),
  )

  const path = createMemo(() => breadcrumbPath(breadcrumb()))

  function open(view: ProcessCardView) {
    setBreadcrumb((state) =>
      pushBreadcrumb(withSelection(state, view.processId), {
        sessionId: view.processId,
        label: view.agentLabel,
        selectedProcessId: null,
      }),
    )
  }

  function back() {
    setBreadcrumb((state) => popBreadcrumb(state))
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={breadcrumb().stack.length > 0}>
        <box flexDirection="row" gap={1} paddingLeft={1} onMouseUp={back}>
          <text fg={theme.textMuted}>{"< back"}</text>
          <text fg={theme.textMuted}>{path()}</text>
        </box>
      </Show>
      <Show when={cards().length > 0} fallback={<box />}>
        <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
          <For each={cards()}>{(view) => <Card view={view} onOpen={() => open(view)} />}</For>
        </box>
      </Show>
    </box>
  )
}
