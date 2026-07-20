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
import { createMemo, createSignal, onMount, type JSX } from "solid-js"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import type { OperatorSlashPort } from "../../context/operator-slash"
import type { DialogContext } from "../../ui/dialog"
import { DialogSelect } from "../../ui/dialog-select"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { executeOperatorCommand, type OperatorToast } from "../execute"
import type { OperatorFormField, OperatorFormOption, OperatorPickerSource } from "./descriptor"

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
  /** Optional title override (defaults to the verb's centralised `{Domain} {action}` copy). */
  readonly title?: string
  /** Optional value_picker option category label. */
  readonly category?: string
  /** Return-to-caller navigation (back / cancel). Defaults to clearing the dialog. */
  readonly back?: () => void
}

/** The generalised Configure form; branches on the descriptor's input mode (FR5). */
export function OperatorForm(props: OperatorFormProps): JSX.Element {
  const [busy, setBusy] = createSignal(false)
  // Loaded entity-picker options (Feature 012 T010/T011): `undefined` until the
  // read query resolves; an unavailable read resolves to `[]` (honest empty).
  const [loaded, setLoaded] = createSignal<readonly OperatorFormOption[] | undefined>(undefined)

  // Issue the picker's source read through the SAME executeOperatorCommand path on
  // open and project its `effective` payload into options (FR6, FR8). No source →
  // the field's static options (e.g. the langlock allowlist) are used unchanged.
  onMount(() => {
    if (props.field.mode === "value_picker" && props.field.source) void loadPickerOptions(props.field.source)
  })

  async function loadPickerOptions(source: OperatorPickerSource) {
    const readEntry = listOperatorPaletteEntries().find((entry) => entry.id === source.read)
    if (!readEntry) {
      setLoaded([])
      return
    }
    const result = await executeOperatorCommand({
      entry: readEntry,
      port: props.port,
      projectId: props.projectId,
      sessionId: props.sessionId,
      dialog: props.dialog,
      toast: props.toast,
      // Auto-issued picker read (Feature 012 P1): no toast on open — the
      // process/task pickers must not flash an `invalid_argument` warning; an
      // unavailable read renders the honest empty picker instead.
      silent: true,
    })
    setLoaded(source.project(result.result?.effective))
  }

  async function dispatchPayload(payload: Record<string, unknown>) {
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
        payload,
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
    // A source-backed picker shows the loaded options (honest-empty while the read
    // resolves); a static picker uses its fixed option set (FR6, FR8).
    const pickerOptions = createMemo<readonly OperatorFormOption[]>(() => (field.source ? (loaded() ?? []) : field.options()))
    return (
      <DialogSelect
        title={props.title ?? props.entry.title}
        options={pickerOptions().map((option) => ({
          title: option.title,
          description: option.description,
          category: props.category ?? props.entry.verbLabel,
          value: option.value,
          onSelect: () => {
            void dispatchPayload({ [field.key]: option.value })
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

  // Unreachable: `dialog-settings.tsx`'s `onSelectSetting` is the only router that
  // can feed a Configure verb's field into this form, and it sends a `model_picker`
  // field down the `openOperatorEditModal` branch instead — a `model_picker` field's
  // `source` is structurally always `undefined` (descriptor.ts), so its
  // `field.mode === "text_input" || !field.source` guard is always true for this
  // mode. `entity-screens.tsx` never calls `openOperatorForm` at all. Verified by a
  // full-repo caller trace during the Feature 020 review; kept as a loud invariant
  // (not a silent render) so a future router change that actually reaches this path
  // fails fast instead of shipping the unmaintained duplicate UI this replaced.
  if (props.field.mode === "model_picker") {
    throw new Error("OperatorForm: model_picker is not supported here — it always routes through openOperatorEditModal")
  }

  const field = props.field
  function submitText(raw: string) {
    const validation = field.validate(raw)
    if (!validation.ok) {
      props.toast.show({ title: props.entry.verbLabel, message: validation.message, variant: "warning" })
      return
    }
    void dispatchPayload(field.toPayload(validation.value))
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
