/**
 * Feature 013 / T004 — protocol/pools shape parity against the CUE corpus
 * (FR1, FR5, FR11). The pools operator surface is authored twice: as the
 * normative projection ValueObjects under
 * `doc/arch/schemas/operator-config-domains/{pools,enums}.cue`, and as the
 * implemented TypeScript mirror under `packages/protocol/src/pools/**`. This
 * suite pins that the mirror does not drift from the CUE authority:
 *
 *   1. The `PoolsPort` method surface equals the `#PoolsVerb` surface,
 *      collapsing status/show onto the single `resolve` read (langlock idiom).
 *   2. The `PoolsError` discriminants equal `#MutationOutcome` minus `success`,
 *      plus the `not_implemented` stub sentinel.
 *   3. The projection read model carries the `#PoolsProjection` fields.
 *
 * The type-only union source files are parsed from text (they carry no runtime
 * representation), mirroring `packages/protocol/test/langlock/contract-parity.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const commandsSrc = read("../../src/pools/commands.ts")
const portsSrc = read("../../src/pools/ports.ts")
const poolsCue = read("../../../../doc/arch/schemas/operator-config-domains/pools.cue")
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

describe("T004 parity — PoolsPort method surface vs #PoolsVerb (FR5)", () => {
  test("the port collapses status/show onto resolve and keeps set/reset/validate", () => {
    expect(parseInterfaceMembers(portsSrc, "PoolsPort").sort()).toEqual(["reset", "resolve", "set", "validate"])
  })

  test("every #PoolsVerb read maps to resolve and every mutation verb has a method", () => {
    const verbs = asSet(parseCueEnum(enumsCue, "PoolsVerb"))
    expect(verbs).toEqual(asSet(["status", "show", "set", "reset", "validate"]))
    for (const mutation of ["set", "reset", "validate"]) {
      expect(portsSrc).toContain(`readonly ${mutation}:`)
    }
  })
})

describe("T004 parity — PoolsError vs #MutationOutcome (FR7, FR8)", () => {
  test("the discriminants equal #MutationOutcome minus success, plus not_implemented", () => {
    const outcomes = parseCueEnum(enumsCue, "MutationOutcome").filter((o) => o !== "success")
    const expected = asSet([...outcomes, "not_implemented"])
    expect(asSet(parseErrorDiscriminants(commandsSrc, "PoolsError"))).toEqual(expected)
  })
})

describe("T004 parity — projection read model vs #PoolsProjection (FR5)", () => {
  test("PoolsProjection carries the CUE projection fields (bounded binding list)", () => {
    const cueFields = [...poolsCue.matchAll(/^\t(\w+):\s/gm)].map((m) => m[1])
    for (const field of cueFields) {
      expect(commandsSrc).toContain(`readonly ${field}:`)
    }
    expect(commandsSrc).toContain("readonly bindings: RolePoolBindingList")
  })
})
