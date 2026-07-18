/**
 * Feature 005 / T030 (S18) — ref-aware retention sweeper.
 * Asserts a referenced output survives an expired TTL and a bounded batch
 * reclaims only fully unreferenced expired groups, never mtime-only (FR28-FR30,
 * C5, AC16, AC17).
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { ControlStore } from "@/outputspool/control-store"
import { RetentionSweeper } from "@/outputspool/retention-sweeper"

const setup = () => {
  const store = ControlStore.createControlStore(new Database(":memory:"))
  const removed: string[] = []
  const sweeper = RetentionSweeper.createRetentionSweeper({
    store,
    removeSubtree: (ref) => void removed.push(ref),
    now: () => 10_000,
  })
  const open = (ref: string) =>
    store.openGeneration({ output_ref: ref, group_id: ref, generation: 0, channel: "stdout", durability_tier: "console", correlation_id: "c", now: 1 })
  return { store, removed, sweeper, open }
}

const meta = (ref: string, over: boolean, referenced: boolean, legalHold = false): RetentionSweeper.GroupRetentionMeta => ({
  output_ref: ref,
  ttl_ms: 1_000,
  created_at_ms: over ? 0 : 9_500, // over → created long ago (expired), else recent
  active_reader_or_writer: false,
  legal_hold: legalHold,
})

describe("retention-sweeper", () => {
  test("a referenced expired output survives cleanup", async () => {
    const { store, removed, sweeper, open } = setup()
    open("referenced")
    store.addEdge("referenced", "transcript", "holder")
    const result = await sweeper.cleanup([meta("referenced", true, true)])
    expect(result.reclaimed_count).toBe(0)
    expect(removed).toHaveLength(0)
  })

  test("a fully unreferenced expired output is reclaimed", async () => {
    const { removed, sweeper, open } = setup()
    open("stale")
    const result = await sweeper.cleanup([meta("stale", true, false)])
    expect(result.reclaimed_count).toBe(1)
    expect(removed).toEqual(["stale"])
  })

  test("legal hold blocks reclaim even when expired and unreferenced", async () => {
    const { removed, sweeper, open } = setup()
    open("held")
    const result = await sweeper.cleanup([meta("held", true, false, true)])
    expect(result.reclaimed_count).toBe(0)
    expect(removed).toHaveLength(0)
  })

  test("bounded batch reclaims at most batchSize", async () => {
    const store = ControlStore.createControlStore(new Database(":memory:"))
    const removed: string[] = []
    const sweeper = RetentionSweeper.createRetentionSweeper({ store, removeSubtree: (r) => void removed.push(r), now: () => 10_000, batchSize: 2 })
    const metas: RetentionSweeper.GroupRetentionMeta[] = []
    for (let i = 0; i < 5; i++) {
      store.openGeneration({ output_ref: `r${i}`, group_id: `r${i}`, generation: 0, channel: "stdout", durability_tier: "console", correlation_id: "c", now: 1 })
      metas.push(meta(`r${i}`, true, false))
    }
    const result = await sweeper.cleanup(metas)
    expect(result.reclaimed_count).toBe(2)
    expect(removed).toHaveLength(2)
  })

  test("release drops exactly one holder edge", () => {
    const { store, sweeper, open } = setup()
    open("rel")
    store.addEdge("rel", "transcript", "h1")
    store.addEdge("rel", "handoff", "h2")
    const remaining = sweeper.release("rel", "transcript", "h1")
    expect(remaining).toBe(1)
  })
})
