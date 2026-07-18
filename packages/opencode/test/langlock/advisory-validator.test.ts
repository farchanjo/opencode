/**
 * Feature 004 / T039 (S20) — post-write advisory validation on classified prose
 * (FR8, FR20, FR21, C5, C6, AC8, AC11, AC20). Advisory detection runs only on
 * confidently classified, model-authored prose; it records a content-free outcome,
 * NEVER gates the write (`blocked` is always false), and generic source code /
 * exempt / untouched content is never a detection target.
 */
import { describe, expect, test } from "bun:test"
import { LangLockAdvisoryValidator } from "@/langlock/advisory-validator"
import type { AdvisoryDetector } from "@opencode-ai/core/langlock/advisory-detector"

const portFrom = (signal: AdvisoryDetector.DetectorSignal | null): AdvisoryDetector.DetectorPort => ({
  detect: () => signal,
})

const input = (
  overrides: Partial<LangLockAdvisoryValidator.AdvisoryValidateInput> = {},
): LangLockAdvisoryValidator.AdvisoryValidateInput => ({
  extension: "md",
  modelAuthored: true,
  expectedTag: "en-US",
  policyVersion: 3,
  ...overrides,
})

describe("T039 advisory validator — flagged without blocking (FR20, C6, AC8)", () => {
  test("a confident language mismatch on prose is flagged and never blocks the write", () => {
    const result = LangLockAdvisoryValidator.validateAdvisory(
      input(),
      portFrom({ detected_tag: "pt-BR", confidence: "high", provenance: "statistical" }),
    )
    expect(result.outcome).toBe("flagged")
    expect(result.remediation).toBe("flagged")
    expect(result.blocked).toBe(false)
    expect(result.policyVersion).toBe(3)
  })

  test("a matching language is compliant and non-blocking", () => {
    const result = LangLockAdvisoryValidator.validateAdvisory(
      input(),
      portFrom({ detected_tag: "en-US", confidence: "high", provenance: "heuristic" }),
    )
    expect(result.outcome).toBe("compliant")
    expect(result.blocked).toBe(false)
  })
})

describe("T039 advisory validator — non-targets are never flagged (FR20, AC11, AC20)", () => {
  test("generic source code is not_eligible and the detector is never consulted", () => {
    let called = false
    const port: AdvisoryDetector.DetectorPort = {
      detect: () => {
        called = true
        return { detected_tag: "pt-BR", confidence: "high", provenance: "statistical" }
      },
    }
    const result = LangLockAdvisoryValidator.validateAdvisory(input({ extension: "ts" }), port)
    expect(result.outcome).toBe("not_eligible")
    expect(result.pathKind).toBe("generic_code")
    expect(result.blocked).toBe(false)
    expect(called).toBe(false)
  })

  test("untouched (non-model-authored) content is never a detection target (AC20)", () => {
    const result = LangLockAdvisoryValidator.validateAdvisory(input({ modelAuthored: false }), portFrom(null))
    expect(result.outcome).toBe("not_eligible")
  })

  test("an operator-exempt prose target is excluded", () => {
    const result = LangLockAdvisoryValidator.validateAdvisory(input({ isExempt: true }), portFrom(null))
    expect(result.outcome).toBe("not_eligible")
    expect(result.pathKind).toBe("exempt")
  })
})

describe("T039 advisory validator — detector failure never blocks (FR21)", () => {
  test("a null detector signal on eligible prose is unknown, never blocking", () => {
    const result = LangLockAdvisoryValidator.validateAdvisory(input(), portFrom(null))
    expect(result.outcome).toBe("unknown")
    expect(result.blocked).toBe(false)
  })
})
