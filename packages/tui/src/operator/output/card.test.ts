import { describe, expect, test } from "bun:test"
import type { OutputStat } from "@opencode-ai/protocol/outputspool/commands"
import { deriveEntryCardView } from "./card"

function stat(overrides: Partial<OutputStat> = {}): OutputStat {
  return {
    outputRef: "outref_abc123",
    channel: "stdout",
    state: "sealed",
    committedBytes: 4096,
    fsyncTier: "durable",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  }
}

describe("output-panel entry card projection (FR18, FR41, C22)", () => {
  test("derives text-first fields, never a path (C18)", () => {
    const view = deriveEntryCardView(stat())
    expect(view.outputRef).toBe("outref_abc123")
    expect(view.channelText).toBe("stdout")
    expect(view.stateText).toBe("sealed")
    expect(view.committedBytesText).toBe("4096 B")
    expect(view.durabilityTierText).toBe("durable")
    expect(view.languageTagText).toBeNull()
    expect(view.updatedAtText).toBe("2026-07-18T00:00:00.000Z")
  })

  test("surfaces the Feature 004 language tag when present", () => {
    const view = deriveEntryCardView(stat({ languageTag: "pt-BR" }))
    expect(view.languageTagText).toBe("pt-BR")
  })
})
