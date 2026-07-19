import { describe, expect, test } from "bun:test"
import type { AdvisoryRecord, LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"
import {
  derivePolicyView,
  deriveVisibleAdvisories,
  EMPTY_LANGLOCK_PANEL_SIGNAL,
  MAX_VISIBLE_ADVISORIES,
  projectLangLockSignal,
  type LangLockPanelSignal,
} from "./state"

function policy(): LangLockPolicySummary {
  return {
    enabled: true,
    tag: "pt-BR",
    displayName: "Portuguese (Brazil)",
    scope: "project",
    origin: "project",
    policyVersion: 1,
    enforcementMode: "advisory",
    hardPolicyFloorTag: "en-US",
    overrideAuthorized: true,
    updatedAt: "2026-07-18T00:00:00.000Z",
  }
}

function advisory(id: string): AdvisoryRecord {
  return {
    advisoryId: id,
    policyVersion: 1,
    pathKind: "prose_markdown",
    confidenceBucket: "medium",
    detectorProvenance: "statistical",
    state: "compliant",
    remediationStatus: "none",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  }
}

describe("langlock-panel signal + projections (FR31, FR32, C13)", () => {
  test("the empty baseline renders no policy and no advisory history", () => {
    expect(derivePolicyView(EMPTY_LANGLOCK_PANEL_SIGNAL)).toBeNull()
    expect(deriveVisibleAdvisories(EMPTY_LANGLOCK_PANEL_SIGNAL)).toEqual([])
  })

  test("a resolved policy renders the effective policy card", () => {
    const signal: LangLockPanelSignal = { policy: policy(), advisories: [] }
    const view = derivePolicyView(signal)
    expect(view?.tagText).toBe("pt-BR")
    expect(view?.displayNameText).toBe("Portuguese (Brazil)")
    expect(view?.scopeText).toBe("project")
    expect(view?.originText).toBe("project")
  })

  test("the visible advisory count is bounded", () => {
    const advisories = Array.from({ length: MAX_VISIBLE_ADVISORIES + 10 }, (_, i) => advisory(`advisory_${i}`))
    const signal: LangLockPanelSignal = { policy: null, advisories }
    expect(deriveVisibleAdvisories(signal).length).toBe(MAX_VISIBLE_ADVISORIES)
  })

  test("advisory order is preserved", () => {
    const signal: LangLockPanelSignal = { policy: null, advisories: [advisory("a1"), advisory("a2")] }
    expect(deriveVisibleAdvisories(signal).map((v) => v.advisoryId)).toEqual(["a1", "a2"])
  })
})

describe("projectLangLockSignal — total structured-result projection (Feature 012 T004, FR4, FR8)", () => {
  test("a valid langlock.status effective policy projects (projected)", () => {
    const result = projectLangLockSignal(policy())
    expect(result.outcome).toBe("projected")
    expect(result.signal.policy?.tag).toBe("pt-BR")
    expect(result.signal.advisories).toEqual([])
  })

  test("a { policy, advisories } combined effective projects both sections", () => {
    const result = projectLangLockSignal({ policy: policy(), advisories: [advisory("a1"), advisory("a2")] })
    expect(result.outcome).toBe("projected")
    expect(result.signal.advisories.map((a) => a.advisoryId)).toEqual(["a1", "a2"])
  })

  test("an absent effective degrades to the honest empty baseline (empty_fallback)", () => {
    for (const absent of [undefined, null]) {
      const result = projectLangLockSignal(absent)
      expect(result.outcome).toBe("empty_fallback")
      expect(result.signal).toBe(EMPTY_LANGLOCK_PANEL_SIGNAL)
    }
  })

  test("a malformed effective degrades to the honest empty baseline without throwing (shape_mismatch)", () => {
    for (const bad of [42, "policy", [], { tag: "pt-BR" }, { policy: { tag: 1 } }]) {
      const result = projectLangLockSignal(bad)
      expect(result.outcome).toBe("shape_mismatch")
      expect(result.signal).toBe(EMPTY_LANGLOCK_PANEL_SIGNAL)
    }
  })
})
