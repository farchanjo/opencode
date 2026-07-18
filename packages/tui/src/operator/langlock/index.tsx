// Native Lang Lock panel — Feature 007 operator surface for Feature 004's
// configurable artifact language lock (T036, FR31, FR32, C13). Renders the
// redacted, versioned effective policy (tag, scope/origin, enforcement mode,
// hard-policy floor) plus the bounded, content-free advisory history, as a
// thin adapter over the Feature 007 registry's `LangLockPolicyPort`/
// `AdvisoryPort` (never a divergent hardcoded verb set, never a second
// command registry). Text states are always present alongside any color,
// never color-only (C13), mirroring packages/tui/src/operator/jobs/index.tsx
// conventions.
//
// Wiring point (deliberately not done here): render `<LangLockPanel signal=
// {...} />` from the Operator Settings surface (packages/tui/src/operator/
// dialog-settings.tsx) once a structured `LangLockPolicyPort`/`AdvisoryPort`
// query result — or a live `langlock.*` watch over the observation seam — is
// threaded through `OperatorSlashPort` (packages/tui/src/context/
// operator-slash.tsx). Today that port only returns an `OperatorSlashDisplay`
// (title/message/variant/outcome strings) from `tryHandle`, so there is no
// structured, redacted `LangLockPanelSignal` source reachable from the TUI
// yet. With `signal` omitted the component renders
// `EMPTY_LANGLOCK_PANEL_SIGNAL` (no policy card, no advisory rows) — a real,
// honest empty state, not a stub — exactly mirroring `EMPTY_JOBS_PANEL_SIGNAL`
// (../jobs/state.ts).
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import {
  deriveVisibleAdvisories,
  derivePolicyView,
  EMPTY_LANGLOCK_PANEL_SIGNAL,
  type LangLockPanelSignal,
} from "./state"
import type { LangLockPolicyCardView } from "./card"
import type { AdvisoryRowView } from "./history"

export {
  deriveVisibleAdvisories,
  derivePolicyView,
  EMPTY_LANGLOCK_PANEL_SIGNAL,
  MAX_VISIBLE_ADVISORIES,
  type LangLockPanelSignal,
} from "./state"
export { derivePolicyCardView, type LangLockPolicyCardView } from "./card"
export { deriveAdvisoryRowView, type AdvisoryRowView } from "./history"

function PolicyCard(props: { view: LangLockPolicyCardView }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text fg={theme.text}>
          <b>{props.view.displayNameText}</b>
        </text>
        <text fg={props.view.enabledText === "enabled" ? theme.text : theme.textMuted}>
          {props.view.enabledText}
        </text>
      </box>
      <text fg={theme.textMuted} wrapMode="none">
        scope: {props.view.scopeText} · origin: {props.view.originText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        enforcement: {props.view.enforcementModeText} · floor: {props.view.hardPolicyFloorText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        override: {props.view.overrideAuthorizedText} · {props.view.policyVersionText} · updated{" "}
        {props.view.updatedAtText}
      </text>
    </box>
  )
}

function AdvisoryRow(props: { view: AdvisoryRowView }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={theme.text} wrapMode="none">
        {props.view.stateText} · {props.view.pathKindText} · {props.view.confidenceBucketText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.view.detectorProvenanceText} · remediation: {props.view.remediationStatusText} ·{" "}
        {props.view.policyVersionText}
      </text>
    </box>
  )
}

export function LangLockPanel(props: {
  /** Honest-empty-baseline until a live `LangLockPolicyPort`/`AdvisoryPort` source exists; see ./state.ts. */
  signal?: () => LangLockPanelSignal
}) {
  const { theme } = useTheme()
  const signal = createMemo<LangLockPanelSignal>(() => props.signal?.() ?? EMPTY_LANGLOCK_PANEL_SIGNAL)
  const policy = createMemo(() => derivePolicyView(signal()))
  const advisories = createMemo(() => deriveVisibleAdvisories(signal()))

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show
        when={policy()}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            Lang Lock policy unavailable
          </text>
        }
      >
        {(view) => <PolicyCard view={view()} />}
      </Show>
      <Show
        when={advisories().length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no advisory history
          </text>
        }
      >
        <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
          <For each={advisories()}>{(view) => <AdvisoryRow view={view} />}</For>
        </box>
      </Show>
    </box>
  )
}
