/** @jsxImportSource @opentui/solid */
/**
 * Feature 019 fix-round — the pools.set bindings editor drives END-TO-END with the
 * keyboard through the real component chain (FR22). Regression guard for the reported
 * dead-end: on the Pools screen → Set, the "Role" prompt submitted but NOTHING happened
 * — because `DialogPrompt.show` `dialog.replace`d the entire stack (destroying the
 * `BindingsEditor` + `MultiFieldForm` beneath), and even a push-based prompt lost the
 * entered rows because the form's component-local store was discarded on its re-mount
 * under the pushed sub-dialog. The fix: a push-based `promptText` that pops back one
 * level, plus a factory-hoisted store that outlives the form's re-mount.
 *
 * Mounts a real `DialogProvider` and drives openMultiFieldModal(pools.set) with a spy
 * port: add binding → Role "worker" → open row → add model → done → Save composes the
 * BYTE-EXACT `{bindings:[{role,models}]}` and dispatches ONCE, then the modal closes.
 */
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, type JSX } from "solid-js"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import type { OperatorStructuredResult } from "../../src/context/operator-slash"
import type { DialogContext } from "../../src/ui/dialog"
import { openMultiFieldModal } from "../../src/operator/form/multi-field-modal"
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

async function mountDialog(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
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
      </TestTuiContexts>
    )
  }
  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await wait(() => captured !== undefined)
  return { app, dialog: captured! }
}

/** Poll the rendered char frame for a substring (the modal/editor is on screen). */
async function frameHas(app: { captureCharFrame: () => string }, needle: string, timeout = 4000) {
  await wait(() => app.captureCharFrame().includes(needle), timeout)
}

describe("019 fix-round — pools.set bindings editor drives end-to-end (FR22)", () => {
  test("add binding → Role → add model → Save composes byte-exact and closes the modal", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = poolsSpy({ bindings: [] }) // create-from-empty: the user's exact starting screen
    const { toast } = createFakeToast()
    let saved = 0
    try {
      dialog.push(() => <text>pools screen</text>)
      dialog.push(
        openMultiFieldModal({
          entry: entry("pools.set"),
          descriptor: resolveOperatorFieldList("pools.set")!,
          port: spy.port,
          dialog,
          toast,
          onSaved: () => {
            saved++
          },
        }),
      )
      await app.flush()
      // The form loaded its read and shows the bindings row + Save (not "Loading…").
      await frameHas(app, "Role bindings")
      await frameHas(app, "Save")
      expect(dialog.stack.length).toBe(2)

      // Activate the bindings row → push the BindingsEditor.
      app.mockInput.pressEnter()
      await frameHas(app, "+ Add binding")
      expect(dialog.stack.length).toBe(3)

      // "+ Add binding" (first option) → the push-based Role prompt.
      app.mockInput.pressEnter()
      await frameHas(app, "Role")
      expect(dialog.stack.length).toBe(4)

      // Type the role and submit — the REGRESSION point. Old code replaced the stack to
      // a single orphaned prompt; the fix pops one level back to the editor with the row.
      await app.mockInput.typeText("worker")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === 3)
      await frameHas(app, "worker")

      // Open the new row → the model-list editor, add a model id.
      app.mockInput.pressEnter()
      await frameHas(app, "+ Add model")
      const modelsLevel = dialog.stack.length
      app.mockInput.pressEnter()
      await frameHas(app, "Model id")
      await app.mockInput.typeText("anthropic/claude")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === modelsLevel)
      await frameHas(app, "anthropic/claude")

      // esc walks back: model editor → bindings → form, entered state preserved.
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 3)
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)
      await frameHas(app, "Role bindings")

      // Save (ctrl+s): validate passes, compose byte-exact, dispatch once, modal closes.
      app.mockInput.pressKey("s", { ctrl: true })
      await wait(() => dialog.stack.length === 1)
      expect(saved).toBe(1)

      const setCall = spy.tryHandleCalls.find((c) => c.text.startsWith("/op.pools.set "))
      expect(setCall).toBeDefined()
      const json = setCall!.text.slice(setCall!.text.indexOf(" ") + 1)
      expect(JSON.parse(json)).toEqual({ bindings: [{ role: "worker", models: ["anthropic/claude"] }] })
      // Exactly one pools.set dispatch reached the wire.
      expect(spy.tryHandleCalls.filter((c) => c.text.startsWith("/op.pools.set ")).length).toBe(1)
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
        openMultiFieldModal({
          entry: entry("pools.set"),
          descriptor: resolveOperatorFieldList("pools.set")!,
          port: spy.port,
          dialog,
          toast,
        }),
      )
      await app.flush()
      await frameHas(app, "Role bindings")

      // Add a binding with NO models, then return and Save.
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
      // The modal stayed open and NOTHING dispatched to pools.set.
      expect(dialog.stack.length).toBe(2)
      expect(spy.tryHandleCalls.some((c) => c.text.startsWith("/op.pools.set "))).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })
})
