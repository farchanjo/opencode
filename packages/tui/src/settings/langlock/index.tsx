// Native Settings "Lang Lock" row — Feature 007 operator surface for Feature
// 004's configurable artifact language lock (T034, FR31, FR4, C13). Presents
// "Artifact language" with human/native display names — separate from any "UI
// Language" row (packages/app/src/context/language.tsx,
// packages/desktop/src/renderer/i18n/index.ts; Lang Lock never reads or
// mutates that axis, C1) — and never surfaces the canonical BCP 47 tag as the
// primary label (FR4, AC3). The picker dispatches through the Feature 007
// registry's `langlock.set` command (registry-generated id, never a
// divergent hardcoded verb), mirroring
// packages/tui/src/component/dialog-theme-list.tsx's pick-from-list
// interaction and packages/tui/src/operator/dialog-settings.tsx's
// `executeOperatorCommand` dispatch.
//
// Wiring point (deliberately not done here): pass a live `policy` accessor
// once a structured `LangLockPolicyPort.resolve` query result is reachable
// from the TUI — see ../../operator/langlock/state.ts's
// `EMPTY_LANGLOCK_PANEL_SIGNAL` doc for the identical seam this awaits. With
// `policy` omitted the row renders `EMPTY_LANGLOCK_SETTINGS_ROW` — a real,
// honest empty state, not a stub.
import { createMemo } from "solid-js"
import { listOperatorSettingsEntries } from "@opencode-ai/core/operator"
import type { LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"
import { useTheme } from "../../context/theme"
import { useOperatorSlash } from "../../context/operator-slash"
import { useDialog } from "../../ui/dialog"
import { DialogSelect } from "../../ui/dialog-select"
import { useToast } from "../../ui/toast"
import { OperatorForm, resolveOperatorFormField } from "../../operator/form"
import {
  deriveLangLockSettingsRow,
  EMPTY_LANGLOCK_SETTINGS_ROW,
  SETTINGS_ROW_LABEL,
  type LangLockSettingsRowView,
} from "./row"

export {
  deriveAllowlistOptions,
  deriveLangLockSettingsRow,
  EMPTY_LANGLOCK_SETTINGS_ROW,
  SETTINGS_ROW_LABEL,
  type LangLockAllowlistOptionView,
  type LangLockSettingsRowView,
} from "./row"

/**
 * Picker dialog for the allowlisted artifact-language tags (FR3, FR4, C13).
 * Delegates to the generalised operator Configure form (Feature 011 T010/T011)
 * driven by `langlock.set`'s `value_picker` descriptor — the single source of the
 * allowlist tag picker semantics, dispatched through the same
 * executeOperatorCommand path (FR8). No duplicated dispatch logic here.
 */
export function DialogLangLockPicker() {
  const dialog = useDialog()
  const toast = useToast()
  const operator = useOperatorSlash()
  const setEntry = listOperatorSettingsEntries("langlock").find((entry) => entry.operation === "set")
  const field = setEntry ? resolveOperatorFormField(setEntry) : undefined

  if (!setEntry || !field) {
    return (
      <DialogSelect title={SETTINGS_ROW_LABEL} options={[]} emptyView={<text>langlock.set is not registered</text>} />
    )
  }

  return (
    <OperatorForm
      entry={setEntry}
      field={field}
      port={operator.port}
      dialog={dialog}
      toast={toast}
      title={SETTINGS_ROW_LABEL}
      category="Lang Lock"
      back={() => dialog.clear()}
    />
  )
}

/** The Settings "Lang Lock" row: "Artifact language" with human/native names (FR31, C13). */
export function LangLockSettingsRow(props: {
  /** Honest-empty-baseline until a live `LangLockPolicyPort.resolve` source exists; see ./row.ts. */
  policy?: () => LangLockPolicySummary | null
}) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const view = createMemo<LangLockSettingsRowView>(() => {
    const policy = props.policy?.() ?? null
    return policy === null ? EMPTY_LANGLOCK_SETTINGS_ROW : deriveLangLockSettingsRow(policy)
  })

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={() => dialog.replace(() => <DialogLangLockPicker />)}
    >
      <text fg={theme.text}>{view().labelText}</text>
      <text fg={theme.textMuted}>{view().valueText}</text>
    </box>
  )
}
