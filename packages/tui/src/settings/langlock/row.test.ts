import { describe, expect, test } from "bun:test"
import type { LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"
import {
  deriveAllowlistOptions,
  deriveLangLockSettingsRow,
  EMPTY_LANGLOCK_SETTINGS_ROW,
  SETTINGS_ROW_LABEL,
} from "./row"

function policy(overrides: Partial<LangLockPolicySummary> = {}): LangLockPolicySummary {
  return {
    enabled: true,
    tag: "pt-BR",
    displayName: "Portuguese (Brazil)",
    scope: "project",
    origin: "global",
    policyVersion: 1,
    enforcementMode: "advisory",
    hardPolicyFloorTag: "en-US",
    overrideAuthorized: false,
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  }
}

describe("langlock settings row projection (FR31, FR4, C13)", () => {
  test("renders human/native display names and stores the canonical tag", () => {
    const view = deriveLangLockSettingsRow(policy())
    expect(view.labelText).toBe(SETTINGS_ROW_LABEL)
    expect(view.valueText).toBe("Portuguese (Brazil) / Português (Brasil)")
    expect(view.canonicalTag).toBe("pt-BR")
    expect(view.enabledText).toBe("enabled")
    expect(view.scopeText).toBe("project")
    expect(view.originText).toBe("global")
  })

  test("never renders the canonical tag as the sole primary value", () => {
    const view = deriveLangLockSettingsRow(policy())
    expect(view.valueText).not.toBe(view.canonicalTag)
  })

  test("collapses to a single name when the human and native display names match", () => {
    const view = deriveLangLockSettingsRow(policy({ tag: "en-US", displayName: "English (United States)" }))
    expect(view.valueText).toBe("English (United States)")
  })

  test("the empty baseline is an honest not-configured state, never a fabricated tag", () => {
    expect(EMPTY_LANGLOCK_SETTINGS_ROW.labelText).toBe(SETTINGS_ROW_LABEL)
    expect(EMPTY_LANGLOCK_SETTINGS_ROW.canonicalTag).toBe("")
    expect(EMPTY_LANGLOCK_SETTINGS_ROW.valueText).toBe("not configured")
  })

  test("the allowlist picker options are the closed 8-entry set, titled by human name only", () => {
    const options = deriveAllowlistOptions()
    expect(options.length).toBe(8)
    expect(options.map((o) => o.tag)).toContain("en-US")
    const ptBr = options.find((o) => o.tag === "pt-BR")
    expect(ptBr?.titleText).toBe("Portuguese (Brazil)")
    expect(ptBr?.descriptionText).toBe("Português (Brasil) · pt-BR")
  })
})
