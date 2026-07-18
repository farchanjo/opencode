// Native Jobs panel — Feature 007 operator surface for Feature 003 scheduled
// jobs (T030, FR30, C12). Renders the bounded, redacted, versioned Job
// Definition list plus a per-definition occurrence/notification history
// drill-down, as a thin adapter over the Feature 007 registry's `JobsPort`
// (never a divergent hardcoded verb set, never a second command registry).
// Text states are always present alongside any color, never color-only,
// mirroring packages/tui/src/routes/session/process-panel/index.tsx +
// packages/tui/src/smart/index.ts conventions.
//
// Wiring point (deliberately not done here): render `<JobsPanel signal={...}
// />` from the Operator Settings surface (packages/tui/src/operator/
// dialog-settings.tsx) once a structured `JobsPort` query result — or a live
// `job.*` watch over the observation seam — is threaded through
// `OperatorSlashPort` (packages/tui/src/context/operator-slash.tsx). Today
// that port only returns an `OperatorSlashDisplay` (title/message/variant/
// outcome strings) from `tryHandle`, so there is no structured, redacted
// `JobsPanelSignal` source reachable from the TUI yet. With `signal` omitted
// the component renders `EMPTY_JOBS_PANEL_SIGNAL` (no cards, no detail) — a
// real, honest empty state, not a stub — exactly mirroring the
// `EMPTY_PROCESS_PANEL_SIGNAL` seam this module's ./state.ts documents. See
// doc/arch/sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/plan.md
// slice S17 for the corpus this awaits.
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import {
  deriveDefinitionHistory,
  deriveVisibleDefinitionCards,
  EMPTY_JOBS_PANEL_SIGNAL,
  type JobDefinitionHistoryView,
  type JobsPanelSignal,
} from "./state"
import type { JobDefinitionCardView } from "./card"
import type { NotificationRowView, OccurrenceRowView } from "./history"

export {
  deriveDefinitionHistory,
  deriveVisibleDefinitionCards,
  EMPTY_JOBS_PANEL_SIGNAL,
  MAX_VISIBLE_DEFINITIONS,
  MAX_VISIBLE_NOTIFICATIONS,
  MAX_VISIBLE_OCCURRENCES,
  type JobDefinitionHistoryView,
  type JobsPanelSignal,
} from "./state"
export { deriveDefinitionCardView, type JobDefinitionCardView } from "./card"
export {
  deriveNotificationRowView,
  deriveOccurrenceRowView,
  type NotificationRowView,
  type OccurrenceRowView,
} from "./history"

function registrationTone(view: JobDefinitionCardView, theme: ReturnType<typeof useTheme>["theme"]) {
  if (view.registrationStateText.startsWith("unknown")) return theme.error
  if (!view.enabledText.startsWith("enabled")) return theme.textMuted
  return theme.text
}

function DefinitionCard(props: { view: JobDefinitionCardView; onOpen: () => void }) {
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
          <b>{props.view.nameText}</b>
        </text>
        <text fg={registrationTone(props.view, theme)}>{props.view.registrationStateText}</text>
      </box>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.scheduleText} · {props.view.enabledText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        next: {props.view.nextDueText} · last: {props.view.lastOutcomeText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.actionTypeText} · overlap: {props.view.overlapPolicyText} · misfire: {props.view.misfirePolicyText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.versionText} · updated {props.view.updatedAtText}
      </text>
    </box>
  )
}

function OccurrenceRow(props: { view: OccurrenceRowView }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={theme.text} wrapMode="none">
        {props.view.nominalDueAtText} · {props.view.stateText} · {props.view.outcomeText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.attemptText} · {props.view.processText}
      </text>
    </box>
  )
}

function NotificationRow(props: { view: NotificationRowView }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={theme.text} wrapMode="none">
        {props.view.typeText} · {props.view.priorityText} · {props.view.deliveryStateText}/{props.view.ackStateText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.summaryText}
      </text>
    </box>
  )
}

function DefinitionDetail(props: { history: JobDefinitionHistoryView; onBack: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} paddingLeft={1} onMouseUp={props.onBack}>
        <text fg={theme.textMuted}>{"< back"}</text>
      </box>
      <Show
        when={props.history.occurrences.length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no occurrence history
          </text>
        }
      >
        <For each={props.history.occurrences}>{(view) => <OccurrenceRow view={view} />}</For>
      </Show>
      <Show
        when={props.history.notifications.length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no notification history
          </text>
        }
      >
        <For each={props.history.notifications}>{(view) => <NotificationRow view={view} />}</For>
      </Show>
    </box>
  )
}

export function JobsPanel(props: {
  /** Honest-empty-baseline until a live `JobsPort` source exists; see ./state.ts. */
  signal?: () => JobsPanelSignal
}) {
  const { theme } = useTheme()
  const signal = createMemo<JobsPanelSignal>(() => props.signal?.() ?? EMPTY_JOBS_PANEL_SIGNAL)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  const cards = createMemo(() => deriveVisibleDefinitionCards(signal()))
  const history = createMemo<JobDefinitionHistoryView | null>(() => {
    const id = selectedId()
    return id === null ? null : deriveDefinitionHistory(signal(), id)
  })

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show
        when={history()}
        fallback={
          <Show when={cards().length > 0} fallback={<box />}>
            <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
              <For each={cards()}>
                {(view) => <DefinitionCard view={view} onOpen={() => setSelectedId(view.jobDefinitionId)} />}
              </For>
            </box>
          </Show>
        }
      >
        {(view) => <DefinitionDetail history={view()} onBack={() => setSelectedId(null)} />}
      </Show>
    </box>
  )
}
