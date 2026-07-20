/** @jsxImportSource @opentui/solid */
/**
 * Feature 029 — the operator routing.configure Save UX is never a silent no-op.
 *
 * Pins three guarantees against the "eu mando salvar e não salva" regression:
 *   (a) enabling routing with Mode left at the "— select —" placeholder builds a
 *       payload that OMITS mode (sends `{enabled}` only), never the empty string the
 *       backend rejects with `invalid_argument`, and leaves the stored mode as-is;
 *   (b) a backend `invalid_argument` result renders a VISIBLE, human-readable reason
 *       in-modal — the modal stays open, never a swallowed success/zero;
 *   (c) Mode is optional (required:false) while a real always/auto/never pick is
 *       still composed onto the payload.
 *
 * (b) is driven END-TO-END with the keyboard through the real component chain + the
 * real `executeOperatorCommand`, exactly as the operator UI runs.
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
import { composePayload, resolveOperatorFieldList } from "../../src/operator/form/field-list"
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

const ROUTING = () => resolveOperatorFieldList("routing.configure")!

describe("Feature 029 — Mode is optional; the placeholder is OMITTED, never sent as `mode: \"\"`", () => {
  test("enabling with Mode at the placeholder composes `{ enabled }` only — no mode key", () => {
    const composed = composePayload(ROUTING(), { enabled: "true", mode: "", advanced: "" }, {})
    expect(composed.ok).toBe(true)
    if (!composed.ok) return
    expect(composed.payload).toEqual({ enabled: true })
    expect("mode" in composed.payload).toBe(false) // never the empty-string the backend rejects
  })

  test("disabling with Mode at the placeholder composes `{ enabled: false }` only", () => {
    const composed = composePayload(ROUTING(), { enabled: "false", mode: "", advanced: "" }, {})
    expect(composed.ok).toBe(true)
    if (composed.ok) expect(composed.payload).toEqual({ enabled: false })
  })

  test("a real always/auto/never pick is still composed onto the payload", () => {
    const composed = composePayload(ROUTING(), { enabled: "true", mode: "auto", advanced: "" }, {})
    expect(composed.ok).toBe(true)
    if (composed.ok) expect(composed.payload).toEqual({ enabled: true, mode: "auto" })
  })

  test("Mode is OPTIONAL — a blank placeholder never blocks the Save with a required error", () => {
    const mode = ROUTING().fields.find((f) => f.key === "mode")!
    expect(mode.required).toBe(false)
    // No "Mode is required" in-modal error is produced for an enabled-only Save.
    expect(composePayload(ROUTING(), { enabled: "true", mode: "", advanced: "" }, {}).ok).toBe(true)
  })
})

type SyncValue = ReturnType<typeof useSync>

function fakeModel(name: string): Provider["models"][string] {
  return { name, status: "active", cost: { input: 3, output: 6, cache: { read: 0, write: 0 } } } as unknown as Provider["models"][string]
}
function fakeProvider(id: string, name: string, models: Record<string, Provider["models"][string]>): Provider {
  return { id, name, source: "api", env: [], options: {}, models } as unknown as Provider
}
function defaultCatalog(): Provider[] {
  return [fakeProvider("anthropic", "Anthropic", { "claude-sonnet": fakeModel("Claude Sonnet") })]
}

function createFakeSync(initial: Provider[]) {
  const [store] = createStore<{ provider: Provider[] }>({ provider: initial })
  return { value: { data: store } as unknown as SyncValue }
}

async function wait(fn: () => boolean, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

/**
 * A spy port whose `routing.configure` is REJECTED with the backend's real
 * `invalid_argument` reason. `routing.status` reads an effective WITHOUT a mode so
 * the Mode picker stays at the "— select —" placeholder (the reported bug's state).
 */
const INVALID_ARGUMENT_MESSAGE = "routing.configure mode must be one of always, auto, or never"
function rejectingRoutingSpy() {
  const respond = (input: TryHandleInput) => {
    if (input.text.includes("routing.configure"))
      return spyDisplay({ title: "Operator", message: INVALID_ARGUMENT_MESSAGE, variant: "warning", outcome: "invalid_argument" })
    return spyDisplay()
  }
  const structured = (input: TryHandleInput): OperatorStructuredResult | undefined => {
    if (input.text.includes("routing.status")) return { outcome: "success", effective: { enabled: false }, version: "1" }
    if (input.text.includes("routing.configure")) return { outcome: "invalid_argument", version: "1" }
    return { outcome: "success", version: "2" }
  }
  return createSpyPort(respond, structured)
}

async function mountDialog(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const sync = createFakeSync(defaultCatalog())
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
  return { app, dialog: captured! }
}

async function frameHas(app: { captureCharFrame: () => string }, needle: string, timeout = 4000) {
  await wait(() => app.captureCharFrame().includes(needle), timeout)
}

describe("Feature 029 — a rejected routing.configure surfaces the reason in-modal (no silent no-op)", () => {
  test("flip Enabled + Save at the placeholder: mode omitted, invalid_argument shown, modal stays open", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = rejectingRoutingSpy()
    const { toast } = createFakeToast()
    let saved = 0
    try {
      dialog.push(() => <text>routing screen</text>)
      dialog.push(
        openMultiFieldModal({
          entry: entry("routing.configure"),
          descriptor: ROUTING(),
          port: spy.port,
          dialog,
          toast,
          onSaved: () => saved++,
        }),
      )
      await app.flush()
      // The Mode row shows the empty placeholder (routing.status carried no mode).
      await frameHas(app, "Mode")
      await frameHas(app, "— select —")
      const beforeSave = dialog.stack.length
      // Active row 0 is the Enabled toggle — Enter flips it on, then Ctrl+S saves.
      app.mockInput.pressEnter()
      await frameHas(app, "[x] on")
      app.mockInput.pressKey("s", { ctrl: true })

      // The backend's typed reason is surfaced IN-MODAL; the modal stays open; no onSaved.
      await frameHas(app, "mode must be one of")
      expect(dialog.stack.length).toBe(beforeSave)
      expect(saved).toBe(0)
      // The dispatched payload OMITS mode (sends `{enabled:true}`), never `mode:""`.
      const configureCall = spy.tryHandleCalls.find((c) => c.text.startsWith("/op.routing.configure "))
      expect(configureCall).toBeDefined()
      const sent = JSON.parse(configureCall!.text.slice(configureCall!.text.indexOf(" ") + 1))
      expect(sent).toEqual({ enabled: true })
      expect("mode" in sent).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })
})
