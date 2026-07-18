/**
 * Feature 005 / T035 (S23) — budgeted context-slice materialization.
 * Asserts only selected ranges are materialized, the ranges used are recorded,
 * and no full-file injection occurs (FR32, FR33, C10, AC12, AC19).
 */
import { describe, expect, test } from "bun:test"
import { ContextSlice } from "@/outputspool/context-slice"

const enc = (s: string) => new TextEncoder().encode(s)

describe("context-slice", () => {
  test("materializes only the requested ranges and records each", async () => {
    const reads: Array<{ offset: number; limit: number }> = []
    const recorded: Array<{ offset: number; length: number }> = []
    const slice = ContextSlice.createContextSlice(
      async (_ref, offset, limit) => {
        reads.push({ offset, limit })
        return { bytes: enc("ab") }
      },
      (_ref, range) => void recorded.push(range),
    )
    const result = await slice.materialize({
      output_ref: "ref",
      ranges: [{ offset: 0, limit: 2 }, { offset: 100, limit: 2 }],
      budget_bytes: 1000,
    })
    expect(reads).toEqual([{ offset: 0, limit: 2 }, { offset: 100, limit: 2 }])
    expect(recorded).toHaveLength(2)
    expect(result.total_bytes).toBe(4)
    expect(result.budget_exhausted).toBe(false)
  })

  test("stops at the byte budget — never injects the whole file", async () => {
    const slice = ContextSlice.createContextSlice(
      async (_ref, _offset, limit) => ({ bytes: enc("x".repeat(limit)) }),
      () => {},
    )
    const result = await slice.materialize({
      output_ref: "ref",
      ranges: [{ offset: 0, limit: 5 }, { offset: 10, limit: 5 }, { offset: 20, limit: 5 }],
      budget_bytes: 6,
    })
    expect(result.total_bytes).toBeLessThanOrEqual(6)
    expect(result.budget_exhausted).toBe(true)
  })
})
