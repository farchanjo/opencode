import { describe, expect, test } from "bun:test"
import { Degradation } from "@opencode-ai/core/semantic/degradation"

// Feature 006 / T019 (S10) — the typed capability-gap ladder: each gap code,
// catalog+lexical floor without model substitution, fail-closed opt-in, and
// bounded retry on the same binding (FR7, FR24, FR26, C14, C20, AC7, AC8, AC29).

const healthy: Degradation.HealthConditions = {
  no_binding: false,
  milvus_unavailable: false,
  embedding_unavailable: false,
  cold_index: false,
  index_stale: false,
  retrieval_timeout: false,
  reranker_unavailable: false,
}

describe("Degradation — classification", () => {
  test("a healthy set stays full_semantic with no gap", () => {
    const out = Degradation.classify(healthy)
    expect(out.mode).toBe("full_semantic")
    expect(out.gap).toBe("none")
    expect(out.degraded_reason).toBeNull()
  })

  test("each gap code drops to the catalog_lexical floor with a reason", () => {
    for (const gap of Degradation.GAP_PRECEDENCE) {
      const out = Degradation.classify({ ...healthy, [gap]: true })
      expect(out.mode).toBe("catalog_lexical")
      expect(out.gap).toBe(gap)
      expect(out.degraded_reason).toBeTruthy()
    }
  })

  test("the most severe gap wins when several conditions hold at once", () => {
    const out = Degradation.classify({ ...healthy, reranker_unavailable: true, milvus_unavailable: true, no_binding: true })
    expect(out.gap).toBe("no_binding")
  })
})

describe("Degradation — floor without substitution and fail-closed opt-in (AC29)", () => {
  test("catalog_lexical yields candidates; the ladder never substitutes a model", () => {
    expect(Degradation.yieldsCandidates("full_semantic")).toBe(true)
    expect(Degradation.yieldsCandidates("catalog_lexical")).toBe(true)
    expect(Degradation.yieldsCandidates("fail_closed")).toBe(false)
  })
  test("fail-closed is reached only on explicit operator opt-in", () => {
    const opted = Degradation.classify({ ...healthy, milvus_unavailable: true }, { failClosed: true })
    expect(opted.mode).toBe("fail_closed")
    expect(opted.gap).toBe("milvus_unavailable")
    // a healthy set never fail-closes even when opted in.
    expect(Degradation.classify(healthy, { failClosed: true }).mode).toBe("full_semantic")
  })
})

describe("Degradation — bounded retry on the same binding (FR26, AC29)", () => {
  test("retries target the same binding version up to the cap, then degrade", () => {
    const policy = { maxAttempts: 2 }
    const first = Degradation.nextRetry(0, policy, 5, "retrieval_timeout")
    expect(first).toEqual({ kind: "retry", attempt: 1, binding_version: 5 })
    const second = Degradation.nextRetry(1, policy, 5, "retrieval_timeout")
    expect(second).toEqual({ kind: "retry", attempt: 2, binding_version: 5 })
    const done = Degradation.nextRetry(2, policy, 5, "retrieval_timeout")
    expect(done).toEqual({ kind: "degrade", gap: "retrieval_timeout" })
  })
})
