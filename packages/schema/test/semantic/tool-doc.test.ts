import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EnumsState } from "../../src/semantic/enums-state"
import { Documents } from "../../src/semantic/documents"
import { ToolDoc, ToolDescriptor, ToolParameter, ToolParameterProjection } from "../../src/semantic/tool-doc"

/**
 * Feature 009 / T014 (S13) — the schema tool-doc contract vs the CUE authority.
 *
 * Pins the closed 4-member `ToolSource`, the sanitized `JsonSchemaType`, the
 * `ToolDoc` entity composing the reused `DocIdentity` / `DocScope` /
 * `DocAvailability` shared parts, and the redaction invariant: no
 * `default`/`example`/`const`/`format`/path/secret field ever survives the
 * projection (FR6, FR7, C6, C13, AC18).
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

const FORBIDDEN_FIELDS = ["default", "example", "examples", "const", "format", "pattern", "path", "secret", "token"]

describe("T014 tool enums — closed literals mirroring enums-tool.cue", () => {
  test("ToolSource is the closed 4-member literal (native|mcp|custom|plugin)", () => {
    const members = literalMembers(EnumsState.ToolSource)
    expect(members.length).toBe(4)
    expect(asSet(members)).toEqual(asSet(cueEnumMembers("enums-tool.cue", "#ToolSource")))
    expect(asSet(members)).toEqual(asSet(["native", "mcp", "custom", "plugin"]))
  })

  test("JsonSchemaType keeps only bounded types, never a value or a format", () => {
    const members = literalMembers(EnumsState.JsonSchemaType)
    expect(asSet(members)).toEqual(asSet(cueEnumMembers("enums-tool.cue", "#JsonSchemaType")))
    expect(members).not.toContain("format")
    expect(members).not.toContain("default")
  })

  test("ToolRetrievalMode carries the full_set_passthrough floor and stays distinct from RetrievalMode", () => {
    const tool = literalMembers(EnumsState.ToolRetrievalMode)
    expect(tool).toContain("full_set_passthrough")
    expect(tool).not.toContain("catalog_lexical")
    const agent = literalMembers(EnumsState.RetrievalMode)
    expect(asSet(tool)).not.toEqual(asSet(agent))
  })
})

describe("T014 ToolDoc composition + redaction (FR6, FR7, C6, C13, AC18)", () => {
  test("ToolDoc is a 7-field entity composing the reused shared parts (id + identity + descriptor + parameters + scope + language + availability)", () => {
    expect(Object.keys(ToolDoc.fields)).toEqual([
      "id",
      "identity",
      "descriptor",
      "parameters",
      "scope",
      "language",
      "availability",
    ])
    // The three shared parts are the SAME shapes as documents.ts (never redefined).
    expect(ToolDoc.fields.identity).toBe(Documents.DocIdentity)
    expect(ToolDoc.fields.scope).toBe(Documents.DocScope)
    expect(ToolDoc.fields.availability).toBe(Documents.DocAvailability)
  })

  test("no ToolDoc field is a default/example/const/format/path/secret", () => {
    for (const forbidden of FORBIDDEN_FIELDS) expect(Object.keys(ToolDoc.fields)).not.toContain(forbidden)
  })

  test("the sanitized parameter projection keeps only name/type/description + a truncated flag", () => {
    expect(Object.keys(ToolParameter.fields)).toEqual(["name", "type", "description"])
    for (const forbidden of FORBIDDEN_FIELDS) expect(Object.keys(ToolParameter.fields)).not.toContain(forbidden)
    expect(Object.keys(ToolParameterProjection.fields)).toEqual(["parameters", "truncated"])
  })

  test("the descriptor carries the scalar scope via DocScope and the Feature 004 language tag", () => {
    expect(Object.keys(ToolDescriptor.fields)).toEqual(["name", "source", "server_ref", "description"])
    expect(Object.keys(Documents.DocScope.fields)).toContain("project_id")
    expect(Object.keys(Documents.DocScope.fields)).toContain("permission_ref")
  })
})
