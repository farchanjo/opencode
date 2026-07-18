import { describe, expect, test } from "bun:test"
import { FreshnessGate } from "@opencode-ai/core/semantic/freshness-gate"

// Feature 006 / T021 (S12) — the freshness gate and post-retrieval revalidation:
// a stale disabled agent dropped, an over-permission skill dropped, and a
// stale-confidence candidate degraded (FR20, FR27, FR34, C11, AC4, AC5).

const edges = { boundedMs: 1_000, staleMs: 10_000 }
const fresh: FreshnessGate.LiveFacts = { enabled: true, available: true, permitted: true }

describe("FreshnessGate — buckets", () => {
  test("maps age to fresh/bounded/stale", () => {
    expect(FreshnessGate.bucketOf(0, edges)).toBe("fresh")
    expect(FreshnessGate.bucketOf(5_000, edges)).toBe("bounded")
    expect(FreshnessGate.bucketOf(20_000, edges)).toBe("stale")
  })
})

describe("FreshnessGate — revalidation drops (AC4, AC5, AC11)", () => {
  test("a stale disabled agent is dropped even though it lingers in the index", () => {
    const out = FreshnessGate.revalidate({ ...fresh, enabled: false }, "stale")
    expect(out).toEqual({ kind: "dropped", reason: "disabled" })
  })
  test("an over-permission skill is dropped — live Permission is authoritative", () => {
    // even a FRESH candidate is dropped when live permission denies it (never
    // relies on freshness alone).
    const out = FreshnessGate.revalidate({ ...fresh, permitted: false }, "fresh")
    expect(out).toEqual({ kind: "dropped", reason: "over_permission" })
  })
  test("an unavailable candidate is dropped", () => {
    expect(FreshnessGate.revalidate({ ...fresh, available: false }, "fresh").kind).toBe("dropped")
  })
})

describe("FreshnessGate — stale-confidence degrade (AC5)", () => {
  test("a live-valid but stale candidate degrades rather than contributing a score", () => {
    expect(FreshnessGate.revalidate(fresh, "stale")).toEqual({ kind: "degraded", reason: "stale_confidence" })
  })
  test("a live-valid fresh/bounded candidate is kept", () => {
    expect(FreshnessGate.revalidate(fresh, "fresh").kind).toBe("kept")
    expect(FreshnessGate.revalidate(fresh, "bounded").kind).toBe("kept")
  })
})

describe("FreshnessGate — batch partition", () => {
  test("revalidateAll partitions kept / dropped / degraded", () => {
    const part = FreshnessGate.revalidateAll([
      { ref: "keep", facts: fresh, bucket: "fresh" },
      { ref: "perm", facts: { ...fresh, permitted: false }, bucket: "fresh" },
      { ref: "old", facts: fresh, bucket: "stale" },
    ])
    expect(part.kept).toEqual(["keep"])
    expect(part.dropped).toEqual([{ ref: "perm", reason: "over_permission" }])
    expect(part.degraded).toEqual(["old"])
  })
})
