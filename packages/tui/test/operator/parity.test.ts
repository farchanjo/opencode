/**
 * Feature 011 T016 — parity invariant (FR8). The grouped menu / Configure form
 * introduce NO new dispatch path: every leaf resolves the SAME canonical command
 * id through the SAME `OperatorSlashPort` loopback that slash/CLI use. This spies
 * the wire text `executeOperatorCommand` produces and pins it to the entry's
 * canonical `/op.<id>` alias for a read query and a mutation.
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import { createSpyPort, createFakeToast, createFakeDialog } from "./harness"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
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
