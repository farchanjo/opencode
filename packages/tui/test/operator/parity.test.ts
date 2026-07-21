/**
 * Feature 011 T016 — parity invariant (FR8). The grouped menu / Configure form
 * introduce NO new dispatch path: every leaf resolves the SAME canonical command
 * id through the SAME `OperatorSlashPort` loopback that slash/CLI use. This spies
 * the wire text `executeOperatorCommand` produces and pins it to the entry's
 * canonical `/op.<id>` alias for a read query and a mutation.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOperatorScreenControls,
  listOperatorPaletteEntries,
  OPERATOR_SETTINGS_DOMAINS,
  RESERVED_CATALOG_VERSION,
  type OperatorPaletteEntry,
} from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import {
  buildOperatorEntityActions,
  listOperatorEntityKinds,
  resolveOperatorEntityScreen,
  type OperatorEntityRow,
} from "../../src/operator/entity"
import { resolveOperatorEditPrefill } from "../../src/operator/form/edit-descriptor"
import { createSpyPort, createFakeToast, createFakeDialog } from "./harness"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
const CATALOG_IDS = new Set(listOperatorPaletteEntries().map((e) => e.id))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

/** Command token = the wire text up to the optional JSON payload. */
function commandToken(text: string): string {
  const space = text.indexOf(" ")
  return space === -1 ? text : text.slice(0, space)
}

async function dispatch(e: OperatorPaletteEntry, payload?: Record<string, unknown>) {
  const spy = createSpyPort()
  const { toast } = createFakeToast()
  await executeOperatorCommand({ entry: e, port: spy.port, dialog: createFakeDialog(), toast, payload })
  return spy
}

describe("T016 command-id parity with slash/CLI (FR8)", () => {
  test("a read query dispatches the exact canonical /op.<id>", async () => {
    const status = entry("langlock.status")
    const spy = await dispatch(status)
    expect(spy.tryHandleCalls).toHaveLength(1)
    const token = commandToken(spy.tryHandleCalls[0].text)
    expect(token).toBe("/op.langlock.status")
    expect(token).toBe(status.slashAlias) // same alias slash/CLI resolve
    expect(status.slashAlias).toBe(`/op.${status.id}`)
  })

  test("a mutation dispatches the exact canonical /op.<id> (payload does not fork the id)", async () => {
    const set = entry("langlock.set")
    const spy = await dispatch(set, { tag: "en-US" })
    expect(spy.tryHandleCalls).toHaveLength(1)
    const token = commandToken(spy.tryHandleCalls[0].text)
    expect(token).toBe("/op.langlock.set")
    expect(token).toBe(set.slashAlias)
  })

  test("no divergent name: the dispatched token is always /op.<canonical-id> for a sample of verbs", async () => {
    for (const id of ["langlock.status", "jobs.status", "process.status", "task.status", "routing.status"]) {
      const e = entry(id)
      const spy = await dispatch(e)
      expect(commandToken(spy.tryHandleCalls[0].text)).toBe(`/op.${e.id}`)
    }
  })
})

describe("Feature 015 T024 — the CRUD redesign adds no new dispatch path / id / version bump (FR17)", () => {
  test("the reserved catalog version is unchanged — the presentation redesign never bumped it", () => {
    expect(RESERVED_CATALOG_VERSION).toBe("1.4.0")
  })

  /** Every command id any Feature 015 screen surface can dispatch, gathered from the pure classifiers. */
  function allScreenReferencedIds(): Set<string> {
    const ids = new Set<string>()
    const sampleRow: OperatorEntityRow = { entityId: "x", label: "x", badge: "b", active: true }
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const controls = buildOperatorScreenControls(domain)
      for (const toggle of controls.toggles) ids.add(toggle.enableId).add(toggle.disableId)
      for (const tri of controls.tristates) for (const mode of tri.modes) ids.add(mode.id)
      for (const kind of listOperatorEntityKinds(domain)) {
        const screen = resolveOperatorEntityScreen(kind)
        ids.add(screen.listRead)
        if (screen.createId) ids.add(screen.createId)
        for (const action of buildOperatorEntityActions(kind, sampleRow)) ids.add(action.id)
      }
      // Edit-modal pre-fill reads are canonical reads too, not a new path.
      for (const e of listOperatorPaletteEntries()) {
        const prefill = resolveOperatorEditPrefill(e.id)
        if (prefill) ids.add(prefill.readId)
      }
    }
    return ids
  }

  test("every id a control / entity action / pre-fill read dispatches is a REAL catalog id — no fabricated path", () => {
    const referenced = allScreenReferencedIds()
    expect(referenced.size).toBeGreaterThan(0)
    for (const id of referenced) expect(CATALOG_IDS.has(id)).toBe(true)
  })
})
