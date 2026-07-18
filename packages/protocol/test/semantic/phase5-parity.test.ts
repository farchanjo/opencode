import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EventDefinitions } from "@opencode-ai/schema/semantic/event-definitions"
import { Enums } from "@opencode-ai/schema/semantic/enums"
import { EnumsState } from "@opencode-ai/schema/semantic/enums-state"
import {
  DURABLE_SEMANTIC_EVENT_TYPES,
  LIVE_SEMANTIC_EVENT_TYPES,
  RESERVED_SEMANTIC_COMMAND_IDS,
} from "../../src/semantic/commands"

/**
 * Feature 006 / T041 (S25) — protocol/semantic parity vs the schema authority.
 *
 * A close-out pin over the transport contract: the reconciled 12-member vocabulary
 * (9 durable / 3 live) sourced from `@opencode-ai/schema/semantic/*`, the reconciled
 * enums, the 30 reserved command IDs, and the CUE cross-check that the protocol
 * mirror never diverges from the wire authority (FR3, FR9, FR12, FR30, C15, C16,
 * C20, AC15).
 */

const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/semantic/commands.ts", import.meta.url)), "utf8")
const cueEventTypes = readFileSync(
  fileURLToPath(new URL("../../../../doc/arch/schemas/semantic/event-types.cue", import.meta.url)),
  "utf8",
)

const literalMembers = (schema: { readonly ast: unknown }): string[] => {
  const ast = schema.ast as { readonly types?: ReadonlyArray<{ readonly literal?: unknown }> }
  return (ast.types ?? []).map((t) => String(t.literal))
}
const asSet = (v: Iterable<string>) => new Set(v)

describe("T041 protocol vocabulary parity (schema + CUE authority)", () => {
  test("the 12-member vocabulary equals the schema authority AND the CUE corpus", () => {
    const protocol = asSet([...DURABLE_SEMANTIC_EVENT_TYPES, ...LIVE_SEMANTIC_EVENT_TYPES])
    expect(protocol.size).toBe(12)
    expect(asSet(EventDefinitions.Definitions.map((d) => d.type))).toEqual(protocol)
    const cueMembers = [...cueEventTypes.matchAll(/"(semantic\.[a-z_]+)"/g)].map((m) => m[1])
    expect(asSet(cueMembers)).toEqual(protocol)
  })

  test("the durable/live split is 9/3 and matches the schema authority", () => {
    expect(DURABLE_SEMANTIC_EVENT_TYPES.length).toBe(9)
    expect(LIVE_SEMANTIC_EVENT_TYPES.length).toBe(3)
    expect([...DURABLE_SEMANTIC_EVENT_TYPES].sort()).toEqual([...EventDefinitions.DurableDefinitions.map((d) => d.type)].sort())
    expect([...LIVE_SEMANTIC_EVENT_TYPES].sort()).toEqual([...EventDefinitions.LiveDefinitions.map((d) => d.type)].sort())
  })
})

describe("T041 protocol enum parity (sourced from the schema modules)", () => {
  test("RerankProfile 3, CapabilityKind 4, DegradationGap 8, BindingState/GenerationState 5", () => {
    expect(literalMembers(Enums.RerankProfile).length).toBe(3)
    expect(literalMembers(Enums.CapabilityKind).length).toBe(4)
    expect(literalMembers(EnumsState.DegradationGap).length).toBe(8)
    expect(literalMembers(EnumsState.BindingState).length).toBe(5)
    expect(literalMembers(EnumsState.GenerationState).length).toBe(5)
  })

  test("the protocol commands module sources its enums from @opencode-ai/schema/semantic/*", () => {
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/enums"')
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/enums-state"')
  })
})

describe("T041 reserved command IDs", () => {
  test("the protocol mirror carries the closed 30-member reserved id set", () => {
    expect(new Set(RESERVED_SEMANTIC_COMMAND_IDS).size).toBe(30)
    for (const id of RESERVED_SEMANTIC_COMMAND_IDS) expect(id.startsWith("semantic.")).toBe(true)
  })
})
