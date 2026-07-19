import { describe, expect, test } from "bun:test"
import { TrustGate } from "@opencode-ai/core/mcp/trust-gate"

// Feature 008 / T021 (S13) — the trust gate: unelevated annotations are ignored for
// gating, tolerant vs strict outputSchema outcomes differ correctly, untrusted
// content is labeled, and a decompression bomb is rejected pre-delivery
// (FR13a, FR27, C5, C6, C24).

describe("TrustGate — annotation trust (FR13a, C6)", () => {
  test("annotations are trusted only under an operator-elevated profile", () => {
    expect(TrustGate.DEFAULT_TRUST_PROFILE).toBe("untrusted")
    expect(TrustGate.annotationsTrusted("untrusted")).toBe(false)
    expect(TrustGate.annotationsTrusted("elevated")).toBe(true)
  })
})

describe("TrustGate — outputSchema validation (FR12, C5)", () => {
  test("a match is valid regardless of mode", () => {
    expect(TrustGate.validateOutput("tolerant", true)).toEqual({ kind: "valid" })
    expect(TrustGate.validateOutput("strict", true)).toEqual({ kind: "valid" })
  })

  test("tolerant surfaces a non-fatal warning that still delivers", () => {
    const out = TrustGate.validateOutput("tolerant", false)
    expect(out.kind).toBe("warning")
    if (out.kind === "warning") expect(out.deliver).toBe(true)
  })

  test("strict converts a mismatch into a non-delivering isError-class failure", () => {
    const out = TrustGate.validateOutput("strict", false)
    expect(out.kind).toBe("error")
    if (out.kind === "error") expect(out.deliver).toBe(false)
  })
})

describe("TrustGate — provenance labeling (FR27, C24)", () => {
  test("server content is external, untrusted-flagged content is untrusted, elevated is trusted", () => {
    expect(TrustGate.labelProvenance({ operatorElevated: false, untrustedFlag: false })).toBe("external")
    expect(TrustGate.labelProvenance({ operatorElevated: false, untrustedFlag: true })).toBe("untrusted")
    expect(TrustGate.labelProvenance({ operatorElevated: true, untrustedFlag: true })).toBe("trusted")
  })
})

describe("TrustGate — size / decompression-bomb limits (FR27, C24)", () => {
  const limits: TrustGate.SizeLimits = { maxBytes: 10_000, maxDecompressionRatio: 100 }

  test("an in-bounds payload is accepted", () => {
    expect(TrustGate.checkSize({ decodedBytes: 5000, encodedBytes: 2000 }, limits)).toEqual({ kind: "accept" })
  })

  test("an oversized decoded payload is rejected pre-delivery", () => {
    expect(TrustGate.checkSize({ decodedBytes: 20_000, encodedBytes: 19_000 }, limits)).toMatchObject({
      kind: "reject",
      reason: "size_limit_exceeded",
    })
  })

  test("an over-ratio payload is rejected as a decompression bomb", () => {
    expect(TrustGate.checkSize({ decodedBytes: 9000, encodedBytes: 10 }, limits)).toMatchObject({
      kind: "reject",
      reason: "decompression_bomb",
    })
  })

  test("a non-empty decode from a zero-length encode is a bomb", () => {
    expect(TrustGate.checkSize({ decodedBytes: 1, encodedBytes: 0 }, limits)).toMatchObject({
      kind: "reject",
      reason: "decompression_bomb",
    })
  })
})
