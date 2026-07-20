/**
 * Operator edit modal (Feature 015 T010–T012, FR9, FR10, FR12, FR16, FR18). A
 * small operator-scoped component over the existing Dialog push/back-stack — NOT a
 * new dialog primitive — for editing one setting:
 *
 * - On open it issues a SILENT current-value read and PRE-FILLS the field, so a
 *   text input never starts empty; an honest absence renders an empty field with a
 *   placeholder, never a fabricated default (FR9, FR10).
 * - It validates the field IN-MODAL before dispatch; an invalid value surfaces its
 *   reason in the modal, not a toast (FR12, FR18).
 * - Save dispatches through the SAME executeOperatorCommand loopback as slash/CLI
 *   (no new dispatch path, FR17), closes the modal on a committed outcome, and
 *   surfaces a typed, bounded, secret-free failure reason IN-MODAL (FR12, FR18).
 */
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, onMount, Show, type JSX } from "solid-js"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import type { OperatorSlashPort } from "../../context/operator-slash"
import type { DialogContext } from "../../ui/dialog"
import { useTheme } from "../../context/theme"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect } from "../../ui/dialog-select"
import { executeOperatorCommand, type OperatorToast } from "../execute"
import { resolveOperatorEditPrefill } from "./edit-descriptor"
import { ModelPicker, promptCustomModelId } from "./model-picker"
import type { OperatorFormField } from "./descriptor"

/** Outcomes that committed the mutation — the only ones that close the modal (FR9). */
const SUCCESS_OUTCOMES = new Set(["success", "idempotent_replay"])

export type OperatorEditModalProps = {
  readonly entry: OperatorPaletteEntry
  readonly field: OperatorFormField
  readonly port: OperatorSlashPort | undefined
  readonly projectId?: string | null
  readonly sessionId?: string | null
  readonly dialog: DialogContext
  readonly toast: OperatorToast
  /** Optional title override (defaults to the verb's centralised `{Domain} {action}` copy). */
  readonly title?: string
  /**
   * Optional fixed payload merged UNDER the field payload on dispatch — the entity
   * CRUD item screens seed the selected entity id (`{ jobDefinitionId }`/`{ id }`)
   * so an edit/reschedule targets that row (FR12-FR14). Same command id, same
   * loopback (FR17); a field key always wins over a base key.
   */
  readonly basePayload?: Record<string, unknown>
  /** Fired on a committed save (before the modal pops) so a caller can refetch its list (FR6). */
  readonly onSaved?: () => void
}

/**
 * Map a non-committed dispatch result to the bounded, secret-free reason surfaced
 * in-modal (FR12, FR18). Prefers the dispatch's own display message; falls back to
 * the typed outcome so the operator always sees *why*, never a stack trace or a raw
 * payload.
 */
export function failureReason(result: { outcome?: string; display?: { message: string } }): string {
  if (result.display?.message) return result.display.message
  return result.outcome ? `Save failed: ${result.outcome}` : "Save failed"
}

/** The pre-filled, validated edit modal for one editable setting (FR9, FR16). */
export function OperatorEditModal(props: OperatorEditModalProps): JSX.Element {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  // `undefined` until the current-value read resolves; then the pre-fill string or
  // `""` for an honest absence (FR10).
  const [prefill, setPrefill] = createSignal<string | undefined>(undefined)
  const [loaded, setLoaded] = createSignal(false)

  onMount(() => void loadPrefill())

  async function loadPrefill() {
    const descriptor = resolveOperatorEditPrefill(props.entry.id)
    const readEntry = descriptor
      ? listOperatorPaletteEntries().find((entry) => entry.id === descriptor.readId)
      : undefined
    if (!descriptor || !readEntry) {
      setLoaded(true)
      return
    }
    const result = await executeOperatorCommand({
      entry: readEntry,
      port: props.port,
      projectId: props.projectId,
      sessionId: props.sessionId,
      dialog: props.dialog,
      toast: props.toast,
      // Silent pre-fill read (FR9/FR18): no toast on open.
      silent: true,
    })
    setPrefill(descriptor.extract(result.result?.effective))
    setLoaded(true)
  }

  async function dispatchPayload(payload: Record<string, unknown>) {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await executeOperatorCommand({
        entry: props.entry,
        port: props.port,
        projectId: props.projectId,
        sessionId: props.sessionId,
        dialog: props.dialog,
        toast: props.toast,
        payload: { ...props.basePayload, ...payload },
        // Suppress toasts: a failure surfaces IN-MODAL, a success closes the modal (FR12/FR18).
        silent: true,
      })
      if (result.outcome && SUCCESS_OUTCOMES.has(result.outcome)) {
        props.onSaved?.()
        props.dialog.pop()
        return
      }
      if (result.cancelled) return
      setError(failureReason(result))
    } finally {
      setBusy(false)
    }
  }

  const title = () => props.title ?? props.entry.title

  if (props.field.mode === "value_picker") return <PickerBody />
  if (props.field.mode === "model_picker") return <ModelPickerBody />
  return <TextBody />

  /** Model-id body (Feature 020 FR3): pick a `provider/model` from the shared connected-models
   * picker; the `Custom id…` escape hatch reaches the raw id (FR4). The composed payload
   * (`{ id: "provider/model" }`) is unchanged; a failure stays in-modal, a success closes it. */
  function ModelPickerBody(): JSX.Element {
    const field = props.field
    return (
      <box flexDirection="column" flexGrow={1}>
        <ModelPicker
          current={prefill()}
          onSelect={(modelId) => {
            if (field.mode === "model_picker") void dispatchPayload(field.toPayload(modelId))
          }}
          onCustom={() =>
            void promptCustomModelId(props.dialog).then((raw) => {
              if (raw !== null && field.mode === "model_picker") void dispatchPayload(field.toPayload(raw))
            })
          }
        />
        <InModalError error={error} />
      </box>
    )
  }

  /** Text edit body: pre-filled prompt with an in-modal validation/failure surface. */
  function TextBody(): JSX.Element {
    const field = props.field
    function submitText(raw: string) {
      if (field.mode !== "text_input") return
      const validation = field.validate(raw)
      if (!validation.ok) {
        setError(validation.message)
        return
      }
      void dispatchPayload(field.toPayload(validation.value))
    }
    return (
      <Show when={loaded()} fallback={<LoadingBody title={title()} />}>
        <DialogPrompt
          title={title()}
          placeholder={field.mode === "text_input" ? field.placeholder : undefined}
          value={prefill()}
          busy={busy()}
          description={() => <InModalError error={error} />}
          onConfirm={submitText}
          onCancel={() => props.dialog.pop()}
        />
      </Show>
    )
  }

  /** Value-picker edit body: current option pre-selected; selection dispatches, error stays in-modal. */
  function PickerBody(): JSX.Element {
    const field = props.field
    const options = createMemo(() => (field.mode === "value_picker" ? field.options() : []))
    return (
      <box flexDirection="column" flexGrow={1}>
        <DialogSelect
          title={title()}
          current={prefill()}
          options={options().map((option) => ({
            title: option.title,
            description: option.description,
            category: props.entry.verbLabel,
            value: option.value,
            onSelect: () => {
              if (field.mode === "value_picker") void dispatchPayload({ [field.key]: option.value })
            },
          }))}
          emptyView={<text>{field.mode === "value_picker" ? field.emptyText : ""}</text>}
          footerHints={[
            { title: "esc", label: "cancel", side: "right" },
            { title: "enter", label: "save", side: "right" },
          ]}
        />
        <InModalError error={error} />
      </box>
    )
  }
}

/** In-modal loading placeholder shown while the current value read resolves (FR9). */
function LoadingBody(props: { title: string }): JSX.Element {
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={theme.textMuted}>Loading current value…</text>
    </box>
  )
}

/** The bounded, secret-free in-modal error surface (FR12, FR18). Renders nothing when clear. */
function InModalError(props: { error: () => string | undefined }): JSX.Element {
  const { theme } = useTheme()
  return (
    <Show when={props.error()}>
      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.error} wrapMode="word">
          {props.error()}
        </text>
      </box>
    </Show>
  )
}

/** Factory for `dialog.push` that mounts the edit modal (T010–T012). */
export function openOperatorEditModal(props: OperatorEditModalProps): () => JSX.Element {
  return () => <OperatorEditModal {...props} />
}
