import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { Schema } from "effect"
import { Enums } from "../../src/semantic/enums"
import { EnumsState } from "../../src/semantic/enums-state"
import { EventTypes } from "../../src/semantic/event-types"
import { EventDefinitions } from "../../src/semantic/event-definitions"
import { Values } from "../../src/semantic/values"
import { ProviderProfile } from "../../src/semantic/provider-profile"
import { Documents } from "../../src/semantic/documents"
import { Events } from "../../src/semantic/events"

/**
 * Feature 006 / T041 (S25) — schema contract parity against the CUE authority.
 *
 * Pins the schema modules directly against the `doc/arch/schemas/semantic/*.cue`
 * corpus (the wire-shape authority): the closed 12-member `semantic.*` vocabulary
 * with the 9-durable/3-live split, the reconciled enums (RerankProfile 3,
 * CapabilityKind 4, DegradationGap 8, BindingState/GenerationState 5), the
 * real-valued score domain versus the integer counters, the SSOT aggregates
 * embedding no secret, and envelope/document redaction (no query/vector/prompt/
 * path/secret) (FR17, FR22, FR28, FR42, C7, C16, C20, C22, AC15).
 */

const cue = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../doc/arch/schemas/semantic/${name}`, import.meta.url)), "utf8")

/** Parse the quoted string members of a CUE disjunction `#Name: "a" | "b" | ...`. */
function cueEnumMembers(file: string, defName: string): string[] {
  const src = cue(file)
  const match = src.match(new RegExp(`${defName}:\\s*("[^\\n]+)`))
  if (!match) throw new Error(`CUE def ${defName} not found in ${file}`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

const literalMembers = (schema: { readonly ast: unknown }): string[] => {
  const ast = schema.ast as { readonly types?: ReadonlyArray<{ readonly literal?: unknown }> }
  return (ast.types ?? []).map((t) => String(t.literal))
}

const asSet = (v: Iterable<string>) => new Set(v)

describe("T041 CUE enum parity — schema mirrors doc/arch/schemas/semantic/*.cue", () => {
  test("RerankProfile matches enums.cue #RerankProfile (hyphen-spelled 3-member)", () => {
    expect(asSet(literalMembers(Enums.RerankProfile))).toEqual(asSet(cueEnumMembers("enums.cue", "#RerankProfile")))
  })

  test("CapabilityKind matches enums.cue #CapabilityKind (4-member, embedding-similarity distinct)", () => {
    const schema = literalMembers(Enums.CapabilityKind)
    expect(asSet(schema)).toEqual(asSet(cueEnumMembers("enums.cue", "#CapabilityKind")))
    expect(schema).toContain("embedding-similarity")
    expect(schema.indexOf("embedding-similarity")).not.toBe(schema.indexOf("reranker"))
  })

  test("DegradationGap matches enums-state.cue #DegradationGap (8-member)", () => {
    const schema = literalMembers(EnumsState.DegradationGap)
    expect(asSet(schema)).toEqual(asSet(cueEnumMembers("enums-state.cue", "#DegradationGap")))
    expect(schema.length).toBe(8)
  })

  test("BindingState/GenerationState match enums-state.cue (5-member lifecycles)", () => {
    expect(asSet(literalMembers(EnumsState.BindingState))).toEqual(asSet(cueEnumMembers("enums-state.cue", "#BindingState")))
    expect(asSet(literalMembers(EnumsState.GenerationState))).toEqual(asSet(cueEnumMembers("enums-state.cue", "#GenerationState")))
  })
})

describe("T041 vocabulary — closed 12-member semantic.* with 9 durable / 3 live", () => {
  test("the schema vocabulary is the closed 12-member set and matches event-types.cue", () => {
    const schema = literalMembers(EventTypes.SemanticEventType)
    expect(schema.length).toBe(12)
    const cueMembers = [...cue("event-types.cue").matchAll(/"(semantic\.[a-z_]+)"/g)].map((m) => m[1])
    expect(asSet(schema)).toEqual(asSet(cueMembers))
  })

  test("exactly nine definitions are durable and three are live, disjoint and underscore-named", () => {
    expect(EventDefinitions.DurableDefinitions.length).toBe(9)
    expect(EventDefinitions.LiveDefinitions.length).toBe(3)
    const durable = EventDefinitions.DurableDefinitions.map((d) => d.type)
    const live = EventDefinitions.LiveDefinitions.map((d) => d.type)
    expect(durable.filter((t) => live.includes(t))).toEqual([])
    for (const t of [...durable, ...live]) expect(t.slice("semantic.".length)).not.toContain(".")
  })
})

describe("T041 score domain — real-valued components vs integer counters", () => {
  test("counters/dimensions are integer-checked while scores are continuous", () => {
    for (const counter of [Values.BindingVersion, Values.Dimension, Values.TopK]) {
      expect(() => Schema.decodeUnknownSync(counter)(2.5)).toThrow()
    }
    for (const score of [Values.Score, Values.RerankScore, Values.DenseScore, Values.SparseScore]) {
      expect(() => Schema.decodeUnknownSync(score)(0.42)).not.toThrow()
    }
  })

  test("Confidence is bounded to [0,1]", () => {
    expect(Schema.decodeUnknownSync(Values.Confidence)(1)).toBe(1)
    expect(() => Schema.decodeUnknownSync(Values.Confidence)(1.01)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.Confidence)(-0.01)).toThrow()
  })
})

describe("T041 redaction — SSOT and envelope/document carry no secret/path", () => {
  test("provider credentials expose only an opaque nullable secret_ref", () => {
    const fields = Object.keys(ProviderProfile.ProviderCredentials.fields)
    expect(fields).toEqual(["secret_ref", "headers"])
    for (const forbidden of ["secret", "token", "api_key", "password"]) expect(fields).not.toContain(forbidden)
  })

  test("SkillChunkDoc carries a body ref, never an inline body or path field", () => {
    const fields = Object.keys(Documents.SkillChunkDoc.fields)
    expect(fields).not.toContain("body")
    expect(fields).not.toContain("path")
  })

  test("a durable event Struct is (type, envelope, detail) — content rides only redacted_metadata", () => {
    expect(Object.keys(Events.SemanticBindingCutoverEvent.fields)).toEqual(["type", "envelope", "detail"])
  })
})
