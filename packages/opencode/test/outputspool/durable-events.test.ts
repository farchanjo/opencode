/**
 * Feature 005 / T031 (S19) — durable output.* settlement projection.
 * Asserts a settlement event is built content-free (no path, no content chunk)
 * and projected through the single publish boundary exactly once (FR4, FR5, C20,
 * C22, AC9).
 */
import { describe, expect, test } from "bun:test"
import { DurableEvents } from "@/outputspool/durable-events"

const facts: DurableEvents.SettlementFacts = {
  group_id: "grp_1",
  output_ref: "ref_1",
  channel: "stdout",
  generation: 0,
  correlation_id: "corr_1",
  committed_bytes: 42,
  timestamp_ms: 1_000,
  sequence: 3,
}

describe("durable-events", () => {
  test("channelSealed builds a content-free sealed event with the committed length", () => {
    const event = DurableEvents.channelSealed(facts, "tag-xyz")
    expect(event.type).toBe("output.channel_sealed")
    if (event.type === "output.channel_sealed") expect(event.detail.committed_bytes).toBe(42)
    const json = JSON.stringify(event)
    expect(json).not.toContain("/")
    expect(json).toContain("corr_1")
  })

  test("reconciled carries the recovery outcome and correlation id", () => {
    const event = DurableEvents.reconciled(facts, "corrupt")
    expect(event.type).toBe("output.reconciled")
    if (event.type === "output.reconciled") expect(event.detail.outcome).toBe("corrupt")
    expect(String(event.envelope.ordering.correlation_id)).toBe("corr_1")
  })

  test("projector emits through the single publish boundary exactly once", async () => {
    const published: string[] = []
    const projector = DurableEvents.createDurableEventsProjector((e) => void published.push(e.type))
    await projector.emit(DurableEvents.groupReclaimed(facts, "transcript", "session"))
    expect(published).toEqual(["output.group_reclaimed"])
  })
})
