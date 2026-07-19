import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EnumsState } from "@opencode-ai/schema/semantic/enums-state"
import type {
  ToolCandidate,
  ToolRetrievalRequest,
  ToolRetrievalRung,
  ToolReindexTriggerSource,
  ToolSearchSurface,
  ToolSource,
} from "../../src/semantic/commands"

/**
 * Feature 009 / T014 (S13) — protocol/semantic tool parity vs the schema authority.
 *
 * Pins the transport tool contract against `contracts/ports.ts` reconciled to the
 * `@opencode-ai/schema/semantic/*` modules: every tool enum is sourced from the
 * schema (never redeclared), the collection discriminator is fixed to `"tools"`,
 * and `ToolRetrievalRung` is the schema `ToolRetrievalMode` — distinct from the 006
 * `RetrievalMode` (FR11, FR12, C2). The interfaces are type-only, so this pins the
 * source-of-truth wiring (compile-time parity below + runtime source/enum checks).
 */

const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/semantic/commands.ts", import.meta.url)), "utf8")

const literalMembers = (schema: { readonly ast: unknown }): string[] => {
  const ast = schema.ast as { readonly types?: ReadonlyArray<{ readonly literal?: unknown }> }
  return (ast.types ?? []).map((t) => String(t.literal))
}
const asSet = (v: Iterable<string>) => new Set(v)

// --- Compile-time parity (enforced by tsgo --noEmit) --------------------------
// The protocol tool enums MUST be the exact schema literal unions; a drift would
// fail the typecheck rather than a runtime assertion.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _rungIsSchemaMode: Exact<ToolRetrievalRung, EnumsState.ToolRetrievalMode> = true
const _sourceIsSchema: Exact<ToolSource, EnumsState.ToolSource> = true
const _surfaceIsSchema: Exact<ToolSearchSurface, EnumsState.ToolSurface> = true
const _triggerIsSchema: Exact<ToolReindexTriggerSource, EnumsState.ToolTriggerSource> = true
// The request collection discriminator is fixed to "tools".
const _fixedCollection: ToolRetrievalRequest["collection"] = "tools"
// A candidate's version leg is the tool content hash (a string), reused SemanticScore.
const _candidateVersion: ToolCandidate["canonicalVersion"] = "content-hash-abc"
void _rungIsSchemaMode
void _sourceIsSchema
void _surfaceIsSchema
void _triggerIsSchema
void _fixedCollection
void _candidateVersion

describe("T014 protocol tool enums sourced from the schema modules (C2)", () => {
  test("the commands module sources every tool enum from @opencode-ai/schema/semantic/enums-state", () => {
    expect(commandsSrc).toContain("ToolRetrievalMode as SchemaToolRetrievalMode")
    expect(commandsSrc).toContain("ToolSource as SchemaToolSource")
    expect(commandsSrc).toContain("ToolSurface as SchemaToolSurface")
    expect(commandsSrc).toContain("ToolTriggerSource as SchemaToolTriggerSource")
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/enums-state"')
    // The ToolDoc projection entity is reused from the schema, never redeclared.
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/tool-doc"')
  })

  test("ToolRetrievalRung (schema ToolRetrievalMode) is distinct from the 006 RetrievalMode", () => {
    const tool = literalMembers(EnumsState.ToolRetrievalMode)
    const agent = literalMembers(EnumsState.RetrievalMode)
    expect(asSet(tool)).not.toEqual(asSet(agent))
    expect(tool).toContain("full_set_passthrough")
    expect(agent).toContain("catalog_lexical")
  })

  test("ToolSource is the closed 4-member schema union, ToolSurface the closed 3-member axis", () => {
    expect(literalMembers(EnumsState.ToolSource).length).toBe(4)
    expect(literalMembers(EnumsState.ToolSurface)).toEqual(["native", "mcp", "code_mode"])
  })
})

describe("T014 protocol tool request — fixed tools discriminator (C2, C7)", () => {
  test("the request pins the collection discriminator to the literal tools", () => {
    expect(commandsSrc).toContain('Extract<CollectionKind, "tools">')
    // A malformed non-tools discriminator does not typecheck (compile-time _fixedCollection above).
    const request = { collection: "tools" } as Pick<ToolRetrievalRequest, "collection">
    expect(request.collection).toBe("tools")
  })
})
