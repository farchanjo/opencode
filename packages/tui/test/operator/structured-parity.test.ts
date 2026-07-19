/**
 * Feature 012 T017 — parity invariant (FR9). Threading the structured result back
 * to the TUI introduces NO new dispatch path, parallel registry, or divergent
 * command name: a structured-result-bearing dispatch resolves the SAME canonical
 * `/op.<id>` token through the SAME `OperatorSlashPort` loopback that slash/CLI use,
 * with exactly one `tryHandle` on the wire — the structured half rides that single
 * return, it does not fork the id or add a second dispatch. This pins the token for
 * a read and a mutation whose port carries a structured result.
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import type { OperatorStructuredResult } from "../../src/context/operator-slash"
import { createSpyPort, createFakeToast, createFakeDialog, spyDisplay, type SpyPort } from "./harness"

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

/** Dispatch through a spy port that carries the structured half of the handled result. */
async function dispatchStructured(e: OperatorPaletteEntry, structured: OperatorStructuredResult, payload?: Record<string, unknown>): Promise<SpyPort> {
  const spy = createSpyPort(() => spyDisplay(), () => structured)
  const { toast } = createFakeToast()
  await executeOperatorCommand({ entry: e, port: spy.port, dialog: createFakeDialog(), toast, payload })
  return spy
}

describe("T017 structured path rides the same canonical command id (FR9)", () => {
  test("a structured read dispatches the exact canonical /op.<id> — same alias slash/CLI resolve", async () => {
    const status = entry("langlock.status")
    const spy = await dispatchStructured(status, { outcome: "success", effective: { tag: "pt-BR" }, version: null })
    expect(spy.tryHandleCalls).toHaveLength(1)
    const token = commandToken(spy.tryHandleCalls[0].text)
    expect(token).toBe("/op.langlock.status")
    expect(token).toBe(status.slashAlias)
    expect(status.slashAlias).toBe(`/op.${status.id}`)
  })

  test("a structured mutation dispatches the exact canonical /op.<id> — the effective payload does not fork the id", async () => {
    const set = entry("langlock.set")
    const spy = await dispatchStructured(set, { outcome: "success", effective: { tag: "en-US" }, version: "1" }, { tag: "en-US" })
    expect(spy.tryHandleCalls).toHaveLength(1)
    const token = commandToken(spy.tryHandleCalls[0].text)
    expect(token).toBe("/op.langlock.set")
    expect(token).toBe(set.slashAlias)
  })

  test("no second dispatch path: the structured half rides the single tryHandle for a sample of reads", async () => {
    for (const id of ["langlock.status", "jobs.status", "process.status", "task.status", "routing.status"]) {
      const e = entry(id)
      const spy = await dispatchStructured(e, { outcome: "success", version: null })
      expect(spy.tryHandleCalls).toHaveLength(1)
      expect(commandToken(spy.tryHandleCalls[0].text)).toBe(`/op.${e.id}`)
    }
  })
})
