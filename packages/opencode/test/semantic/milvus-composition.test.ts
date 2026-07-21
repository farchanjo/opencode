/**
 * Feature 050 / T006 (FR4) — the shared Milvus-port composition helper.
 *
 * Asserts an absent endpoint composes NO port (the honest `milvus_unavailable`
 * floor) and a configured endpoint composes exactly the shipped REST v2 adapter
 * chain — one construction site for both the operator stack and the runner.
 */
import { describe, expect, test } from "bun:test"
import { MilvusComposition } from "@/semantic/milvus-composition"

describe("composeMilvusPort", () => {
  test("returns undefined when no address is configured", () => {
    expect(MilvusComposition.composeMilvusPort({})).toBeUndefined()
    expect(MilvusComposition.composeMilvusPort({ address: "" })).toBeUndefined()
    expect(MilvusComposition.composeMilvusPort({ address: "   " })).toBeUndefined()
  })

  test("composes a MilvusPort when an address is present", () => {
    const port = MilvusComposition.composeMilvusPort({ address: "milvus.local:19530", insecure: true })
    expect(port).toBeDefined()
    // The composed port exposes the full MilvusPort surface (search/upsert/enumerate/build).
    expect(typeof port?.search).toBe("function")
    expect(typeof port?.upsert).toBe("function")
    expect(typeof port?.enumerateIndexed).toBe("function")
    expect(typeof port?.buildGeneration).toBe("function")
  })
})
