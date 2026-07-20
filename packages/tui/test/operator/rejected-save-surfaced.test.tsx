/** @jsxImportSource @opentui/solid */
/**
 * Feature 021 FR-D — a REJECTED operator config-backed save is surfaced, never a silent
 * success and never a silent zero. This locks the HEAD behavior against regression: when a
 * `pools.set` from the operator multi-field form is rejected by the backend (a real
 * conflict / invalid argument), the modal MUST stay open and render the typed, secret-free
 * reason in-modal via `setError(failureReason(result))` (multi-field-modal.tsx:289-295), and
 * MUST NOT fire `onSaved` or close — only a SUCCESS outcome may close the form. The
 * slash/CLI path (silent:false) toasts the same typed reason (execute.ts:205,218).
 *
 * Driven END-TO-END with the keyboard through the real component chain + the real
 * `executeOperatorCommand`, exactly as the operator UI runs — not a hand-mocked submit.
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
import { resolveOperatorFieldList } from "../../src/operator/form/field-list"
import { executeOperatorCommand } from "../../src/operator/execute"
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
 * A spy port whose `pools.set` is REJECTED (a real conflict). `pools.show` still reads an
 * effective so the editor pre-fills; `pools.set` returns a non-success display + structured
 * outcome — the exact "backend rejected the save" envelope the modal must surface in-modal.
 */
function rejectingPoolsSpy() {
  const respond = (input: TryHandleInput) => {
    if (input.text.includes("pools.set"))
      return spyDisplay({ title: "Operator conflict", message: "CAS version conflict", variant: "warning", outcome: "conflict" })
    return spyDisplay()
  }
  const structured = (input: TryHandleInput): OperatorStructuredResult | undefined => {
    if (input.text.includes("pools.show")) return { outcome: "success", effective: { bindings: [] }, version: "1" }
    if (input.text.includes("pools.set")) return { outcome: "conflict", version: "1" }
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

describe("Feature 021 FR-D — a rejected pools.set stays in-modal, never a silent success/zero", () => {
  test("the modal shows the typed reason, stays open, and does NOT fire onSaved", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const spy = rejectingPoolsSpy()
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
          onSaved: () => saved++,
        }),
      )
      await app.flush()
      await frameHas(app, "Role bindings")
      // Add a valid binding: worker → claude-sonnet (so save-time validation passes and dispatch runs).
      app.mockInput.pressEnter()
      await frameHas(app, "+ Add binding")
      app.mockInput.pressEnter()
      await frameHas(app, "Role")
      await app.mockInput.typeText("worker")
      app.mockInput.pressEnter()
      await wait(() => dialog.stack.length === 3)
      await frameHas(app, "worker")
      app.mockInput.pressEnter()
      await frameHas(app, "+ Add model")
      app.mockInput.pressEnter()
      await frameHas(app, "Select model")
      await app.mockInput.typeText("sonnet")
      await frameHas(app, "Claude Sonnet")
      app.mockInput.pressEnter()
      await frameHas(app, "anthropic/claude-sonnet")
      // Back to the form, then Save (Ctrl+S) — the backend REJECTS it.
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 3)
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)
      const beforeSave = dialog.stack.length
      app.mockInput.pressKey("s", { ctrl: true })

      // The typed, secret-free reason is surfaced IN-MODAL; the modal stays open; no onSaved.
      await frameHas(app, "CAS version conflict")
      expect(dialog.stack.length).toBe(beforeSave) // never popped on a non-success outcome
      expect(saved).toBe(0)
      // The save DID dispatch (it was genuinely rejected, not silently skipped).
      expect(spy.tryHandleCalls.some((c) => c.text.startsWith("/op.pools.set "))).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("Feature 021 FR-D — the slash/CLI path toasts a rejected save (non-silent), never a false success", () => {
  test("a rejected pools.set toasts the typed reason with a non-success variant", async () => {
    const spy = rejectingPoolsSpy()
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("pools.set"),
      port: spy.port,
      projectId: "proj_21",
      dialog: { clear: () => {}, replace: () => {}, push: () => {}, pop: () => {} } as never,
      toast,
      payload: { bindings: [{ role: "worker", models: ["anthropic/claude-sonnet"] }] },
    })
    expect(result.outcome).toBe("conflict")
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((c) => c.variant !== "success")).toBe(true)
    expect(calls.some((c) => c.message.includes("CAS version conflict"))).toBe(true)
  })
})
