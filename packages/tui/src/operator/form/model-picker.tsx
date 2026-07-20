/**
 * Shared connected-models picker (Feature 020 T001/T002/T005, FR1/FR4/FR6).
 *
 * Replaces the free-text `Model id` entry in the two Operator config-form seams
 * (`pools.set` `+ Add model` and `semantic.model.disable`) with ONE selectable,
 * provider-grouped, searchable list of the CONNECTED models. It is a thin
 * composition over the shipped machinery — the `DialogSelect` primitive
 * (`ui/dialog-select.tsx`), the reactive `sync.data.provider` connected catalog
 * (`context/sync.tsx:452-453`), the `fuzzysort` grouping/filter, and the raw
 * `DialogPrompt` escape hatch — patterned on the `/models` switcher `DialogModel`
 * (`component/dialog-model.tsx`). None of those are modified; this file only
 * imports them (guard-scope note, plan.md).
 *
 * It is a TUI presentation change only: the picker resolves the selected model's
 * `provider/model` id string (the `Provider.parseModel` format), and every payload
 * contract stays byte-for-byte unchanged. A mandatory `Custom id…` action reopens
 * the raw free-text prompt so a catalog-absent id is still enterable (FR4), and an
 * empty catalog still renders that action rather than a dead-end (FR6).
 */
import { createMemo, createSignal, type JSX } from "solid-js"
import { entries, filter, flatMap, map, pipe, sortBy } from "remeda"
import * as fuzzysort from "fuzzysort"
import type { Provider } from "@opencode-ai/sdk/v2"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import type { DialogContext } from "../../ui/dialog"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useSync } from "../../context/sync"

/** The `Custom id…` sentinel value — never a real `provider/model` id. */
const CUSTOM_ID_VALUE = "__operator_model_picker_custom__"

/**
 * The view-model derived from one connected `Provider.Model` (FR1). `modelId` is the
 * `provider/model` id string the payloads carry; `alreadySelected` marks an id the
 * caller already chose so the option is skipped, never silently duplicated (FR2/FR6).
 */
export interface ConnectedModelOption {
  readonly modelId: string
  readonly title: string
  readonly provider: string
  readonly category: string
  readonly free: boolean
  readonly alreadySelected: boolean
}

/**
 * Flat-map the live connected catalog into `ConnectedModelOption` view-models,
 * grouped/sorted by provider (FR1). Pure over its inputs, so it re-derives whenever
 * `sync.data.provider` changes and reflects ONLY connected providers — it fabricates
 * no model or provider absent from the catalog. Deprecated models are dropped,
 * mirroring the `DialogModel` precedent.
 */
export function buildConnectedModelOptions(
  providers: readonly Provider[],
  alreadySelected: ReadonlySet<string> = new Set(),
): ConnectedModelOption[] {
  return pipe(
    providers,
    sortBy((provider) => provider.name),
    flatMap((provider) =>
      pipe(
        provider.models,
        entries(),
        filter(([, model]) => model.status !== "deprecated"),
        map(([key, model]) => {
          const modelId = `${provider.id}/${key}`
          return {
            modelId,
            title: model.name ?? key,
            provider: provider.name,
            category: provider.name,
            free: model.cost?.input === 0,
            alreadySelected: alreadySelected.has(modelId),
          }
        }),
        sortBy((option) => option.title),
      ),
    ),
  )
}

export type ModelPickerProps = {
  /** Highlight this `provider/model` id as the current selection, when present. */
  readonly current?: string
  /** Ids already chosen by the caller — skipped in the list so they are not re-added (FR2). */
  readonly alreadySelected?: ReadonlySet<string>
  /** Resolve the picked `provider/model` id string to the caller. */
  readonly onSelect: (modelId: string) => void
  /** Open the raw free-text escape hatch (FR4). */
  readonly onCustom: () => void
}

/**
 * The shared picker view over the reactive connected catalog (FR1). A pure
 * `DialogSelect`: grouped by provider, fuzzy-searchable over title/provider, plus a
 * mandatory `Custom id…` action (always present, even with an empty catalog — FR6)
 * that invokes `onCustom`. Selecting a model calls `onSelect` with its id.
 */
export function ModelPicker(props: ModelPickerProps): JSX.Element {
  const sync = useSync()
  const [query, setQuery] = createSignal("")

  const models = createMemo(() => buildConnectedModelOptions(sync.data.provider, props.alreadySelected))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const needle = query().trim()
    const source = models()
    const matched = needle ? fuzzysort.go(needle, source, { keys: ["title", "category"] }).map((x) => x.obj) : source
    const modelOptions: DialogSelectOption<string>[] = matched.map((option) => ({
      title: option.title,
      description: option.provider,
      category: option.category,
      value: option.modelId,
      footer: option.free ? "Free" : undefined,
      // A disabled option is dropped by DialogSelect, so an already-chosen id can
      // never be re-selected (FR2) — the picker never silently duplicates it.
      disabled: option.alreadySelected,
      onSelect: () => props.onSelect(option.modelId),
    }))
    return [
      ...modelOptions,
      {
        title: "Custom id…",
        description: "Enter a model id by hand",
        category: "Actions",
        value: CUSTOM_ID_VALUE,
        onSelect: () => props.onCustom(),
      },
    ]
  })

  return (
    <DialogSelect<string>
      title="Select model"
      options={options()}
      current={props.current}
      onFilter={setQuery}
      skipFilter={true}
      footerHints={[
        { title: "esc", label: "back", side: "right" },
        { title: "enter", label: "select", side: "right" },
      ]}
    />
  )
}

/**
 * The raw free-text escape hatch (FR4): PUSH the EXISTING `DialogPrompt` as one
 * back-stack level and POP back on confirm/cancel — the same push/pop discipline as
 * `promptText` (multi-field-modal.tsx:100-118), NEVER `dialog.replace`. Resolves the
 * trimmed non-empty string exactly as the current free-text path accepts, or `null`
 * on an empty/cancelled entry so the caller no-ops (no phantom mutation, FR6).
 */
export function promptCustomModelId(dialog: DialogContext): Promise<string | null> {
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
          title="Custom model id"
          placeholder="e.g. anthropic/claude-…"
          onConfirm={(value) => {
            const trimmed = value.trim()
            finish(trimmed.length > 0 ? trimmed : null)
            dialog.pop()
          }}
        />
      ),
      // esc / ctrl+c pops this level and runs onClose → resolves null, back to the picker.
      () => finish(null),
    )
  })
}

/**
 * Imperative open used by the `pools.set` seam (FR2): PUSH the picker as one
 * back-stack level and POP back to the caller on select/cancel — the same push/pop
 * discipline as `promptText`, NEVER `dialog.replace` (that nukes the stack — the 019
 * pools-editor dead-end). Resolves the chosen or hand-entered `provider/model` id, or
 * `undefined` on esc/cancel so the caller no-ops (no mutation, FR6).
 */
export function pickModel(
  dialog: DialogContext,
  opts: { current?: string; alreadySelected?: ReadonlySet<string> } = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | undefined) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.push(
      () => (
        <ModelPicker
          current={opts.current}
          alreadySelected={opts.alreadySelected}
          onSelect={(modelId) => {
            finish(modelId)
            dialog.pop()
          }}
          onCustom={() => {
            // The escape hatch is pushed ON TOP of the picker; a confirmed non-empty
            // id resolves the caller and pops back past both levels (FR4).
            void promptCustomModelId(dialog).then((raw) => {
              if (raw === null) return
              finish(raw)
              dialog.pop()
            })
          }}
        />
      ),
      // esc / ctrl+c pops this level and runs onClose → resolves undefined, no mutation.
      () => finish(undefined),
    )
  })
}
