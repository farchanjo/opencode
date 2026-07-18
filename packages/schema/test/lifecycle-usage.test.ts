import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Usage } from "../src/lifecycle/usage"

// LiveUsage: an absent token key is unavailable (never zero); provenance and
// source are closed; tokens_per_second is null unless valid.

const reportedUsage = {
  available: true,
  tokens: { input: 120, output: 48, reasoning: 16 },
  cost_usd: 0.0123,
  provenance: { provenance: "reported", source: "provider" },
  elapsed_ms: 2000,
  tokens_per_second: 32.0,
}

const unavailableUsage = {
  available: false,
  tokens: {},
  provenance: { provenance: "estimated", source: "local_estimate" },
  elapsed_ms: 0,
  tokens_per_second: null,
}

describe("Usage.LiveUsage", () => {
  test("round-trips a provider-reported usage through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Usage.LiveUsage)(reportedUsage)
    expect(Schema.encodeSync(Usage.LiveUsage)(decoded) as unknown).toEqual(reportedUsage)
  })

  test("round-trips an unavailable usage with absent token keys and no cost", () => {
    const decoded = Schema.decodeUnknownSync(Usage.LiveUsage)(unavailableUsage)
    const encoded = Schema.encodeSync(Usage.LiveUsage)(decoded) as { tokens: object }
    expect(encoded as unknown).toEqual(unavailableUsage)
    expect("input" in encoded.tokens).toBe(false)
    expect("cost_usd" in encoded).toBe(false)
  })

  test("rejects an out-of-vocabulary provenance", () => {
    expect(() =>
      Schema.decodeUnknownSync(Usage.LiveUsage)({
        ...reportedUsage,
        provenance: { provenance: "guessed", source: "provider" },
      }),
    ).toThrow()
  })

  test("rejects an out-of-vocabulary source", () => {
    expect(() =>
      Schema.decodeUnknownSync(Usage.LiveUsage)({
        ...reportedUsage,
        provenance: { provenance: "reported", source: "cache" },
      }),
    ).toThrow()
  })

  test("rejects a negative token count", () => {
    expect(() =>
      Schema.decodeUnknownSync(Usage.LiveUsage)({ ...reportedUsage, tokens: { input: -1 } }),
    ).toThrow()
  })

  test("rejects a missing available flag", () => {
    const { available: _available, ...incomplete } = reportedUsage
    expect(() => Schema.decodeUnknownSync(Usage.LiveUsage)(incomplete)).toThrow()
  })
})

describe("Usage.TokenBreakdown", () => {
  test("treats an absent key as unavailable rather than defaulting to zero", () => {
    const decoded = Schema.decodeUnknownSync(Usage.TokenBreakdown)({ input: 10 })
    expect(decoded).toEqual({ input: 10 })
    expect("output" in decoded).toBe(false)
  })
})
