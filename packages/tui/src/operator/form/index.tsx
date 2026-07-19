/**
 * Reusable operator Configure form (Feature 011 T010–T011, FR5, FR8).
 * Generalises the `DialogLangLockPicker` pattern
 * (packages/tui/src/settings/langlock/index.tsx): driven by the per-verb
 * `OperatorFormField` descriptor, it renders a `value_picker` (a bounded option
 * list) or a `text_input` (free-form text), collects a single typed payload
 * field, and dispatches it through the SAME `executeOperatorCommand` path as
 * slash/CLI — no new dispatch path, no command id built from free text (FR8).
 * Confirm-required verbs surface `DialogConfirm` inside that path automatically;
 * honest-unavailable verbs surface the typed envelope and never a synthesized
 * success (FR7). Secret material is never rendered, echoed, or persisted here.
 */
import { createSignal, type JSX } from "solid-js"
import type { OperatorPaletteEntry } from "@opencode-ai/core/operator"
import type { OperatorSlashPort } from "../../context/operator-slash"
import type { DialogContext } from "../../ui/dialog"
import { DialogSelect } from "../../ui/dialog-select"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { executeOperatorCommand, type OperatorToast } from "../execute"
import type { OperatorFormField } from "./descriptor"

export { resolveOperatorFormField } from "./descriptor"
export type { OperatorFormField, OperatorFormOption, OperatorFormValidation } from "./descriptor"

const SUCCESS_OUTCOMES = new Set(["success", "idempotent_replay"])

export type OperatorFormProps = {
  readonly entry: OperatorPaletteEntry
  readonly field: OperatorFormField
  readonly port: OperatorSlashPort | undefined
  readonly projectId?: string | null
  readonly sessionId?: string | null
  readonly dialog: DialogContext
  readonly toast: OperatorToast
  /** Optional title override (defaults to the verb's centralised `Configure: …` copy). */
  readonly title?: string
  /** Optional value_picker option category label. */
  readonly category?: string
  /** Return-to-caller navigation (back / cancel). Defaults to clearing the dialog. */
  readonly back?: () => void
}

/** The generalised Configure form; branches on the descriptor's input mode (FR5). */
export function OperatorForm(props: OperatorFormProps): JSX.Element {
  const [busy, setBusy] = createSignal(false)

  async function dispatchPayload(value: string) {
    if (busy()) return
    setBusy(true)
    try {
      const result = await executeOperatorCommand({
        entry: props.entry,
        port: props.port,
        projectId: props.projectId,
        sessionId: props.sessionId,
        dialog: props.dialog,
        toast: props.toast,
        payload: { [props.field.key]: value },
      })
      if (result.outcome && SUCCESS_OUTCOMES.has(result.outcome)) props.dialog.clear()
    } finally {
      setBusy(false)
    }
  }

  function goBack() {
    if (props.back) props.back()
    else props.dialog.clear()
  }

  if (props.field.mode === "value_picker") {
    const field = props.field
    return (
      <DialogSelect
        title={props.title ?? props.entry.title}
        options={field.options().map((option) => ({
          title: option.title,
          description: option.description,
          category: props.category ?? props.entry.verbLabel,
          value: option.value,
          onSelect: () => {
            void dispatchPayload(option.value)
          },
        }))}
        emptyView={<text>{field.emptyText}</text>}
        footerHints={[
          { title: "esc", label: "back", side: "right" },
          { title: "enter", label: "set", side: "right" },
        ]}
      />
    )
  }

  const field = props.field
  function submitText(raw: string) {
    const validation = field.validate(raw)
    if (!validation.ok) {
      props.toast.show({ title: props.entry.verbLabel, message: validation.message, variant: "warning" })
      return
    }
    void dispatchPayload(validation.value)
  }

  return (
    <DialogPrompt
      title={props.title ?? props.entry.title}
      placeholder={field.placeholder}
      busy={busy()}
      onConfirm={submitText}
      onCancel={goBack}
    />
  )
}

/** Factory for `dialog.replace` that mounts the Configure form (T011). */
export function openOperatorForm(props: OperatorFormProps): () => JSX.Element {
  return () => <OperatorForm {...props} />
}
