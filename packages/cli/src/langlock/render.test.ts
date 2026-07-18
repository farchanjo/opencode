import { describe, expect, test } from "bun:test"
import { renderMutation, renderPolicy } from "./render"

const policy = {
  enabled: true,
  tag: "en-US",
  displayName: "English (United States)",
  scope: "project",
  origin: "global",
  policyVersion: 3,
  enforcementMode: "advisory",
  hardPolicyFloorTag: "en-US",
  overrideAuthorized: false,
  updatedAt: "2026-07-18T00:00:00.000Z",
}

describe("langlock renderers", () => {
  test("renders the effective policy with human/native display name, never the tag alone", () => {
    const out = renderPolicy(policy)
    expect(out).toContain("langlock: en-US (English (United States))")
    expect(out).toContain("enabled: yes")
    expect(out).toContain("scope: project  origin: global")
    expect(out).toContain("enforcement: advisory")
    expect(out).toContain("policy version: 3")
    expect(out).toContain("hard floor: en-US")
    expect(out).toContain("override authorized: no")
    expect(out).toContain("updated: 2026-07-18T00:00:00.000Z")
  })

  test("renders a set/reset mutation with the audit id", () => {
    const out = renderMutation({ policy, auditId: "audit-123" })
    expect(out).toContain("langlock: en-US (English (United States))")
    expect(out).toContain("audit id: audit-123")
  })

  test("renderers fall back to JSON for an unexpected payload", () => {
    expect(renderPolicy(42)).toBe("42")
    expect(renderMutation({})).toBe(JSON.stringify({}, null, 2))
  })
})
