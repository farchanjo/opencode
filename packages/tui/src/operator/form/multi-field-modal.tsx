/**
 * Multi-field operator edit modal (Feature 017 T002/T004/T005, FR19-FR22).
 *
 * Renders an ordered `EditFieldList` (field-list.ts) as a real form — one labeled
 * input per payload property, enum properties as pickers, a bindings-list editor
 * for `pools.set`, and a structured + advanced-JSON split for `routing.configure`
 * — replacing the single-field raw-JSON prompt. It keeps the Feature 015 modal
 * contract unchanged: a title, an in-modal error surface, a busy state, Save via
 * the submit shortcut, and `esc` to cancel. On Save it composes the BYTE-EXACT port
 * payload and dispatches ONCE through the same `executeOperatorCommand` loopback; a
 * per-field validation failure or a non-composable payload stays IN-MODAL, never a
 * global toast (FR20). A secret field is never pre-filled from a resolved value.
 */
import { InputRenderable, TextAttributes, TextareaRenderable } from "@opentui/core"
import { batch, createEffect, For, onMount, Show, type JSX } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import type { OperatorRequestScope, OperatorSlashPort } from "../../context/operator-slash"
import type { DialogContext } from "../../ui/dialog"
import { useTheme } from "../../context/theme"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect } from "../../ui/dialog-select"
import { pickModel } from "./model-picker"
import { useBindings } from "../../keymap"
import { executeOperatorCommand, type OperatorToast } from "../execute"
import {
  composePayload,
  prefillBindings,
  validateBindings,
  DEFAULT_REQUEST_SCOPE,
  isScopeFlexibleCommand,
  requestScopePickerOptions,
  type BindingRow,
  type EditField,
  type EditFieldListDescriptor,
} from "./field-list"
import { failureReason } from "./edit-modal"

/** Outcomes that committed the mutation — the only ones that close the modal (FR20). */
const SUCCESS_OUTCOMES = new Set(["success", "idempotent_replay"])

/**
 * The synthetic request-scope picker row (Feature 034). Its `key` is NOT a payload
 * property — `composePayload`/`descriptor.compose` only read `descriptor.fields`, so
 * this augmented row is ignored there. Its value rides `executeOperatorCommand`'s
 * `requestedScope` into the port's scope resolver instead.
 */
const REQUEST_SCOPE_KEY = "__requestScope__"

/**
 * The augmented request-scope picker row for a scope-FLEXIBLE Configure verb, or
 * `undefined` when the command targets a single scope (no picker, Feature 034). Rendered
 * as the LAST field row (above Save) reusing the same `kind:"picker"` idiom as the
 * payload fields; it never enters `composePayload`.
 */
function requestScopeField(entry: OperatorPaletteEntry): EditField | undefined {
  if (!isScopeFlexibleCommand(entry.scopesAllowed)) return undefined
  return {
    key: REQUEST_SCOPE_KEY,
    label: "Request scope",
    kind: "picker",
    required: false,
    options: requestScopePickerOptions(entry.scopesAllowed),
  }
}

/** The reactive form state (raw entries, bindings, cursor, error, busy, loaded). */
type MultiFieldStore = {
  raw: Record<string, string>
  bindings: BindingRow[]
  active: number
  error: string | undefined
  busy: boolean
  loaded: boolean
}

/** A hoisted store/setter pair, created ONCE per modal open so it survives sub-dialog push/pop. */
export type MultiFieldState = readonly [MultiFieldStore, SetStoreFunction<MultiFieldStore>]

/**
 * Create the modal's reactive state. It is created in `openMultiFieldModal` — OUTSIDE
 * the `MultiFieldForm` component — so entered values (text fields AND the bindings
 * rows) persist while the form is unmounted under a pushed picker/bindings sub-dialog.
 * The dialog stack renders only its top level, so a pushed sub-dialog UNMOUNTS the form
 * and re-mounts it on pop; a component-local `createStore` would be discarded, losing
 * every entry (the pools bindings dead-end this fix closes).
 */
export function createMultiFieldState(descriptor: EditFieldListDescriptor): MultiFieldState {
  return createStore<MultiFieldStore>({
    // The request-scope row defaults to `project` (back-compat) — a harmless unused key
    // for a single-scope command whose picker row is never rendered (Feature 034).
    raw: { ...Object.fromEntries(descriptor.fields.map((f) => [f.key, ""])), [REQUEST_SCOPE_KEY]: DEFAULT_REQUEST_SCOPE },
    bindings: [],
    active: 0,
    error: undefined,
    busy: false,
    loaded: false,
  })
}

export type MultiFieldModalProps = {
  readonly entry: OperatorPaletteEntry
  readonly descriptor: EditFieldListDescriptor
  readonly port: OperatorSlashPort | undefined
  readonly projectId?: string | null
  readonly sessionId?: string | null
  readonly dialog: DialogContext
  readonly toast: OperatorToast
  readonly title?: string
  /** Fixed payload merged UNDER the composed payload (the entity id an update targets, FR22). */
  readonly basePayload?: Record<string, unknown>
  readonly onSaved?: () => void
  /** Hoisted state, created once by the factory; a direct mount creates its own on first render. */
  readonly state?: MultiFieldState
}

/** Factory for `dialog.push` that mounts the multi-field edit form (T002). */
export function openMultiFieldModal(props: MultiFieldModalProps): () => JSX.Element {
  // Created once here, NOT inside MultiFieldForm: it must outlive the form's re-mount
  // when a picker/bindings sub-dialog is pushed on top and later popped.
  const state = createMultiFieldState(props.descriptor)
  return () => <MultiFieldForm {...props} state={state} />
}

/**
 * A push-based text prompt (FR22): unlike `DialogPrompt.show` — which `dialog.replace`s
 * the WHOLE stack to a single level, destroying the bindings sub-editors beneath it —
 * this PUSHES the prompt as one back-stack level and POPS back on confirm/cancel, so the
 * `BindingsEditor`/`BindingRowEditor` under it stay live and receive the entered value.
 */
function promptText(dialog: DialogContext, title: string, placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.push(
      () => (
        <DialogPrompt
          title={title}
          placeholder={placeholder}
          onConfirm={(value) => {
            finish(value)
            dialog.pop()
          }}
        />
      ),
      // esc / ctrl+c pops this level and runs onClose → resolves null, back to the editor.
      () => finish(null),
    )
  })
}

/** True for the single-line/multi-line free-text kinds rendered as an `<input>`/`<textarea>`. */
function isTextLike(field: EditField): boolean {
  return field.kind === "text" || field.kind === "numeric" || field.kind === "advanced_json"
}

/** The pre-filled, validated multi-field edit form (FR19). */
export function MultiFieldForm(props: MultiFieldModalProps): JSX.Element {
  const { theme } = useTheme()
  // A scope-flexible command appends the request-scope picker row (Feature 034); it rides
  // `requestedScope`, never the composed payload, so `props.descriptor.fields` alone drives compose.
  const scopeField = requestScopeField(props.entry)
  const fields = scopeField ? [...props.descriptor.fields, scopeField] : props.descriptor.fields
  const saveIndex = fields.length
  const inputs: (InputRenderable | TextareaRenderable | undefined)[] = []
  // Hoisted by the factory so it survives the form's re-mount under a pushed sub-dialog.
  const [store, setStore] = props.state ?? createMultiFieldState(props.descriptor)

  onMount(() => {
    props.dialog.setSize("large")
    // Read/pre-fill exactly once; on a re-mount (pop back from a sub-dialog) the entered
    // values already live in the hoisted store and must not be clobbered by a re-read.
    if (!store.loaded) void load()
  })

  // Focus follows the active row; picker/toggle/bindings/Save rows carry no input.
  createEffect(() => {
    const active = store.active
    inputs.forEach((input, index) => {
      if (!input || input.isDestroyed) return
      if (index === active) input.focus()
      else input.blur()
    })
  })

  async function load() {
    const initial: Record<string, string> = Object.fromEntries(fields.map((f) => [f.key, ""]))
    // The request-scope row is not part of the silent read; seed its back-compat default (Feature 034).
    if (scopeField) initial[REQUEST_SCOPE_KEY] = DEFAULT_REQUEST_SCOPE
    if (props.descriptor.readId) await prefillFromRead(initial)
    batch(() => {
      setStore("raw", initial)
      setStore("loaded", true)
    })
  }

  /** Issue the descriptor's silent read and seed each non-secret field from its effective (FR19). */
  async function prefillFromRead(initial: Record<string, string>) {
    const readEntry = listOperatorPaletteEntries().find((entry) => entry.id === props.descriptor.readId)
    if (!readEntry) return
    const result = await executeOperatorCommand({
      entry: readEntry,
      port: props.port,
      projectId: props.projectId,
      sessionId: props.sessionId,
      dialog: props.dialog,
      toast: props.toast,
      silent: true,
    })
    const effective = result.result?.effective
    for (const field of fields) {
      if (field.secret || field.kind === "bindings_list") continue
      const seed = field.prefill?.(effective)
      if (seed !== undefined) initial[field.key] = seed
    }
    setStore("bindings", prefillBindings(effective))
  }

  function move(delta: number) {
    setStore("active", (store.active + delta + saveIndex + 1) % (saveIndex + 1))
  }

  function activeField(): EditField | undefined {
    return store.active < fields.length ? fields[store.active] : undefined
  }

  function onActivate() {
    const field = activeField()
    if (!field) {
      void submit()
      return
    }
    if (field.kind === "picker") openPicker(field)
    else if (field.kind === "toggle") setStore("raw", field.key, store.raw[field.key] === "true" ? "false" : "true")
    else if (field.kind === "bindings_list") openBindings()
  }

  function openPicker(field: EditField) {
    // Capture live text inputs before the push unmounts the form, so they re-seed on pop.
    setStore("raw", snapshotRaw())
    props.dialog.push(() => (
      <DialogSelect
        title={field.label}
        current={store.raw[field.key]}
        options={(field.options ?? []).map((option) => ({
          title: option.title,
          description: option.description,
          category: field.label,
          value: option.value,
          onSelect: () => {
            setStore("raw", field.key, option.value)
            props.dialog.pop()
          },
        }))}
        footerHints={[
          { title: "esc", label: "back", side: "right" },
          { title: "enter", label: "select", side: "right" },
        ]}
      />
    ))
  }

  function openBindings() {
    // Capture live text inputs before the push unmounts the form, so they re-seed on pop.
    setStore("raw", snapshotRaw())
    props.dialog.push(() => (
      <BindingsEditor
        rows={() => store.bindings}
        onChange={(rows) => setStore("bindings", rows)}
        dialog={props.dialog}
      />
    ))
  }

  /** Snapshot the raw form values: text-like fields from their live input refs, the rest from the store. */
  function snapshotRaw(): Record<string, string> {
    const raw: Record<string, string> = { ...store.raw }
    fields.forEach((field, index) => {
      const input = inputs[index]
      if (isTextLike(field) && input && !input.isDestroyed) raw[field.key] = input.plainText
    })
    return raw
  }

  async function submit() {
    if (store.busy) return
    // A bindings-list verb (pools.set) validates its rows IN-MODAL first — an empty
    // model pool or a duplicate role stays a per-field error, never a doomed dispatch (FR22).
    if (fields.some((field) => field.kind === "bindings_list")) {
      const bindingsError = validateBindings(store.bindings)
      if (bindingsError) {
        setStore("error", bindingsError)
        return
      }
    }
    const composed = composePayload(props.descriptor, snapshotRaw(), { bindings: store.bindings })
    if (!composed.ok) {
      setStore("error", composed.message)
      return
    }
    await dispatch(composed.payload)
  }

  async function dispatch(payload: Record<string, unknown>) {
    batch(() => {
      setStore("busy", true)
      setStore("error", undefined)
    })
    try {
      const result = await executeOperatorCommand({
        entry: props.entry,
        port: props.port,
        projectId: props.projectId,
        sessionId: props.sessionId,
        dialog: props.dialog,
        toast: props.toast,
        payload: { ...props.basePayload, ...payload },
        // Feature 034: forward the operator's chosen authority scope for a scope-flexible
        // command; a single-scope command passes nothing → project-preferred (unchanged).
        ...(scopeField ? { requestedScope: store.raw[REQUEST_SCOPE_KEY] as OperatorRequestScope } : {}),
        silent: true,
      })
      if (result.outcome && SUCCESS_OUTCOMES.has(result.outcome)) {
        props.onSaved?.()
        props.dialog.pop()
        return
      }
      if (result.cancelled) return
      setStore("error", failureReason(result))
    } finally {
      setStore("busy", false)
    }
  }

  useBindings(() => ({
    bindings: [
      { key: "tab", desc: "Next field", group: "Dialog", cmd: () => move(1) },
      { key: "down", desc: "Next field", group: "Dialog", cmd: () => move(1) },
      { key: "shift+tab", desc: "Previous field", group: "Dialog", cmd: () => move(-1) },
      { key: "up", desc: "Previous field", group: "Dialog", cmd: () => move(-1) },
    ],
  }))
  useBindings(() => ({
    // enter/space act on non-text rows (picker/toggle/bindings/Save); a text input keeps them.
    enabled: !store.busy && (activeField() === undefined || !isTextLike(activeField()!)),
    bindings: [
      { key: "return", desc: "Activate field", group: "Dialog", cmd: onActivate },
      { key: "space", desc: "Activate field", group: "Dialog", cmd: onActivate },
    ],
  }))
  useBindings(() => ({
    bindings: [{ key: "ctrl+s", desc: "Save", group: "Dialog", cmd: () => void submit() }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title ?? props.entry.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.dialog.pop()}>
          esc
        </text>
      </box>
      <Show when={store.loaded} fallback={<text fg={theme.textMuted}>Loading current value…</text>}>
        <box flexDirection="column" gap={1}>
          <For each={fields}>{(field, index) => <FieldRow field={field} index={index()} />}</For>
          <box
            paddingLeft={1}
            backgroundColor={store.active === saveIndex ? theme.backgroundElement : undefined}
            onMouseUp={() => void submit()}
          >
            <text fg={store.active === saveIndex ? theme.primary : theme.text} attributes={TextAttributes.BOLD}>
              {store.busy ? "Saving…" : "Save"}
            </text>
          </box>
        </box>
      </Show>
      <Show when={store.error}>
        <text fg={theme.error} wrapMode="word">
          {store.error}
        </text>
      </Show>
      <text fg={theme.textMuted}>tab move · space/return select · ctrl+s save · esc cancel</text>
    </box>
  )

  /** One field row; the active row is highlighted and, when text-like, holds the focused input. */
  function FieldRow(rowProps: { field: EditField; index: number }): JSX.Element {
    const field = rowProps.field
    const on = () => store.active === rowProps.index
    // Seed the input once (non-reactive) so typing doesn't fight a reactive `value`.
    const seed = store.raw[field.key]
    return (
      <box flexDirection="column" paddingLeft={1} backgroundColor={on() ? theme.backgroundElement : undefined}>
        <text fg={on() ? theme.primary : theme.textMuted}>
          {field.label}
          {field.required ? " *" : ""}
        </text>
        <Show when={isTextLike(field)} fallback={<NonTextValue field={field} active={on} />}>
          <Show
            when={field.kind === "advanced_json"}
            fallback={
              <input
                ref={(renderable: InputRenderable) => (inputs[rowProps.index] = renderable)}
                value={seed}
                focusedBackgroundColor={theme.backgroundPanel}
                cursorColor={theme.primary}
                focusedTextColor={theme.text}
                placeholder={field.placeholder}
                placeholderColor={theme.textMuted}
              />
            }
          >
            <textarea
              height={3}
              ref={(renderable: TextareaRenderable) => (inputs[rowProps.index] = renderable)}
              initialValue={seed}
              placeholder={field.placeholder}
              placeholderColor={theme.textMuted}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.text}
            />
          </Show>
        </Show>
      </box>
    )
  }

  /** The read-only value line for a picker/toggle/bindings row (activated with return/space). */
  function NonTextValue(rowProps: { field: EditField; active: () => boolean }): JSX.Element {
    const field = rowProps.field
    const value = () => {
      if (field.kind === "toggle") return store.raw[field.key] === "true" ? "[x] on" : "[ ] off"
      if (field.kind === "bindings_list") return `${store.bindings.length} binding(s) — return to edit`
      const selected = (field.options ?? []).find((option) => option.value === store.raw[field.key])
      return selected ? selected.title : "— select —"
    }
    return <text fg={rowProps.active() ? theme.primary : theme.text}>{value()}</text>
  }
}

/**
 * The `pools.set` bindings-list editor (FR22): an ordered list of `{role, models}`
 * rows with add/remove-row and add/remove-model actions, mutating the parent
 * modal's bindings via `onChange`. `esc` returns to the form; Save on the form
 * composes exactly `{bindings:[{role,models}]}` from these rows.
 */
export function BindingsEditor(props: {
  rows: () => readonly BindingRow[]
  onChange: (rows: BindingRow[]) => void
  dialog: DialogContext
}): JSX.Element {
  async function addBinding() {
    const role = await promptText(props.dialog, "Role", "e.g. worker")
    if (role && role.trim().length > 0) props.onChange([...props.rows(), { role: role.trim(), models: [] }])
  }

  function removeBinding(index: number) {
    props.onChange(props.rows().filter((_, position) => position !== index))
  }

  function openRow(index: number) {
    props.dialog.push(() => (
      <BindingRowEditor
        row={() => props.rows()[index]}
        onModels={(models) => props.onChange(props.rows().map((row, position) => (position === index ? { ...row, models } : row)))}
        onRemove={() => {
          removeBinding(index)
          props.dialog.pop()
        }}
        dialog={props.dialog}
      />
    ))
  }

  const options = () => [
    ...props.rows().map((row, index) => ({
      title: row.role,
      description: row.models.length > 0 ? row.models.join(", ") : "no models — return to edit",
      category: "Bindings",
      value: `row:${index}`,
      onSelect: () => openRow(index),
    })),
    { title: "+ Add binding", description: "Add a new role pool", category: "Actions", value: "add", onSelect: () => void addBinding() },
    { title: "Done", description: "Return to the form", category: "Actions", value: "done", onSelect: () => props.dialog.pop() },
  ]

  return (
    <DialogSelect
      title="Role bindings"
      options={options()}
      footerHints={[
        { title: "esc", label: "back", side: "right" },
        { title: "enter", label: "open", side: "right" },
      ]}
    />
  )
}

/** One binding's model-list editor: add/remove candidate model ids (FR22). */
function BindingRowEditor(props: {
  row: () => BindingRow | undefined
  onModels: (models: string[]) => void
  onRemove: () => void
  dialog: DialogContext
}): JSX.Element {
  async function addModel() {
    // Feature 020 (FR2): pick a `provider/model` id from the shared connected-models
    // picker instead of the free-text prompt; the picker's `Custom id…` escape hatch
    // still reaches the raw entry (FR4). Already-added ids are skipped so the same id
    // is not silently duplicated, and a cancel resolves `undefined` → no mutation (FR6).
    const row = props.row()
    if (!row) return
    const model = await pickModel(props.dialog, { alreadySelected: new Set(row.models) })
    const current = props.row()
    if (model && model.trim().length > 0 && current) props.onModels([...current.models, model.trim()])
  }

  function removeModel(index: number) {
    const row = props.row()
    if (row) props.onModels(row.models.filter((_, position) => position !== index))
  }

  const options = () => [
    ...(props.row()?.models ?? []).map((model, index) => ({
      title: model,
      description: "return to remove",
      category: "Models",
      value: `model:${index}`,
      onSelect: () => removeModel(index),
    })),
    { title: "+ Add model", description: "Add a candidate model id", category: "Actions", value: "add", onSelect: () => void addModel() },
    { title: "Remove binding", description: "Delete this role pool", category: "Actions", value: "remove", onSelect: props.onRemove },
    { title: "Done", description: "Back to bindings", category: "Actions", value: "done", onSelect: () => props.dialog.pop() },
  ]

  return (
    <DialogSelect
      title={`Models · ${props.row()?.role ?? ""}`}
      options={options()}
      footerHints={[
        { title: "esc", label: "back", side: "right" },
        { title: "enter", label: "select", side: "right" },
      ]}
    />
  )
}
