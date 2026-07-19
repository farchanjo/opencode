/**
 * Feature 013 / T002 — protocol/smart shape parity against the CUE corpus
 * (FR1, FR3, FR11). The smart operator surface is authored twice: as the
 * normative projection ValueObjects under
 * `doc/arch/schemas/operator-config-domains/{smart,enums}.cue`, and as the
 * implemented TypeScript mirror under `packages/protocol/src/smart/**`. This
 * suite pins that the mirror does not drift from the CUE authority:
 *
 *   1. The `SmartPort` method surface covers every `#SmartVerb`, collapsing the
 *      `status` read onto `resolve` and keeping `on`/`off`/`auto` (langlock idiom).
 *   2. The `SmartError` discriminants equal `#MutationOutcome` minus `success`,
 *      plus the `not_implemented` stub sentinel.
 *   3. The projection read model carries the `#SmartSummary` fields.
 *   4. `enabled`/`mode` are REUSED from `RoutingConfig.Activation`, never
 *      re-declared (smart is a projection, not a second store).
 *
 * The type-only union source files are parsed from text (they carry no runtime
 * representation), mirroring `packages/protocol/test/langlock/contract-parity.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const commandsSrc = read("../../src/smart/commands.ts")
const portsSrc = read("../../src/smart/ports.ts")
const smartCue = read("../../../../doc/arch/schemas/operator-config-domains/smart.cue")
const enumsCue = read("../../../../doc/arch/schemas/operator-config-domains/enums.cue")

const asSet = (values: Iterable<string>) => new Set(values)

/** Extract the `readonly <name>:` method keys of an `export interface NAME { ... }` block. */
function parseInterfaceMembers(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`interface ${name} not found`)
  return [...match[1].matchAll(/readonly\s+(\w+):/g)].map((m) => m[1])
}

/** Extract every `type: "..."` discriminant from a closed error union. */
function parseErrorDiscriminants(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|$)`))
  if (!match) throw new Error(`error union ${name} not found`)
  return [...match[1].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the quoted alternatives of a CUE `#Name: "a" | "b" | ...` disjunction. */
function parseCueEnum(src: string, name: string): string[] {
  const match = src.match(new RegExp(`#${name}:\\s*([^\\n]+)`))
  if (!match) throw new Error(`CUE enum ${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the field names of a CUE `#Name: { ... }` struct block. */
function parseCueStructFields(src: string, name: string): string[] {
  const match = src.match(new RegExp(`#${name}:\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`CUE struct ${name} not found`)
  return [...match[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
}

describe("T002 parity — SmartPort method surface vs #SmartVerb (FR3)", () => {
  test("the port collapses status onto resolve and keeps on/off/auto", () => {
    expect(parseInterfaceMembers(portsSrc, "SmartPort").sort()).toEqual(["auto", "off", "on", "resolve"])
  })

  test("every #SmartVerb read maps to resolve and every mutation verb has a method", () => {
    const verbs = asSet(parseCueEnum(enumsCue, "SmartVerb"))
    expect(verbs).toEqual(asSet(["status", "on", "off", "auto"]))
    for (const mutation of ["on", "off", "auto"]) {
      expect(portsSrc).toContain(`readonly ${mutation}:`)
    }
  })
})

describe("T002 parity — SmartError vs #MutationOutcome (FR7, FR8)", () => {
  test("the discriminants equal #MutationOutcome minus success, plus not_implemented", () => {
    const outcomes = parseCueEnum(enumsCue, "MutationOutcome").filter((o) => o !== "success")
    const expected = asSet([...outcomes, "not_implemented"])
    expect(asSet(parseErrorDiscriminants(commandsSrc, "SmartError"))).toEqual(expected)
  })
})

describe("T002 parity — projection read model vs #SmartSummary (FR3)", () => {
  test("SmartSummary carries the CUE projection fields (projected enabled/auto)", () => {
    for (const field of parseCueStructFields(smartCue, "SmartSummary")) {
      expect(commandsSrc).toContain(`readonly ${field}:`)
    }
    expect(commandsSrc).toContain("readonly enabled: SmartRoutingEnabled")
    expect(commandsSrc).toContain("readonly auto: boolean")
  })
})

describe("T002 parity — enabled/mode reused from RoutingConfig.Activation (FR3, FR9)", () => {
  test("commands.ts sources the enabled/mode types from the routing config schema", () => {
    expect(commandsSrc).toContain('from "@opencode-ai/schema/routing/config"')
    expect(commandsSrc).toContain("Activation")
    expect(commandsSrc).toContain("SmartRoutingEnabled")
  })

  test("smart declares no parallel enabled/mode literal union (projection, not a second store)", () => {
    expect(commandsSrc).not.toContain('"always"')
    expect(commandsSrc).not.toContain('"never"')
  })
})
