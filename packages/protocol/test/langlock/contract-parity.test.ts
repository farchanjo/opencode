/**
 * Feature 004 / T038 — protocol/langlock shape parity against the normative
 * design contract `contracts/ports.ts` (FR7, FR21, FR34, FR35, C2, C3, C6, C8).
 *
 * `doc/arch/sdd/004-.../contracts/ports.ts` is the plan-phase interface draft.
 * `packages/protocol/src/langlock/**` is the implemented TypeScript mirror —
 * plain `interface`/`type` declarations that source their closed enums and the
 * 15-member `langlock.*` vocabulary from `@opencode-ai/schema/langlock/*` so the
 * transport contract can never diverge from the wire shape. This suite pins:
 *
 *   1. The closed 15-member `langlock.*` event vocabulary and its 6-durable /
 *      9-live split are IDENTICAL, member-for-member, across the draft, the
 *      protocol mirror, and `@opencode-ai/schema/langlock/event-definitions`.
 *   2. `LangLockPolicyError` / `DetectionError` / `AdvisoryError` keep the same
 *      closed set of `type` discriminants across the draft and the protocol mirror.
 *   3. The three port interfaces expose the same method names in both.
 *
 * Both TypeScript source files are parsed from text (never imported as a module
 * for the type-only unions — they carry no runtime representation), mirroring the
 * source-scan style of `packages/protocol/test/jobs/contract-parity.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EventDefinitions } from "@opencode-ai/schema/langlock/event-definitions"
import { DURABLE_LANGLOCK_EVENT_TYPES, LIVE_LANGLOCK_EVENT_TYPES } from "../../src/langlock/commands"

const draftSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../doc/arch/sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/contracts/ports.ts",
      import.meta.url,
    ),
  ),
  "utf8",
)
const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/langlock/commands.ts", import.meta.url)), "utf8")
const portsSrc = readFileSync(fileURLToPath(new URL("../../src/langlock/ports.ts", import.meta.url)), "utf8")

/** Extract the quoted members of a `const NAME = [ ... ] as const` array. */
function parseConstArray(src: string, name: string): string[] {
  const match = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`))
  if (!match) throw new Error(`const array ${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract every `{ readonly type: "..." ... }` discriminant from a closed error union. */
function parseErrorDiscriminants(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|$)`))
  if (!match) throw new Error(`error union ${name} not found`)
  return [...match[1].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the `readonly <name>:` method keys of an `export interface NAME { ... }` block. */
function parseInterfaceMembers(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`interface ${name} not found`)
  return [...match[1].matchAll(/readonly\s+(\w+):/g)].map((m) => m[1])
}

const asSet = (values: Iterable<string>) => new Set(values)

describe("T038 parity — closed 15-member langlock.* vocabulary (C8)", () => {
  const draftDurable = parseConstArray(draftSrc, "DURABLE_LANGLOCK_EVENT_TYPES")
  const draftLive = parseConstArray(draftSrc, "LIVE_LANGLOCK_EVENT_TYPES")
  const protocolDurable = parseConstArray(commandsSrc, "DURABLE_LANGLOCK_EVENT_TYPES")
  const protocolLive = parseConstArray(commandsSrc, "LIVE_LANGLOCK_EVENT_TYPES")
  const schemaTypes = EventDefinitions.Definitions.map((d) => d.type)

  test("the draft's DURABLE ∪ LIVE equals the protocol's and the schema's 15-member vocabulary", () => {
    const draftUnion = asSet([...draftDurable, ...draftLive])
    expect(draftUnion.size).toBe(15)
    expect(asSet([...protocolDurable, ...protocolLive])).toEqual(draftUnion)
    expect(asSet(schemaTypes)).toEqual(draftUnion)
  })

  test("durable and live members are disjoint in the draft and the protocol mirror", () => {
    expect(draftDurable.filter((t) => draftLive.includes(t))).toEqual([])
    expect(protocolDurable.filter((t) => protocolLive.includes(t))).toEqual([])
  })

  test("the runtime exports equal the parsed protocol source (6 durable / 9 live)", () => {
    expect(([...DURABLE_LANGLOCK_EVENT_TYPES] as string[]).sort()).toEqual([...protocolDurable].sort())
    expect(([...LIVE_LANGLOCK_EVENT_TYPES] as string[]).sort()).toEqual([...protocolLive].sort())
    expect(DURABLE_LANGLOCK_EVENT_TYPES.length).toBe(6)
    expect(LIVE_LANGLOCK_EVENT_TYPES.length).toBe(9)
  })
})

describe("T038 parity — durable-versus-live split matches the schema authority (C8)", () => {
  const draftDurable = asSet(parseConstArray(draftSrc, "DURABLE_LANGLOCK_EVENT_TYPES"))
  const draftLive = asSet(parseConstArray(draftSrc, "LIVE_LANGLOCK_EVENT_TYPES"))
  const schemaDurable = asSet(EventDefinitions.DurableDefinitions.map((d) => d.type))
  const schemaLive = asSet(EventDefinitions.LiveDefinitions.map((d) => d.type))

  test("the six durable audit members match the draft exactly", () => {
    expect(schemaDurable.size).toBe(6)
    expect([...schemaDurable].sort()).toEqual([...draftDurable].sort())
  })

  test("the nine live members match the draft exactly", () => {
    expect(schemaLive.size).toBe(9)
    expect([...schemaLive].sort()).toEqual([...draftLive].sort())
  })

  test("no schema member is classified as both durable and live", () => {
    for (const t of schemaDurable) expect(schemaLive.has(t)).toBe(false)
  })
})

describe("T038 parity — typed error unions (FR34, C2, C3)", () => {
  const unions: ReadonlyArray<{ name: string; expectedSize: number }> = [
    { name: "LangLockPolicyError", expectedSize: 7 },
    { name: "DetectionError", expectedSize: 4 },
    { name: "AdvisoryError", expectedSize: 5 },
  ]

  for (const { name, expectedSize } of unions) {
    test(`${name} carries the same closed discriminant set in the draft and the protocol mirror`, () => {
      const draft = asSet(parseErrorDiscriminants(draftSrc, name))
      const protocol = asSet(parseErrorDiscriminants(commandsSrc, name))
      expect(draft.size).toBe(expectedSize)
      expect(protocol).toEqual(draft)
    })
  }

  test("LangLockPolicyError carries reserved_name — guards C3 langlock.* collision", () => {
    expect(asSet(parseErrorDiscriminants(commandsSrc, "LangLockPolicyError")).has("reserved_name")).toBe(true)
  })

  test("LangLockPolicyError carries floor_violation and unauthorized — guards FR5/FR6, Security 1", () => {
    const discriminants = asSet(parseErrorDiscriminants(commandsSrc, "LangLockPolicyError"))
    expect(discriminants.has("floor_violation")).toBe(true)
    expect(discriminants.has("unauthorized")).toBe(true)
    expect(discriminants.has("invalid_tag")).toBe(true)
    expect(discriminants.has("version_conflict")).toBe(true)
  })

  test("DetectionError carries not_eligible — generic code is never a detection target (FR20)", () => {
    expect(asSet(parseErrorDiscriminants(commandsSrc, "DetectionError")).has("not_eligible")).toBe(true)
  })
})

describe("T038 parity — port interface method surfaces (FR7, FR21, FR35)", () => {
  const ports: ReadonlyArray<{ name: string; members: string[] }> = [
    { name: "LangLockPolicyPort", members: ["resolve", "set", "reset"] },
    { name: "DetectionPort", members: ["classify"] },
    { name: "AdvisoryPort", members: ["record", "list", "ack"] },
  ]

  for (const { name, members } of ports) {
    test(`${name} exposes the same method names in the draft and the protocol mirror`, () => {
      expect(parseInterfaceMembers(draftSrc, name).sort()).toEqual([...members].sort())
      expect(parseInterfaceMembers(portsSrc, name).sort()).toEqual([...members].sort())
    })
  }
})
