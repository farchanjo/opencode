import { describe, expect, test } from "bun:test"
import { AdvisoryDetector } from "@opencode-ai/core/langlock/advisory-detector"

// Feature 004 / T037 (S20) — pure deterministic advisory-detector tests (FR16,
// FR21, C5, C6, AC8, AC11). Zero I/O: the detector is injected. Detection is
// observation only — every outcome is non-blocking. A detector that returns null
// or throws is absorbed as `unknown`; a non-eligible kind short-circuits to
// `not_eligible` without calling the detector. No translation-model call.

const portFrom = (signal: AdvisoryDetector.DetectorSignal | null): AdvisoryDetector.DetectorPort => ({
  detect: () => signal,
})

const throwingPort: AdvisoryDetector.DetectorPort = {
  detect: () => {
    throw new Error("detector down")
  },
}

const req = (
  overrides: Partial<AdvisoryDetector.DetectorRequest> = {},
): AdvisoryDetector.DetectorRequest => ({
  path_kind: "prose_markdown",
  expected_tag: "en-US",
  ...overrides,
})

describe("AdvisoryDetector.detectAdvisory — not_eligible short-circuit (FR20, AC11)", () => {
  test("a generic_code kind is not_eligible and the detector is never called", () => {
    let called = false
    const port: AdvisoryDetector.DetectorPort = {
      detect: () => {
        called = true
        return null
      },
    }
    const outcome = AdvisoryDetector.detectAdvisory(req({ path_kind: "generic_code" }), port)
    expect(outcome.kind).toBe("not_eligible")
    expect(called).toBe(false)
  })
})

describe("AdvisoryDetector.detectAdvisory — compliant on match", () => {
  test("a matching detected tag is compliant", () => {
    const outcome = AdvisoryDetector.detectAdvisory(
      req(),
      portFrom({ detected_tag: "en-US", confidence: "high", provenance: "heuristic" }),
    )
    expect(outcome.kind).toBe("compliant")
  })
})

describe("AdvisoryDetector.detectAdvisory — flagged on mismatch (AC8)", () => {
  test("a mismatch at or above the minimum confidence is flagged", () => {
    const outcome = AdvisoryDetector.detectAdvisory(
      req(),
      portFrom({ detected_tag: "pt-BR", confidence: "high", provenance: "statistical" }),
    )
    expect(outcome.kind).toBe("flagged")
    if (outcome.kind !== "flagged") throw new Error("expected flagged")
    expect(outcome.detected_tag).toBe("pt-BR")
    expect(outcome.confidence).toBe("high")
  })

  test("a mismatch below the minimum confidence is not flagged — it is unknown", () => {
    const outcome = AdvisoryDetector.detectAdvisory(
      req(),
      portFrom({ detected_tag: "pt-BR", confidence: "low", provenance: "heuristic" }),
    )
    expect(outcome.kind).toBe("unknown")
  })
})

describe("AdvisoryDetector.detectAdvisory — unknown never blocks (FR21)", () => {
  test("a null signal is absorbed as unknown", () => {
    const outcome = AdvisoryDetector.detectAdvisory(req(), portFrom(null))
    expect(outcome.kind).toBe("unknown")
  })

  test("a throwing detector is absorbed as unknown (never re-thrown)", () => {
    const outcome = AdvisoryDetector.detectAdvisory(req(), throwingPort)
    expect(outcome.kind).toBe("unknown")
  })

  test("an unknown-bucket signal is unknown regardless of a detected tag", () => {
    const outcome = AdvisoryDetector.detectAdvisory(
      req(),
      portFrom({ detected_tag: "pt-BR", confidence: "unknown", provenance: "none" }),
    )
    expect(outcome.kind).toBe("unknown")
  })

  test("the default minimum confidence is medium", () => {
    expect(AdvisoryDetector.DEFAULT_ADVISORY_MIN_CONFIDENCE).toBe("medium")
  })
})
