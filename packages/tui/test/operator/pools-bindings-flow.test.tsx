/** @jsxImportSource @opentui/solid */
/**
 * Feature 019 fix-round + Feature 020 — the pools.set bindings editor drives
 * END-TO-END with the keyboard through the real component chain (FR22, and the
 * Feature 020 shared connected-models picker FR1-FR6).
 *
 * 019 regression guard: on the Pools screen → Set, the "Role" prompt submitted but
 * NOTHING happened — because `DialogPrompt.show` `dialog.replace`d the entire stack
 * (destroying the `BindingsEditor` + `MultiFieldForm` beneath), and even a push-based
 * prompt lost the entered rows because the form's component-local store was discarded
 * on its re-mount under the pushed sub-dialog. The fix: a push-based `promptText` that
 * pops back one level, plus a factory-hoisted store that outlives the form's re-mount.
 *
 * 020: `+ Add model` no longer opens the free-text prompt — it opens the shared
 * `ModelPicker` over an injected FAKE connected catalog (`sync.data.provider`). The
 * tests drive the REAL picker: pick-from-list appends `provider/model`, the
 * `Custom id…` escape hatch still enters a raw id, an already-added id is skipped, an
 * empty catalog still offers the escape hatch, cancel leaves state unmutated, and a
 * reactive catalog update re-derives the options — all with the byte-exact payload.
 */
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createStore } from "solid-js/store"
import { onCleanup, type JSX } from "solid-js"
import type { Provider } from "@opencode-ai/sdk/v2"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import type { OperatorStructuredResult } from "../../src/context/operator-slash"
import type { DialogContext } from "../../src/ui/dialog"
import { SyncContext, type useSync } from "../../src/context/sync"
import { openMultiFieldModal } from "../../src/operator/form/multi-field-modal"
import { openOperatorEditModal } from "../../src/operator/form/edit-modal"
import { resolveOperatorFormField } from "../../src/operator/form"
import { resolveOperatorFieldList } from "../../src/operator/form/field-list"
import { createSpyPort, createFakeToast, spyDisplay, type TryHandleInput } from "./harness"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

type SyncValue = ReturnType<typeof useSync>

/** A minimal connected `Provider.Model` — only the fields the picker builder reads. */
function fakeModel(name: string, freeInput = false): Provider["models"][string] {
  return {
    name,
    status: "active",
    cost: { input: freeInput ? 0 : 3, output: 6, cache: { read: 0, write: 0 } },
  } as unknown as Provider["models"][string]
}

function fakeProvider(id: string, name: string, models: Record<string, Provider["models"][string]>): Provider {
  return { id, name, source: "api", env: [], options: {}, models } as unknown as Provider
}

/** The default fake connected catalog: two providers, grouped + sorted by name. */
function defaultCatalog(): Provider[] {
  return [
    fakeProvider("anthropic", "Anthropic", {
      "claude-opus": fakeModel("Claude Opus"),
      "claude-sonnet": fakeModel("Claude Sonnet"),
    }),
    fakeProvider("openai", "OpenAI", { "gpt-5": fakeModel("GPT-5") }),
  ]
}

/** A reactive fake sync context: `setProviders` re-derives the picker memo live (FR6). */
function createFakeSync(initial: Provider[]) {
  const [store, setStore] = createStore<{ provider: Provider[] }>({ provider: initial })
  return {
    value: { data: store } as unknown as SyncValue,
    setProviders: (providers: Provider[]) => setStore("provider", providers),
  }
}

async function wait(fn: () => boolean, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

/** A spy port: pools.show reads the given effective; pools.set records + succeeds. */
function poolsSpy(effective: unknown) {
  const structured = (input: TryHandleInput): OperatorStructuredResult | undefined => {
    if (input.text.includes("pools.show")) return { outcome: "success", effective, version: "1" }
    return { outcome: "success", version: "2" }
  }
  return createSpyPort(() => spyDisplay(), structured)
}

async function mountDialog(root: string, catalog: Provider[] = defaultCatalog()) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const sync = createFakeSync(catalog)
  const [{ DialogProvider, useDialog }, { KVProvider }, { ThemeProvider }, { TuiConfigProvider }, { ToastProvider }, { OpencodeKeymapProvider, registerOpencodeKeymap }] =
    await Promise.all([
      import("../../src/ui/dialog"),
      import("../../src/context/kv"),
      import("../../src/context/theme"),
      import("../../src/config"),
      import("../../src/ui/toast"),
      import("../../src/keymap"),
    ])
  let captured: DialogContext | undefined
  function Capture(): JSX.Element {
    captured = useDialog()
    return <></>
  }
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)
    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <SyncContext.Provider value={sync.value}>
          <OpencodeKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={resolvedConfig}>
              <KVProvider>
                <ThemeProvider mode="dark">
                  <ToastProvider>
                    <DialogProvider>
                      <Capture />
                    </DialogProvider>
                  </ToastProvider>
                </ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </OpencodeKeymapProvider>
        </SyncContext.Provider>
      </TestTuiContexts>
    )
  }
  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await wait(() => captured !== undefined)
  return { app, dialog: captured!, setProviders: sync.setProviders }
}

/** Poll the rendered char frame for a substring (the modal/editor is on screen). */
async function frameHas(app: { captureCharFrame: () => string }, needle: string, timeout = 4000) {
  await wait(() => app.captureCharFrame().includes(needle), timeout)
}

/** Open pools.set, add a "worker" binding, and open its model-list editor — the shared setup. */
async function toModelEditor(
  app: Awaited<ReturnType<typeof mountDialog>>["app"],
  dialog: DialogContext,
  spy: ReturnType<typeof poolsSpy>,
  onSaved?: () => void,
) {
  const { toast } = createFakeToast()
  dialog.push(() => <text>pools screen</text>)
  dialog.push(
    openMultiFieldModal({ entry: entry("pools.set"), descriptor: resolveOperatorFieldList("pools.set")!, port: spy.port, dialog, toast, onSaved }),
  )
  await app.flush()
  await frameHas(app, "Role bindings")
  // bindings row → BindingsEditor → "+ Add binding" → Role prompt → "worker".
  app.mockInput.pressEnter()
  await frameHas(app, "+ Add binding")
  app.mockInput.pressEnter()
  await frameHas(app, "Role")
  await app.mockInput.typeText("worker")
  app.mockInput.pressEnter()
  await wait(() => dialog.stack.length === 3)
  await frameHas(app, "worker")
  // open the worker row → the model-list editor.
  app.mockInput.pressEnter()
  await frameHas(app, "+ Add model")
}

describe("020 — pools.set + Add model opens the shared connected-models picker (FR1-FR6)", () => {
  test("pick from the provider-grouped list appends provider/model and Saves byte-exact", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = poolsSpy({ bindings: [] })
    let saved = 0
    try {
      await toModelEditor(app, dialog, spy, () => saved++)
      const modelsLevel = dialog.stack.length

      // "+ Add model" opens the picker over the fake connected catalog, grouped by provider.
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      await frameHas(app, "Anthropic")
      await frameHas(app, "Claude Sonnet")
      // filter to Sonnet and select it → appends its provider/model id (no free-text typing).
      await app.mockInput.typeText("sonnet")
      await frameHas(app, "Claude Sonnet")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === modelsLevel)
      await frameHas(app, "anthropic/claude-sonnet")

      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 3)
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)
      app.mockInput.pressKey("s", { ctrl: true })
      await wait(() => dialog.stack.length === 1)
      expect(saved).toBe(1)

      const setCall = spy.tryHandleCalls.find((c) => c.text.startsWith("/op.pools.set "))
      expect(setCall).toBeDefined()
      const json = setCall!.text.slice(setCall!.text.indexOf(" ") + 1)
      expect(JSON.parse(json)).toEqual({ bindings: [{ role: "worker", models: ["anthropic/claude-sonnet"] }] })
    } finally {
      app.renderer.destroy()
    }
  })

  test("Custom id… escape hatch still enters a raw catalog-absent id (FR4 non-regression)", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = poolsSpy({ bindings: [] })
    try {
      await toModelEditor(app, dialog, spy)
      const modelsLevel = dialog.stack.length
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      // A query no model matches leaves only the Custom id… action selectable.
      await app.mockInput.typeText("zzzznope")
      await frameHas(app, "Custom id…")
      app.mockInput.pressEnter()
      // The raw free-text prompt opens on the SAME level; enter a catalog-absent id.
      await frameHas(app, "Custom model id")
      await app.mockInput.typeText("custom/model-x")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === modelsLevel)
      await frameHas(app, "custom/model-x")

      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 3)
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)
      app.mockInput.pressKey("s", { ctrl: true })
      await wait(() => dialog.stack.length === 1)
      const setCall = spy.tryHandleCalls.find((c) => c.text.startsWith("/op.pools.set "))!
      expect(JSON.parse(setCall.text.slice(setCall.text.indexOf(" ") + 1))).toEqual({
        bindings: [{ role: "worker", models: ["custom/model-x"] }],
      })
    } finally {
      app.renderer.destroy()
    }
  })

  test("an already-added id is skipped in the picker (not silently duplicated, FR2)", async () => {
    await using tmp = await tmpdir()
    // Seed pools.show so the worker binding already holds anthropic/claude-sonnet.
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = poolsSpy({ bindings: [{ role: "worker", models: ["anthropic/claude-sonnet"] }] })
    const { toast } = createFakeToast()
    try {
      dialog.push(() => <text>pools screen</text>)
      dialog.push(
        openMultiFieldModal({ entry: entry("pools.set"), descriptor: resolveOperatorFieldList("pools.set")!, port: spy.port, dialog, toast }),
      )
      await app.flush()
      await frameHas(app, "Role bindings")
      app.mockInput.pressEnter()
      await frameHas(app, "+ Add binding")
      await frameHas(app, "worker")
      // open the pre-filled worker row (the first option) → its model editor.
      app.mockInput.pressEnter()
      await frameHas(app, "anthropic/claude-sonnet")
      await frameHas(app, "+ Add model")
      // filter to the "+ Add model" action (the row's first option is the existing
      // model — filtering avoids selecting/removing it) and open the picker.
      await app.mockInput.typeText("Add model")
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      // Claude Opus is still offered; the already-added Claude Sonnet is skipped.
      await frameHas(app, "Claude Opus")
      expect(app.captureCharFrame().includes("Claude Sonnet")).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("an empty catalog still offers Custom id… — never an empty dead-end (FR6)", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path, [])
    const spy = poolsSpy({ bindings: [] })
    try {
      await toModelEditor(app, dialog, spy)
      const modelsLevel = dialog.stack.length
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      await frameHas(app, "Custom id…")
      app.mockInput.pressEnter()
      await frameHas(app, "Custom model id")
      await app.mockInput.typeText("offline/model")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === modelsLevel)
      await frameHas(app, "offline/model")
    } finally {
      app.renderer.destroy()
    }
  })

  test("cancel/esc leaves row.models unmutated (no phantom mutation, FR6)", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = poolsSpy({ bindings: [] })
    try {
      await toModelEditor(app, dialog, spy)
      const modelsLevel = dialog.stack.length
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      // esc pops the picker without selecting — the model list stays empty.
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === modelsLevel)
      await frameHas(app, "+ Add model")
      // Save now fails in-modal: the worker pool has no candidate models (nothing was added).
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 3)
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)
      app.mockInput.pressKey("s", { ctrl: true })
      await frameHas(app, "no candidate models")
      expect(dialog.stack.length).toBe(2)
      expect(spy.tryHandleCalls.some((c) => c.text.startsWith("/op.pools.set "))).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("a provider connecting while the picker is open re-derives the options (reactive, FR6)", async () => {
    await using tmp = await tmpdir()
    // Start with only Anthropic connected; OpenAI connects while the picker is open.
    const onlyAnthropic = [defaultCatalog()[0]]
    const { app, dialog, setProviders } = await mountDialog(tmp.path, onlyAnthropic)
    const spy = poolsSpy({ bindings: [] })
    try {
      await toModelEditor(app, dialog, spy)
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      await frameHas(app, "Anthropic")
      expect(app.captureCharFrame().includes("GPT-5")).toBe(false)
      // A provider connects — the reactive memo re-derives without reopening the picker.
      setProviders(defaultCatalog())
      await frameHas(app, "GPT-5")
      await frameHas(app, "OpenAI")
    } finally {
      app.renderer.destroy()
    }
  })

  test("semantic.model.disable picks from the same list and composes { id } unchanged (FR3)", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    try {
      dialog.push(() => <text>models screen</text>)
      dialog.push(
        openOperatorEditModal({
          entry: entry("semantic.model.disable"),
          field: resolveOperatorFormField(entry("semantic.model.disable"))!,
          port: spy.port,
          dialog,
          toast,
        }),
      )
      await app.flush()
      // The Model id field renders the shared picker (not a bare text prompt).
      await frameHas(app, "Select model")
      await frameHas(app, "Anthropic")
      await app.mockInput.typeText("opus")
      await frameHas(app, "Claude Opus")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === 1)

      const call = spy.tryHandleCalls.find((c) => c.text.startsWith("/op.semantic.model.disable "))!
      expect(call).toBeDefined()
      expect(JSON.parse(call.text.slice(call.text.indexOf(" ") + 1))).toEqual({ id: "anthropic/claude-opus" })
    } finally {
      app.renderer.destroy()
    }
  })

  test("semantic.model.disable Custom id… escape hatch dispatches through the disposed-modal remount (FR4 non-regression)", async () => {
    // Regression guard for a subtle mechanism the escape hatch relies on: opening
    // `Custom id…` PUSHES `promptCustomModelId`'s `DialogPrompt` as a new top-of-stack
    // level (model-picker.tsx:162), and `DialogProvider` only ever renders
    // `stack.at(-1)` (dialog.tsx:242) — so that push UNMOUNTS the `OperatorEditModal`
    // instance underneath (Solid disposes it, it is not merely hidden). On confirm,
    // the prompt's `onConfirm` resolves the escape hatch's promise, whose `.then`
    // handler is the DISPOSED modal instance's own `dispatchPayload` closure
    // (edit-modal.tsx:143-147) — a plain JS closure that survives disposal even
    // though the signal writes inside it (`setBusy`/`setError`) are now no-ops. It
    // still calls the real `executeOperatorCommand` and, on success, the real
    // `props.dialog.pop()` (edit-modal.tsx:114-116), which is what actually unwinds
    // the stack back to the screen beneath. This was proven working manually but had
    // no committed test before this one.
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    try {
      dialog.push(() => <text>models screen</text>)
      dialog.push(
        openOperatorEditModal({
          entry: entry("semantic.model.disable"),
          field: resolveOperatorFormField(entry("semantic.model.disable"))!,
          port: spy.port,
          dialog,
          toast,
        }),
      )
      await app.flush()
      await frameHas(app, "Select model")
      // A query no connected model matches leaves only the Custom id… action selectable.
      await app.mockInput.typeText("zzzznope")
      await frameHas(app, "Custom id…")
      app.mockInput.pressEnter()
      // The raw free-text prompt opens on a NEW stack level, unmounting the edit modal.
      await frameHas(app, "Custom model id")
      await app.mockInput.typeText("my/custom-disabled-model")
      app.mockInput.pressEnter()
      // The disposed modal instance's dispatch still fires and pops the stack back
      // to the "models screen" level beneath it — not merely back to the modal.
      await wait(() => dialog.stack.length === 1)

      const call = spy.tryHandleCalls.find((c) => c.text.startsWith("/op.semantic.model.disable "))!
      expect(call).toBeDefined()
      expect(JSON.parse(call.text.slice(call.text.indexOf(" ") + 1))).toEqual({ id: "my/custom-disabled-model" })
      expect(dialog.stack.length).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("Save with a role pool that has no models blocks in-modal — no dispatch", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = poolsSpy({ bindings: [] })
    const { toast } = createFakeToast()
    try {
      dialog.push(() => <text>pools screen</text>)
      dialog.push(
        openMultiFieldModal({ entry: entry("pools.set"), descriptor: resolveOperatorFieldList("pools.set")!, port: spy.port, dialog, toast }),
      )
      await app.flush()
      await frameHas(app, "Role bindings")
      app.mockInput.pressEnter()
      await frameHas(app, "+ Add binding")
      app.mockInput.pressEnter()
      await frameHas(app, "Role")
      await app.mockInput.typeText("worker")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === 3)
      await frameHas(app, "worker")
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)

      app.mockInput.pressKey("s", { ctrl: true })
      await frameHas(app, "no candidate models")
      expect(dialog.stack.length).toBe(2)
      expect(spy.tryHandleCalls.some((c) => c.text.startsWith("/op.pools.set "))).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })
})
