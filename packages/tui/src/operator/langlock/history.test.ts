import { describe, expect, test } from "bun:test"
import type { AdvisoryRecord } from "@opencode-ai/protocol/langlock/commands"
import { deriveAdvisoryRowView } from "./history"

function advisory(overrides: Partial<AdvisoryRecord> = {}): AdvisoryRecord {
  return {
    advisoryId: "advisory_1",
    policyVersion: 2,
    pathKind: "prose_markdown",
    confidenceBucket: "high",
    detectorProvenance: "heuristic",
    state: "advisory_flagged",
    remediationStatus: "flagged",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:05:00.000Z",
    ...overrides,
  }
}

describe("langlock-panel advisory row projection (FR21, C5, C6)", () => {
  test("derives bounded, redacted fields", () => {
    const view = deriveAdvisoryRowView(advisory())
    expect(view.advisoryId).toBe("advisory_1")
    expect(view.stateText).toBe("advisory_flagged")
    expect(view.pathKindText).toBe("prose_markdown")
    expect(view.confidenceBucketText).toBe("high")
    expect(view.detectorProvenanceText).toBe("heuristic")
    expect(view.remediationStatusText).toBe("flagged")
    expect(view.policyVersionText).toBe("v2")
  })

  test("values never look like file paths or freeform prose (advisory records are content-free)", () => {
    const view = deriveAdvisoryRowView(advisory())
    for (const value of Object.values(view)) {
      expect(value.includes("/")).toBe(false)
      expect(value.includes("\n")).toBe(false)
      expect(value.includes(" ")).toBe(false)
    }
  })
})
