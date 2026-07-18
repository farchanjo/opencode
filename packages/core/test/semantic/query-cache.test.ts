import { describe, expect, test } from "bun:test"
import { QueryCache } from "@opencode-ai/core/semantic/query-cache"

// Feature 006 / T020 (S11) — the once-per-Task query-embedding cache: one embed
// per fingerprint reused across passes, invalidation on binding-version or
// config-hash change, and no re-embed per token (FR18, FR25, C10, AC16).

const key = (over: Partial<QueryCache.CacheKey> = {}): QueryCache.CacheKey => ({
  fingerprint: "fp-1",
  binding_version: 1,
  config_hash: "cfg-1",
  ...over,
})

describe("QueryCache — reuse across passes (AC16)", () => {
  test("one embed per fingerprint, reused across the agent and skill passes", () => {
    const cache = QueryCache.create<number[]>()
    let embeds = 0
    const compute = () => {
      embeds += 1
      return [0.1, 0.2]
    }
    const agentPass = cache.resolve(key(), compute)
    const skillPass = cache.resolve(key(), compute)
    const thirdPass = cache.resolve(key(), compute)
    expect(embeds).toBe(1)
    expect(agentPass.hit).toBe(false)
    expect(skillPass.hit).toBe(true)
    expect(thirdPass.hit).toBe(true)
    expect(skillPass.value).toBe(agentPass.value)
  })
})

describe("QueryCache — invalidation (FR25, C10)", () => {
  test("a binding-version change forces exactly one re-embed", () => {
    const cache = QueryCache.create<string>()
    let embeds = 0
    const compute = () => `e${(embeds += 1)}`
    cache.resolve(key({ binding_version: 1 }), compute)
    const after = cache.resolve(key({ binding_version: 2 }), compute)
    expect(after.hit).toBe(false)
    expect(embeds).toBe(2)
  })
  test("a config-hash change forces exactly one re-embed", () => {
    const cache = QueryCache.create<string>()
    let embeds = 0
    const compute = () => `e${(embeds += 1)}`
    cache.resolve(key({ config_hash: "cfg-1" }), compute)
    const after = cache.resolve(key({ config_hash: "cfg-2" }), compute)
    expect(after.hit).toBe(false)
    expect(embeds).toBe(2)
  })
  test("keyOf projects a schema QueryFingerprint one-to-one", () => {
    const projected = QueryCache.keyOf({ fingerprint: "fp", binding_version: 3, config_hash: "h" } as never)
    expect(projected).toEqual({ fingerprint: "fp", binding_version: 3, config_hash: "h" })
  })
})
