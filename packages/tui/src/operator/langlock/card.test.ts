import { describe, expect, test } from "bun:test"
import type { LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"
import { derivePolicyCardView } from "./card"

function policy(overrides: Partial<LangLockPolicySummary> = {}): LangLockPolicySummary {
  return {
    enabled: true,
    tag: "en-US",
    displayName: "English (United States)",
    scope: "project",
    origin: "global",
    policyVersion: 4,
    enforcementMode: "advisory",
    hardPolicyFloorTag: "en-US",
    overrideAuthorized: false,
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  }
}

describe("langlock-panel policy card projection (FR31, FR32, C13)", () => {
  test("derives text-first fields, never color-only", () => {
    const view = derivePolicyCardView(policy())
    expect(view.tagText).toBe("en-US")
    expect(view.displayNameText).toBe("English (United States)")
    expect(view.enabledText).toBe("enabled")
    expect(view.scopeText).toBe("project")
    expect(view.originText).toBe("global")
    expect(view.enforcementModeText).toBe("advisory")
    expect(view.policyVersionText).toBe("v4")
    expect(view.hardPolicyFloorText).toBe("en-US")
    expect(view.overrideAuthorizedText).toBe("not authorized")
    expect(view.updatedAtText).toBe("2026-07-18T00:00:00.000Z")
  })

  test("a disabled, override-authorized policy surfaces both states textually", () => {
    const view = derivePolicyCardView(policy({ enabled: false, overrideAuthorized: true }))
    expect(view.enabledText).toBe("disabled")
    expect(view.overrideAuthorizedText).toBe("authorized")
  })
})
