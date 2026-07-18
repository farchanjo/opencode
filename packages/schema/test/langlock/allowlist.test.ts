import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Allowlist } from "../../src/langlock/allowlist"

// Feature 004 / T038 (S20) — the allowlist eight-entry shape (FR3, FR4, C13, AC3,
// AC16). Mirrors doc/arch/schemas/langlock/allowlist.cue. Each entry pairs a
// canonical tag with a human and native display name; en-US is the enabled default
// artifact language. The canonical tag is stored and validated, never surfaced as
// the primary picker label.

describe("Allowlist.INITIAL_ALLOWLIST — eight canonical entries (FR3, AC3)", () => {
  test("carries exactly the eight initial allowlisted tags", () => {
    expect(Allowlist.INITIAL_ALLOWLIST.map((e) => e.tag).sort()).toEqual(
      ["en-AU", "en-CA", "en-GB", "en-US", "es-AR", "es-ES", "es-MX", "pt-BR"].sort(),
    )
  })

  test("every entry carries a non-empty human and native display name", () => {
    for (const entry of Allowlist.INITIAL_ALLOWLIST) {
      expect(entry.display_name.length).toBeGreaterThan(0)
      expect(entry.native_name.length).toBeGreaterThan(0)
    }
  })

  test("the native name is the localized form for a non-English tag (FR4, C13)", () => {
    const ptBR = Allowlist.INITIAL_ALLOWLIST.find((e) => e.tag === "pt-BR")
    expect(ptBR?.native_name).toBe("Português (Brasil)")
    const esMX = Allowlist.INITIAL_ALLOWLIST.find((e) => e.tag === "es-MX")
    expect(esMX?.native_name).toBe("Español (México)")
  })
})

describe("Allowlist.DefaultTag — en-US enabled default (FR1, AC16)", () => {
  test("the default artifact language is en-US", () => {
    expect(Schema.decodeUnknownSync(Allowlist.DefaultTag)("en-US")).toBe("en-US")
    expect(() => Schema.decodeUnknownSync(Allowlist.DefaultTag)("pt-BR")).toThrow()
  })
})

describe("Allowlist.AllowlistEntry — round-trips a canonical entry", () => {
  test("decodes and re-encodes an allowlist entry unchanged", () => {
    const entry = { tag: "en-US", display_name: "English (United States)", native_name: "English (United States)" }
    const decoded = Schema.decodeUnknownSync(Allowlist.AllowlistEntry)(entry)
    expect(Schema.encodeSync(Allowlist.AllowlistEntry)(decoded) as unknown).toEqual(entry)
  })

  test("the AllowlistArray decodes the full initial corpus", () => {
    const decoded = Schema.decodeUnknownSync(Allowlist.AllowlistArray)(Allowlist.INITIAL_ALLOWLIST)
    expect(decoded.length).toBe(8)
  })
})
