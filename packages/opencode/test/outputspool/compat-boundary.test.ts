/**
 * Feature 005 / T033 (S21) — streaming sink + bounded compatibility boundary.
 * Asserts an oversized non-streaming source is spilled under caps with no path in
 * the result and a native source streams into the sink (FR35-FR37, C11, AC13).
 */
import { describe, expect, test } from "bun:test"
import { CompatBoundary } from "@/outputspool/compat-boundary"

const enc = (s: string) => new TextEncoder().encode(s)

const recordingSink = (ref: string) => {
  const parts: Uint8Array[] = []
  return {
    parts,
    sink: {
      output_ref: ref,
      append: (chunk: Uint8Array) => void parts.push(chunk),
      seal: () => parts.reduce((n, p) => n + p.length, 0),
    },
  }
}

describe("compat-boundary", () => {
  test("native source streams into the sink from the first chunk", async () => {
    const rec = recordingSink("ref-stream")
    async function* chunks() {
      yield enc("foo")
      yield enc("bar")
    }
    const result = await CompatBoundary.streamInto(rec.sink, { chunks: chunks() })
    expect(rec.parts).toHaveLength(2)
    expect(result.output_ref).toBe("ref-stream")
    expect(result.committed_bytes).toBe(6)
    expect(result).not.toHaveProperty("path")
  })

  test("oversized whole source is spilled under caps and marked degraded, no path", async () => {
    const rec = recordingSink("ref-spill")
    const big = enc("x".repeat(100))
    const result = await CompatBoundary.spillWhole(
      rec.sink,
      { value: () => big },
      { max_bytes: 10, max_ms: 1000, max_preview_bytes: 8 },
    )
    expect(result.degraded).toBe(true)
    expect(result.committed_bytes).toBe(10)
    expect(result.preview.length).toBeLessThanOrEqual(8)
    expect(JSON.stringify(result)).not.toContain("/")
  })

  test("small whole source materializes inline without degrading", async () => {
    const rec = recordingSink("ref-small")
    const result = await CompatBoundary.spillWhole(rec.sink, { value: () => enc("ok") })
    expect(result.degraded).toBe(false)
    expect(result.preview).toBe("ok")
  })
})
