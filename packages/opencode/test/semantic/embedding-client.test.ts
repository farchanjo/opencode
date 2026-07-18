/**
 * Feature 006 / T027 (S16) — embedding probe/client acceptance.
 *
 * Against a fake endpoint: the probe captures dimension/normalization, batch caps
 * are enforced, and a dimension-mismatch model is excluded (FR30, C5, C8, AC23).
 */
import { describe, expect, test } from "bun:test"
import { EmbeddingClient } from "@/semantic/embedding-client"

const unitVector = (n: number): number[] => {
  const v = new Array(n).fill(0)
  v[0] = 1
  return v
}

const fakeHttp = (dimension: number, caps?: { maxBatchSize?: number; maxInputTokens?: number }): EmbeddingClient.EmbeddingsHttpPort => ({
  postEmbeddings: async (request) => ({
    vectors: request.inputs.map(() => unitVector(dimension)),
    maxBatchSize: caps?.maxBatchSize,
    maxInputTokens: caps?.maxInputTokens,
  }),
})

describe("embedding probe", () => {
  test("captures dimension and normalization from a harmless sample", async () => {
    const result = await EmbeddingClient.probe({ http: fakeHttp(256, { maxBatchSize: 32 }) }, { baseUrl: "https://api.example", model: "m" })
    expect(result.eligible).toBe(true)
    if (result.eligible) {
      expect(result.probe.dimension).toBe(256)
      expect(result.probe.normalized).toBe(true)
      expect(result.probe.maxBatchSize).toBe(32)
    }
  })

  test("excludes a model whose dimension mismatches the pinned binding", async () => {
    const result = await EmbeddingClient.probe({ http: fakeHttp(512) }, { baseUrl: "https://api.example", model: "m", expectedDimension: 256 })
    expect(result.eligible).toBe(false)
    if (!result.eligible) expect(result.reason).toBe("dimension_mismatch")
  })

  test("excludes a model whose probe throws", async () => {
    const http: EmbeddingClient.EmbeddingsHttpPort = { postEmbeddings: async () => { throw new Error("502") } }
    const result = await EmbeddingClient.probe({ http }, { baseUrl: "https://api.example", model: "m" })
    expect(result.eligible).toBe(false)
    if (!result.eligible) expect(result.reason).toBe("probe_failed")
  })
})

describe("embed batching", () => {
  test("caps each request to the server batch limit, never per-token", async () => {
    let calls = 0
    const http: EmbeddingClient.EmbeddingsHttpPort = {
      postEmbeddings: async (request) => {
        calls++
        expect(request.inputs.length).toBeLessThanOrEqual(2)
        return { vectors: request.inputs.map(() => unitVector(8)) }
      },
    }
    const out = await EmbeddingClient.embed({ http }, { baseUrl: "https://api.example", model: "m", texts: ["a", "b", "c", "d", "e"], maxBatchSize: 2 })
    expect(out).toHaveLength(5)
    expect(calls).toBe(3)
  })

  test("batches() splits by the cap", () => {
    expect(EmbeddingClient.batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
