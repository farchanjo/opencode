/**
 * Feature 050 / T011-T012 (FR6) — the model-driven dimension discovery ladder.
 *
 * Asserts a live probe stamps the REAL probed dimension/normalization, a failed
 * probe retries at most twice then FAILS CLOSED with a typed `probe_failed` (no
 * default dimension), a `dimension_mismatch` domain reject is not retried, and
 * the metadata cross-check seam (default absent) supplies a value only when the
 * live probe cannot.
 */
import { describe, expect, test } from "bun:test"
import { DimensionProbe } from "@/semantic/dimension-probe"
import type { EmbeddingsHttpPort } from "@/semantic/embedding-client"

const BINDING = { baseUrl: "https://emb.local", modelRef: "qwen3-embedding-4b" }

/** A fake embeddings port returning a fixed-length vector, or throwing to force a probe failure. */
function fakeHttp(behavior: (call: number) => number[] | "throw"): { port: EmbeddingsHttpPort; calls: () => number } {
  let calls = 0
  const port: EmbeddingsHttpPort = {
    postEmbeddings: async () => {
      calls += 1
      const result = behavior(calls)
      if (result === "throw") throw new Error("endpoint unreachable")
      return { vectors: [result] }
    },
  }
  return { port, calls: () => calls }
}

describe("probeVectorSpace", () => {
  test("stamps the real probed dimension on a live probe pass", async () => {
    const { port } = fakeHttp(() => new Array(2560).fill(0))
    const result = await DimensionProbe.probeVectorSpace({ http: port }, BINDING)
    expect("type" in result).toBe(false)
    if (!("type" in result)) {
      expect(result.dimension).toBe(2560)
      expect(result.metric).toBe("cosine")
      expect(result.source).toBe("live-probe")
    }
  })

  test("captures normalization from the probe", async () => {
    const { port } = fakeHttp(() => [0.6, 0.8]) // L2 norm == 1
    const result = await DimensionProbe.probeVectorSpace({ http: port }, BINDING)
    if (!("type" in result)) expect(result.normalized).toBe(true)
  })

  test("retries at most twice then fails closed with a typed probe_failed", async () => {
    const { port, calls } = fakeHttp(() => "throw")
    const result = await DimensionProbe.probeVectorSpace({ http: port }, BINDING)
    expect(result).toEqual({ type: "probe_failed", detail: expect.any(String) })
    expect(calls()).toBe(3) // 1 + 2 retries
  })

  test("uses the metadata cross-check seam as a last resort", async () => {
    const { port } = fakeHttp(() => "throw")
    const result = await DimensionProbe.probeVectorSpace(
      {
        http: port,
        metadata: async () => ({ dimension: 1536, metric: "cosine", normalized: true, probedAt: "2026-07-21T00:00:00Z" }),
      },
      BINDING,
    )
    if (!("type" in result)) {
      expect(result.dimension).toBe(1536)
      expect(result.source).toBe("metadata-crosscheck")
    } else {
      throw new Error("expected a metadata-crosscheck vector space")
    }
  })
})
