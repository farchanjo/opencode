import { describe, expect, test } from "bun:test"
import { TagValidation } from "@opencode-ai/core/langlock/tag-validation"

// Feature 004 / T037 (S20) — pure deterministic tag-validation tests (FR4,
// Security 2, C13, AC3, AC16). Zero I/O: the allowlist is injected. A candidate
// is accepted only when it is already in canonical BCP 47 form AND present in the
// allowlist; the canonical tag is NEVER surfaced as the primary picker label —
// the display/native names are (FR4, C13).

const allowlist = TagValidation.createAllowlistPort()

describe("TagValidation.validateTag — canonical accept (FR4, AC3)", () => {
  test("accepts a canonical, allowlisted tag and returns its human/native names", () => {
    const result = TagValidation.validateTag("pt-BR", allowlist)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected accept")
    expect(result.tag).toBe("pt-BR")
    expect(result.displayName).toBe("Portuguese (Brazil)")
    expect(result.nativeName).toBe("Português (Brasil)")
  })

  test("accepts the default en-US artifact language (FR1, AC16)", () => {
    const result = TagValidation.validateTag("en-US", allowlist)
    expect(result.ok).toBe(true)
  })

  test("the primary label is never the technical tag — display names are surfaced (FR4, C13)", () => {
    const result = TagValidation.validateTag("es-MX", allowlist)
    if (!result.ok) throw new Error("expected accept")
    expect(result.displayName).not.toBe(result.tag)
    expect(result.nativeName).not.toBe(result.tag)
  })
})

describe("TagValidation.validateTag — rejection reasons (FR4, Security 2, C13)", () => {
  test("rejects a non-canonical tag (lower-cased region) as non_canonical", () => {
    const result = TagValidation.validateTag("en-us", allowlist)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.reason).toBe("non_canonical")
  })

  test("rejects a structurally invalid candidate as non_canonical", () => {
    const result = TagValidation.validateTag("!!!", allowlist)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.reason).toBe("non_canonical")
  })

  test("rejects a canonical but non-allowlisted tag as not_allowlisted", () => {
    const result = TagValidation.validateTag("fr-FR", allowlist)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.reason).toBe("not_allowlisted")
  })
})

describe("TagValidation.displayFor — display-name mapping (FR4, C13, AC3)", () => {
  test("maps an allowlisted tag to its human/native names", () => {
    expect(TagValidation.displayFor("es-ES", allowlist)).toEqual({
      displayName: "Spanish (Spain)",
      nativeName: "Español (España)",
    })
  })

  test("returns null for a non-allowlisted tag", () => {
    expect(TagValidation.displayFor("de-DE", allowlist)).toBeNull()
  })
})

describe("TagValidation.createAllowlistPort — the eight initial entries (FR3)", () => {
  test("exposes all eight initial allowlisted tags", () => {
    for (const tag of ["en-US", "en-CA", "en-GB", "en-AU", "pt-BR", "es-ES", "es-MX", "es-AR"]) {
      expect(TagValidation.validateTag(tag, allowlist).ok).toBe(true)
    }
  })
})
