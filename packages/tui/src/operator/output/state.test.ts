import { describe, expect, test } from "bun:test"
import type { OutputStat } from "@opencode-ai/protocol/outputspool/commands"
import {
  deriveDirectChildEntries,
  derivePanelPageView,
  EMPTY_OUTPUT_PANEL_SIGNAL,
  MAX_VISIBLE_ENTRIES,
  projectOutputSignal,
  resolveExpandAction,
  type OutputPanelEntry,
  type OutputPanelSignal,
} from "./state"

function stat(outputRef: string, overrides: Partial<OutputStat> = {}): OutputStat {
  return {
    outputRef,
    channel: "stdout",
    state: "sealed",
    committedBytes: 10,
    fsyncTier: "durable",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  }
}

function entry(outputRef: string, parentSessionId: string): OutputPanelEntry {
  return { parentSessionId, stat: stat(outputRef) }
}

describe("output-panel signal + projections (FR38, FR41, C22, C23, AC20)", () => {
  test("the empty baseline renders no entries and no pages", () => {
    expect(deriveDirectChildEntries(EMPTY_OUTPUT_PANEL_SIGNAL)).toEqual([])
    expect(derivePanelPageView(EMPTY_OUTPUT_PANEL_SIGNAL, "outref_1")).toBeNull()
  })

  test("shows only direct children — grandchildren under a different parent are excluded (FR38, AC20)", () => {
    const signal: OutputPanelSignal = {
      currentSessionId: "session_a",
      entries: [entry("outref_1", "session_a"), entry("outref_2", "session_b"), entry("outref_3", "session_a")],
      pages: {},
    }
    const visible = deriveDirectChildEntries(signal)
    expect(visible.map((v) => v.outputRef)).toEqual(["outref_1", "outref_3"])
  })

  test("the visible entry count is bounded", () => {
    const entries = Array.from({ length: MAX_VISIBLE_ENTRIES + 5 }, (_, i) => entry(`outref_${i}`, "session_a"))
    const signal: OutputPanelSignal = { currentSessionId: "session_a", entries, pages: {} }
    expect(deriveDirectChildEntries(signal).length).toBe(MAX_VISIBLE_ENTRIES)
  })

  test("resolveExpandAction requests a load when no page is cached (FR41, C23)", () => {
    const signal: OutputPanelSignal = { currentSessionId: "s", entries: [], pages: {} }
    expect(resolveExpandAction(signal, null, "outref_1")).toEqual({ kind: "load" })
  })

  test("resolveExpandAction collapses an already-expanded entry", () => {
    const signal: OutputPanelSignal = { currentSessionId: "s", entries: [], pages: {} }
    expect(resolveExpandAction(signal, "outref_1", "outref_1")).toEqual({ kind: "already-expanded" })
  })

  test("resolveExpandAction resumes from the cached page's cursor on reconnect (C14, C18)", () => {
    const signal: OutputPanelSignal = {
      currentSessionId: "s",
      entries: [],
      pages: { outref_1: { page: { bytes: new Uint8Array(), nextOffset: 4, committedBytes: 4, caughtUp: true, eof: false }, cursor: "cursor-token" } },
    }
    expect(resolveExpandAction(signal, null, "outref_1")).toEqual({ kind: "resume", cursor: "cursor-token" })
  })

  test("resolveExpandAction reports loaded when the cached page is eof or carries no cursor", () => {
    const signal: OutputPanelSignal = {
      currentSessionId: "s",
      entries: [],
      pages: {
        outref_eof: { page: { bytes: new Uint8Array(), nextOffset: 4, committedBytes: 4, caughtUp: true, eof: true }, cursor: "cursor-token" },
        outref_no_cursor: { page: { bytes: new Uint8Array(), nextOffset: 4, committedBytes: 4, caughtUp: true, eof: false }, cursor: null },
      },
    }
    expect(resolveExpandAction(signal, null, "outref_eof")).toEqual({ kind: "loaded" })
    expect(resolveExpandAction(signal, null, "outref_no_cursor")).toEqual({ kind: "loaded" })
  })

  test("derivePanelPageView projects a cached page for its outputRef", () => {
    const signal: OutputPanelSignal = {
      currentSessionId: "s",
      entries: [],
      pages: { outref_1: { page: { bytes: new TextEncoder().encode("hi"), nextOffset: 2, committedBytes: 2, caughtUp: true, eof: false }, cursor: null } },
    }
    expect(derivePanelPageView(signal, "outref_1")?.text).toBe("hi")
    expect(derivePanelPageView(signal, "outref_missing")).toBeNull()
  })
})

describe("projectOutputSignal — total structured-result projection (Feature 012 T006, FR4, FR8)", () => {
  test("a well-formed output effective projects its direct-child entries (projected)", () => {
    const result = projectOutputSignal({ currentSessionId: "session_a", entries: [entry("outref_1", "session_a")], pages: {} })
    expect(result.outcome).toBe("projected")
    expect(result.signal.currentSessionId).toBe("session_a")
    expect(deriveDirectChildEntries(result.signal).length).toBe(1)
  })

  test("an absent effective degrades to the honest empty baseline (empty_fallback) — output is unavailable today", () => {
    for (const absent of [undefined, null]) {
      const result = projectOutputSignal(absent)
      expect(result.outcome).toBe("empty_fallback")
      expect(result.signal).toBe(EMPTY_OUTPUT_PANEL_SIGNAL)
    }
  })

  test("a malformed effective degrades to the honest empty baseline without throwing (shape_mismatch)", () => {
    for (const bad of [1, "output", [], {}, { currentSessionId: 1, entries: [] }, { currentSessionId: "s", entries: [{ stat: {} }] }]) {
      const result = projectOutputSignal(bad)
      expect(result.outcome).toBe("shape_mismatch")
      expect(result.signal).toBe(EMPTY_OUTPUT_PANEL_SIGNAL)
    }
  })
})
