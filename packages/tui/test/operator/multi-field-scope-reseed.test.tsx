/** @jsxImportSource @opentui/solid */
/**
 * Feature 040 fix-round — `reseedForScope`'s latest-wins guard against an
 * out-of-order scope-switch read race (multi-field-modal.tsx).
 *
 * `reseedForScope` (Feature 040 FR-B2) copies the full raw store, resets the
 * non-secret fields, awaits a scope-resolved read, then writes the result back.
 * With no guard, a rapid scope toggle (project→global→project) can have two
 * scoped reads in flight; if the earlier-issued read resolves LATER, its write
 * clobbers the store with stale values AND reverts the request-scope key to the
 * stale snapshot it carried (re-triggering the scope-switch effect). This test
 * drives that exact out-of-order resolution — the "global" read is issued first
 * but resolves last — and asserts the final store reflects the LATEST-selected
 * ("project") scope's values, never the stale "global" ones.
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
import type { OperatorSlashPort } from "../../src/context/operator-slash"
import type { DialogContext } from "../../src/ui/dialog"
import { SyncContext, type useSync } from "../../src/context/sync"
import { MultiFieldForm, createMultiFieldState } from "../../src/operator/form/multi-field-modal"
import { resolveOperatorFieldList } from "../../src/operator/form/field-list"
import { createFakeToast, spyDisplay, type TryHandleInput } from "./harness"
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

function createFakeSync(): { value: SyncValue } {
  const [store] = createStore<{ provider: Provider[] }>({ provider: [] })
  return { value: { data: store } as unknown as SyncValue }
}

async function wait(fn: () => boolean, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountDialog(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const sync = createFakeSync()
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

type ScopedStep = { effective: unknown; delayMs: number }

/**
 * A port whose `telemetry.show` read resolves per-`requestedScope`, from a queue of
 * canned steps consumed in call order per scope, after an artificial delay — lets the
 * test choose which of two concurrently in-flight scoped reads resolves FIRST.
 */
function scopedReadPort(bySc: Record<string, ScopedStep[]>): OperatorSlashPort {
  const seen: Record<string, number> = {}
  return {
    async tryHandle(input: TryHandleInput) {
      if (!input.text.startsWith("/op.telemetry.show")) return { handled: true, display: spyDisplay() }
      const scope = input.requestedScope ?? "project"
      const queue = bySc[scope] ?? []
      const index = Math.min(seen[scope] ?? 0, queue.length - 1)
      seen[scope] = (seen[scope] ?? 0) + 1
      const step = queue[index]
      if (step?.delayMs) await Bun.sleep(step.delayMs)
      return { handled: true, display: spyDisplay(), result: { outcome: "success", effective: step?.effective, version: "1" } }
    },
  }
}

describe("Feature 040 fix-round — reseedForScope is latest-wins under an out-of-order scope-switch race", () => {
  test("a slow-resolving stale (earlier-issued) scope read never clobbers a faster, later-selected scope's values", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const { toast } = createFakeToast()
    const descriptor = resolveOperatorFieldList("telemetry.configure")!
    const [store, setStore] = createMultiFieldState(descriptor)
    const port = scopedReadPort({
      // The initial `onMount` load (default scope "project") — resolves fast, then the
      // SECOND, later-issued "project" reseed below also resolves fast.
      project: [
        { effective: { endpoint: "https://project.example/v1", transport: "grpc" }, delayMs: 5 },
        { effective: { endpoint: "https://project.example/v2", transport: "grpc" }, delayMs: 15 },
      ],
      // The FIRST-issued "global" reseed — resolves LATE, well after the second
      // "project" reseed has already landed. A latest-wins guard must drop it.
      global: [{ effective: { endpoint: "https://global.example", transport: "http/protobuf" }, delayMs: 80 }],
    })

    try {
      dialog.push(() => <text>telemetry screen</text>)
      dialog.push(() => (
        <MultiFieldForm entry={entry("telemetry.configure")} descriptor={descriptor} port={port} dialog={dialog} toast={toast} state={[store, setStore]} />
      ))
      await app.flush()
      await wait(() => store.loaded)
      await wait(() => store.raw.endpoint === "https://project.example/v1")
      expect(store.raw.__requestScope__).toBe("project")

      // Rapid project→global→project toggle: "global" is selected first (issues the
      // slow read) and "project" is re-selected right after (issues the fast read) —
      // so the earlier-issued "global" read resolves LAST, out of order.
      setStore("raw", "__requestScope__", "global")
      await wait(() => store.raw.__requestScope__ === "global")
      setStore("raw", "__requestScope__", "project")

      // The fast, later-issued "project" reseed lands first.
      await wait(() => store.raw.endpoint === "https://project.example/v2")
      expect(store.raw.__requestScope__).toBe("project")
      expect(store.raw.transport).toBe("grpc")

      // Give the stale "global" read (80ms) time to resolve and attempt its write.
      await Bun.sleep(120)

      // Latest-wins: the stale global read must not have clobbered the store — neither
      // the endpoint value nor the request-scope selection reverts to it.
      expect(store.raw.endpoint).toBe("https://project.example/v2")
      expect(store.raw.__requestScope__).toBe("project")
      expect(store.raw.transport).toBe("grpc")
    } finally {
      app.renderer.destroy()
    }
  })
})
