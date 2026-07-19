/** @jsxImportSource @opentui/solid */
/**
 * Feature 012 T016 — end-to-end integration across the consumption seam (FR1-FR9).
 *
 * 1. Forward + thread: a port that carries the structured half of the handled
 *    result (the typed `outcome`, the optional `effective` payload, the `version`
 *    — the SAME shape `tui-port.ts` forwards) is surfaced unchanged by
 *    `executeOperatorCommand` on both a read and a mutation dispatch. Absence of
 *    `effective` is representable (FR2). The opencode-side `tui-port.ts` widening
 *    itself is pinned in `packages/opencode/test/operator/slash-runtime-wire.test.ts`.
 * 2. Live panel: the exact `DialogOperatorReadPanel` pipeline — dispatch the read,
 *    take `result.result?.effective`, run the domain projection, feed the panel
 *    view-model — renders live rows from a stubbed structured result and the honest
 *    empty baseline when the read carries no effective (FR5, FR8).
 * 3. Back stack: `dialog.push` appends a level (Home → domain → panel) and the
 *    escape binding pops exactly one, walking back panel → domain → Home (FR7).
 */
import { testRender } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, type JSX } from "solid-js"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import { projectJobsSignal, deriveVisibleDefinitionCards } from "../../src/operator/jobs/state"
import type { OperatorStructuredResult } from "../../src/context/operator-slash"
import type { DialogContext } from "../../src/ui/dialog"
import { createSpyPort, createFakeToast, createFakeDialog, spyDisplay } from "./harness"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

/** Poll a predicate on real time — the escape binding's stack update settles across a tick. */
async function wait(fn: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function jobDefinition(id: string) {
  return {
    jobDefinitionId: id,
    name: `job ${id}`,
    description: "",
    enabled: true,
    schedule: { scheduleId: `sched_${id}`, cronExpression: "* * * * *", ianaTimezone: "UTC" },
    actionType: "native_maintenance",
    overlapPolicy: "forbid",
    misfirePolicy: "skip",
    registrationState: "registered",
    nextDueAt: null,
    lastOutcome: null,
    version: 1,
    updatedAt: "2026-07-19T00:00:00.000Z",
  }
}

describe("T016 forward + thread the structured result through executeOperatorCommand (FR1-FR3)", () => {
  test("a read dispatch surfaces the port's structured result verbatim (outcome/effective/version)", async () => {
    const structured: OperatorStructuredResult = { outcome: "success", effective: { definitions: [jobDefinition("jobdef_a")] }, version: "7" }
    const spy = createSpyPort(() => spyDisplay(), () => structured)
    const { toast } = createFakeToast()

    const result = await executeOperatorCommand({ entry: entry("jobs.list"), port: spy.port, dialog: createFakeDialog(), toast })

    expect(result.result).toEqual(structured)
    expect(result.result?.effective).toBeDefined()
    expect(spy.tryHandleCalls).toHaveLength(1)
  })

  test("a mutation dispatch threads the structured result off the handled branch", async () => {
    const structured: OperatorStructuredResult = { outcome: "success", effective: { tag: "pt-BR" }, version: "3" }
    const spy = createSpyPort(() => spyDisplay(), () => structured)
    const { toast } = createFakeToast()

    const result = await executeOperatorCommand({
      entry: entry("langlock.set"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { tag: "pt-BR" },
    })

    expect(result.result).toEqual(structured)
    // single dispatch — preflight then one tryHandle, no second path
    expect(spy.preflightCalls).toHaveLength(1)
    expect(spy.tryHandleCalls).toHaveLength(1)
  })

  test("absence of effective is representable and not an error (FR2)", async () => {
    const spy = createSpyPort(() => spyDisplay(), () => ({ outcome: "success", version: null }))
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({ entry: entry("langlock.status"), port: spy.port, dialog: createFakeDialog(), toast })
    expect(result.result).toEqual({ outcome: "success", version: null })
    expect(result.result?.effective).toBeUndefined()
  })
})

describe("T016 live read panel renders projected rows from a stubbed structured result (FR5, FR8)", () => {
  // Mirrors DialogOperatorReadPanel: dispatch the read, take result.result?.effective,
  // run the domain projection, feed the panel view-model.
  async function renderJobsPanelRows(structured?: (i: unknown) => OperatorStructuredResult | undefined) {
    const spy = createSpyPort(() => spyDisplay(), structured)
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({ entry: entry("jobs.list"), port: spy.port, dialog: createFakeDialog(), toast })
    const signal = projectJobsSignal(result.result?.effective).signal
    return deriveVisibleDefinitionCards(signal)
  }

  test("a populated jobs.list read renders live definition cards", async () => {
    const rows = await renderJobsPanelRows(() => ({ outcome: "success", effective: { definitions: [jobDefinition("jobdef_a"), jobDefinition("jobdef_b")] }, version: null }))
    expect(rows.map((r) => r.jobDefinitionId)).toEqual(["jobdef_a", "jobdef_b"])
  })

  test("an unavailable read (no effective) renders the honest empty baseline — no fabricated rows", async () => {
    const rows = await renderJobsPanelRows()
    expect(rows).toEqual([])
  })
})

/** Mount a bare DialogProvider and capture its context so the test can drive push/escape. */
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
  if (!captured) throw new Error("dialog context was not captured")
  return { app, dialog: captured }
}

describe("T016 dialog back stack — push appends, escape pops exactly one (FR7)", () => {
  test("Home → domain → panel descends via push; escape walks back one level per press", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    try {
      dialog.push(() => <text>home</text>)
      dialog.push(() => <text>domain</text>)
      dialog.push(() => <text>panel</text>)
      expect(dialog.stack.length).toBe(3)

      await app.flush()
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 2)
      expect(dialog.stack.length).toBe(2)

      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 1)
      expect(dialog.stack.length).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("dialog.pop unwinds exactly one level (close-on-success back to the screen, FR9)", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const closed: string[] = []
    try {
      dialog.push(() => <text>screen</text>)
      dialog.push(() => <text>modal</text>, () => closed.push("modal"))
      expect(dialog.stack.length).toBe(2)

      await app.flush()
      // A modal Save closes itself programmatically, not via escape — back to the screen.
      dialog.pop()
      await wait(() => dialog.stack.length === 1)
      expect(dialog.stack.length).toBe(1)
      expect(closed).toEqual(["modal"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("push runs each level's onClose exactly once as escape pops it", async () => {
    await using tmp = await tmpdir()
    const { app, dialog } = await mountDialog(tmp.path)
    const closed: string[] = []
    try {
      dialog.push(() => <text>a</text>, () => closed.push("a"))
      dialog.push(() => <text>b</text>, () => closed.push("b"))
      expect(dialog.stack.length).toBe(2)

      await app.flush()
      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 1)
      expect(closed).toEqual(["b"])

      app.mockInput.pressEscape()
      await wait(() => dialog.stack.length === 0)
      expect(closed).toEqual(["b", "a"])
    } finally {
      app.renderer.destroy()
    }
  })
})
