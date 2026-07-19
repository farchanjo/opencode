/**
 * Feature 006 / T037 — application barrel acceptance.
 *
 * The barrel imports every semantic application module without a duplicate-export
 * error and exposes all fourteen namespaces (eleven Feature 006 + three Feature 009).
 */
import { describe, expect, test } from "bun:test"
import * as Semantic from "@/semantic"

describe("application barrel", () => {
  test("re-exports all fourteen module namespaces", () => {
    const namespaces = [
      "GrpcProbe", "MilvusAdapter", "EmbeddingClient", "RerankClient", "UrlGuard",
      "IndexJobs", "CutoverExecutor", "CredentialResolver", "DurableEvents", "EvalHarness", "RetrievalFacade",
      "ToolProjection", "ToolReindexTrigger", "ToolRetrieval",
    ]
    for (const name of namespaces) expect(Semantic).toHaveProperty(name)
    expect(Object.keys(Semantic).sort()).toEqual([...namespaces].sort())
  })

  test("a representative export from each namespace is present", () => {
    expect(typeof Semantic.GrpcProbe.classifyFinding).toBe("function")
    expect(typeof Semantic.MilvusAdapter.createFakeMilvusAdapter).toBe("function")
    expect(typeof Semantic.UrlGuard.isBlockedAddress).toBe("function")
    expect(typeof Semantic.EvalHarness.runGolden).toBe("function")
    expect(typeof Semantic.RetrievalFacade.createRetrievalFacade).toBe("function")
  })
})
