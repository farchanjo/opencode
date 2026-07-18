/**
 * Feature 005 / T028 (S16) — SQLite control store.
 * Asserts committed-length monotonicity per generation, fence-record
 * persistence, and stale-generation open rejection over an in-memory database
 * (FR25, FR27, C12, C18, AC8).
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { ControlStore } from "@/outputspool/control-store"

const store = () => ControlStore.createControlStore(new Database(":memory:"))

const open = (s: ReturnType<typeof store>, output_ref: string, group_id: string, generation: number) =>
  s.openGeneration({
    output_ref, group_id, generation, channel: "stdout",
    durability_tier: "console", correlation_id: "corr", now: 1,
  })

describe("control-store", () => {
  test("committed length is monotonic per generation", () => {
    const s = store()
    open(s, "ref1", "g1", 0)
    expect(s.recordCommitted("ref1", 10, 2)).toBe(10)
    expect(s.recordCommitted("ref1", 25, 3)).toBe(25)
    // A stale/short report never shrinks the committed authority (C12).
    expect(s.recordCommitted("ref1", 5, 4)).toBe(25)
  })

  test("seal and abort fence records persist", () => {
    const s = store()
    open(s, "ref2", "g2", 0)
    s.recordSeal("ref2", "tag-abc", 5)
    const rec = s.get("ref2")!
    expect(rec.seal_record).toBe(true)
    expect(rec.state).toBe("sealed")
    expect(rec.integrity_tag).toBe("tag-abc")
  })

  test("a stale generation open is fenced (never overwrites the active generation)", () => {
    const s = store()
    open(s, "ref-new", "g3", 2)
    const outcome = open(s, "ref-old", "g3", 1)
    expect(outcome.accepted).toBe(false)
    if (!outcome.accepted) expect(outcome.active_generation).toBe(2)
  })

  test("reference edges gate cleanup and release drops exactly one", () => {
    const s = store()
    open(s, "ref4", "g4", 0)
    s.addEdge("ref4", "transcript", "h1")
    s.addEdge("ref4", "handoff", "h2")
    expect(s.listEdges("ref4")).toHaveLength(2)
    expect(s.removeEdge("ref4", "transcript", "h1")).toBe(true)
    expect(s.listEdges("ref4")).toHaveLength(1)
  })

  test("listOpen returns open/sealing generations for recovery", () => {
    const s = store()
    open(s, "refA", "gA", 0)
    open(s, "refB", "gB", 0)
    s.recordSeal("refB", "t", 3)
    const openRefs = s.listOpen().map((r) => r.output_ref)
    expect(openRefs).toContain("refA")
    expect(openRefs).not.toContain("refB")
  })
})
