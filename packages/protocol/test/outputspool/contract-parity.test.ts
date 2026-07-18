/**
 * Feature 005 / T041 (S27) — protocol/outputspool shape parity across the
 * plan-phase design draft, the implemented protocol mirror, and the schema
 * authority (FR9, FR18, FR20, FR22, FR41, FR42, FR44, C14, C17, C19, C20).
 *
 * `doc/arch/sdd/005-.../contracts/ports.ts` is the plan-phase interface draft. It
 * presented a DIVERGENT provisional event surface: a 13-member `output.*`
 * vocabulary and a 5-member `ReferenceEdgeKind`. T014 RECONCILED the transport
 * contract to the CUE / `data-model.md` authority — the closed 11-member `output.*`
 * vocabulary (7 durable + 4 live) and the 6-member `RetentionEdgeKind` — sourcing
 * the enums directly from `@opencode-ai/schema/outputspool/*` so the transport
 * contract can never drift from the wire shape. This suite pins that reconciliation:
 *
 *   1. The protocol mirror's vocabulary is IDENTICAL, member-for-member, to the
 *      schema `event-definitions` authority (11 members, 7 durable / 4 live), and
 *      the draft's 13-member provisional surface is the reconciled-away divergence.
 *   2. `SpoolWriterError` / `SpoolReaderError` / `RetentionError` / `AdminError`
 *      keep the same closed `type` discriminant set across the draft and the mirror.
 *   3. The four port interfaces expose the same method names in the draft and mirror.
 *
 * The type-only unions carry no runtime representation, so both TypeScript source
 * files are parsed from text, mirroring `packages/protocol/test/langlock/
 * contract-parity.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EventDefinitions } from "@opencode-ai/schema/outputspool/event-definitions"
import { Enums } from "@opencode-ai/schema/outputspool/enums"
import { DURABLE_OUTPUTSPOOL_EVENT_TYPES, LIVE_OUTPUTSPOOL_EVENT_TYPES } from "../../src/outputspool/commands"

const draftSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../doc/arch/sdd/005-add-a-canonical-file-backed-outputspool-and-paged/contracts/ports.ts",
      import.meta.url,
    ),
  ),
  "utf8",
)
const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/outputspool/commands.ts", import.meta.url)), "utf8")
const portsSrc = readFileSync(fileURLToPath(new URL("../../src/outputspool/ports.ts", import.meta.url)), "utf8")

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

describe("T041 parity — protocol mirror equals the schema 11-member vocabulary (C20)", () => {
  const protocolDurable = parseConstArray(commandsSrc, "DURABLE_OUTPUTSPOOL_EVENT_TYPES")
  const protocolLive = parseConstArray(commandsSrc, "LIVE_OUTPUTSPOOL_EVENT_TYPES")
  const schemaDurable = EventDefinitions.DurableDefinitions.map((d) => d.type)
  const schemaLive = EventDefinitions.LiveDefinitions.map((d) => d.type)

  test("the mirror's DURABLE ∪ LIVE equals the schema's 11-member vocabulary", () => {
    const schemaUnion = asSet([...schemaDurable, ...schemaLive])
    expect(schemaUnion.size).toBe(11)
    expect(asSet([...protocolDurable, ...protocolLive])).toEqual(schemaUnion)
  })

  test("the mirror's 7 durable / 4 live split matches the schema authority exactly", () => {
    expect(asSet(protocolDurable)).toEqual(asSet(schemaDurable))
    expect(asSet(protocolLive)).toEqual(asSet(schemaLive))
    expect(schemaDurable.length).toBe(7)
    expect(schemaLive.length).toBe(4)
  })

  test("durable and live members are disjoint in the mirror", () => {
    expect(protocolDurable.filter((t) => protocolLive.includes(t))).toEqual([])
  })

  test("the runtime exports equal the parsed protocol source", () => {
    expect(([...DURABLE_OUTPUTSPOOL_EVENT_TYPES] as string[]).sort()).toEqual([...protocolDurable].sort())
    expect(([...LIVE_OUTPUTSPOOL_EVENT_TYPES] as string[]).sort()).toEqual([...protocolLive].sort())
    expect(DURABLE_OUTPUTSPOOL_EVENT_TYPES.length).toBe(7)
    expect(LIVE_OUTPUTSPOOL_EVENT_TYPES.length).toBe(4)
  })
})

describe("T041 parity — the draft's provisional 13-member surface is the reconciled-away divergence", () => {
  const draftDurable = parseConstArray(draftSrc, "DURABLE_OUTPUTSPOOL_EVENT_TYPES")
  const draftLive = parseConstArray(draftSrc, "LIVE_OUTPUTSPOOL_EVENT_TYPES")
  const schemaUnion = asSet(EventDefinitions.Definitions.map((d) => d.type))

  test("the draft carried a 13-member surface that no longer matches the authority", () => {
    expect(draftDurable.length).toBe(7)
    expect(draftLive.length).toBe(6)
    expect(asSet([...draftDurable, ...draftLive]).size).toBe(13)
    // Reconciled away: the draft vocabulary is NOT the canonical authority.
    expect(asSet([...draftDurable, ...draftLive])).not.toEqual(schemaUnion)
  })

  test("no draft-only member (e.g. output.settled_sealed) leaks into the schema authority", () => {
    for (const draftOnly of ["output.sealed", "output.settled_sealed", "output.purged", "output.reconcile_started"]) {
      expect(schemaUnion.has(draftOnly)).toBe(false)
    }
  })
})

describe("T041 parity — ReferenceEdgeKind reconciled to the 6-member RetentionEdgeKind (C5)", () => {
  test("the schema RetentionEdgeKind carries all six canonical edge kinds", () => {
    expect(asSet(Enums.RetentionEdgeKind.literals)).toEqual(
      asSet(["transcript", "todo", "handoff", "notification", "row_telemetry", "lease"]),
    )
    expect(Enums.RetentionEdgeKind.literals).toHaveLength(6)
  })

  test("the protocol mirror sources ReferenceEdgeKind from the schema RetentionEdgeKind", () => {
    // The mirror aliases SchemaRetentionEdgeKind rather than redeclaring a divergent union.
    expect(commandsSrc).toMatch(/ReferenceEdgeKind\s*=\s*SchemaRetentionEdgeKind/)
  })
})

describe("T041 parity — typed error unions (FR9, FR42, C14, C17)", () => {
  const unions: ReadonlyArray<{ name: string; expectedSize: number }> = [
    { name: "SpoolWriterError", expectedSize: 9 },
    { name: "SpoolReaderError", expectedSize: 7 },
    { name: "RetentionError", expectedSize: 6 },
    { name: "AdminError", expectedSize: 9 },
  ]

  for (const { name, expectedSize } of unions) {
    test(`${name} carries the same closed discriminant set in the draft and the protocol mirror`, () => {
      const draft = asSet(parseErrorDiscriminants(draftSrc, name))
      const protocol = asSet(parseErrorDiscriminants(commandsSrc, name))
      expect(draft.size).toBe(expectedSize)
      expect(protocol).toEqual(draft)
    })
  }

  test("SpoolWriterError guards the fencing + admission fault codes (C4, C12, C18)", () => {
    const d = asSet(parseErrorDiscriminants(commandsSrc, "SpoolWriterError"))
    for (const code of ["stale_generation", "enospc", "fd_exhaustion", "quota", "offset_conflict", "corrupt"]) {
      expect(d.has(code)).toBe(true)
    }
  })

  test("SpoolReaderError guards expired + invalid_cursor — a stale token never rewinds (C14, AC4)", () => {
    const d = asSet(parseErrorDiscriminants(commandsSrc, "SpoolReaderError"))
    expect(d.has("expired")).toBe(true)
    expect(d.has("invalid_cursor")).toBe(true)
  })

  test("RetentionError guards referenced + legal_hold — never mtime-only reclaim (C5, Privacy 1)", () => {
    const d = asSet(parseErrorDiscriminants(commandsSrc, "RetentionError"))
    expect(d.has("referenced")).toBe(true)
    expect(d.has("legal_hold")).toBe(true)
  })

  test("AdminError guards cross_project_denied + reserved_name — deny-by-default + C19 collision", () => {
    const d = asSet(parseErrorDiscriminants(commandsSrc, "AdminError"))
    expect(d.has("cross_project_denied")).toBe(true)
    expect(d.has("reserved_name")).toBe(true)
    expect(d.has("version_conflict")).toBe(true)
  })
})

describe("T041 parity — port interface method surfaces (FR9, FR18, FR41, FR42)", () => {
  const ports: ReadonlyArray<{ name: string; members: string[] }> = [
    { name: "SpoolWriterPort", members: ["open", "append", "seal", "abort"] },
    { name: "SpoolReaderPort", members: ["stat", "read", "follow"] },
    { name: "RetentionPort", members: ["lease", "release", "cleanup"] },
    { name: "AdminPort", members: ["export", "share", "release", "delete", "purge", "setRetention", "setQuota"] },
  ]

  for (const { name, members } of ports) {
    test(`${name} exposes the same method names in the draft and the protocol mirror`, () => {
      expect(parseInterfaceMembers(draftSrc, name).sort()).toEqual([...members].sort())
      expect(parseInterfaceMembers(portsSrc, name).sort()).toEqual([...members].sort())
    })
  }
})
