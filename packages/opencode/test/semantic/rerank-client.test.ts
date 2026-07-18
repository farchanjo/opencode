/**
 * Feature 006 / T028 (S17) — rerank profiles acceptance.
 *
 * Profile A/B round-trip against fakes; profile C is rejected for the reranker
 * slot; a rerank-suggestive model name without a passing probe is ineligible
 * (FR30, FR4, C16, AC24, AC25, AC26, AC34).
 */
import { describe, expect, test } from "bun:test"
import { RerankClient } from "@/semantic/rerank-client"

const request: RerankClient.RerankRequest = {
  baseUrl: "https://api.example",
  model: "reranker",
  query: "deploy the service",
  documents: [
    { canonicalId: "a", text: "deployment agent" },
    { canonicalId: "b", text: "unrelated" },
  ],
  topK: 2,
}

describe("profile A (native /v1/rerank)", () => {
  test("round-trips and returns a ranked result", async () => {
    const http: RerankClient.NativeRerankHttpPort = {
      postRerank: async () => [{ canonicalId: "b", score: 0.1 }, { canonicalId: "a", score: 0.9 }],
    }
    const out = await RerankClient.rerankNative({ http }, request)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.results[0].canonicalId).toBe("a")
      expect(out.results[0].rank).toBe(0)
    }
  })
})

describe("profile B (structured chat)", () => {
  test("round-trips deterministically at temperature 0 under a token budget", async () => {
    let sawTemp: number | undefined
    let sawBudget: number | undefined
    const http: RerankClient.StructuredChatHttpPort = {
      postStructuredRerank: async (req) => {
        sawTemp = req.temperature
        sawBudget = req.tokenBudget
        return [{ canonicalId: "a", score: 0.8 }, { canonicalId: "b", score: 0.2 }]
      },
    }
    const out = await RerankClient.rerankStructured({ http }, { ...request, tokenBudget: 2000 })
    expect(out.ok).toBe(true)
    expect(sawTemp).toBe(0)
    expect(sawBudget).toBe(2000)
  })
})

describe("profile C (embedding-similarity)", () => {
  test("is never eligible for the reranker slot", () => {
    expect(RerankClient.isRerankerEligible("embedding-similarity")).toBe(false)
    expect(RerankClient.isRerankerEligible("native-rerank")).toBe(true)
    expect(RerankClient.isRerankerEligible("structured-chat")).toBe(true)
    const rejection = RerankClient.rejectForRerankerSlot("embedding-similarity")
    expect(rejection?.type).toBe("reranker_not_eligible")
  })

  test("an eligible profile is not rejected", () => {
    expect(RerankClient.rejectForRerankerSlot("native-rerank")).toBeNull()
  })
})

describe("name inference", () => {
  test("a rerank-suggestive model name without a passing probe is ineligible", () => {
    expect(RerankClient.eligibleAfterProbe({ probePassed: false })?.type).toBe("not_validated")
    expect(RerankClient.eligibleAfterProbe({ probePassed: true })).toBeNull()
  })
})
