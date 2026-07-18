/**
 * Feature 002 / T038 — protocol/lifecycle shape parity against the normative
 * design contract `contracts/ports.ts` (FR9, FR13, FR20, FR24).
 *
 * `doc/arch/sdd/002-.../contracts/ports.ts` is the plan-phase interface draft.
 * The implemented schema (`@opencode-ai/schema/lifecycle/**`) is the runtime
 * source of truth. This suite pins the parity that MUST hold — the closed
 * 26-member event vocabulary and the durable-versus-live split — and records
 * the deliberate, wire-driven normalizations the implementation applied, so a
 * silent drift in either direction is caught:
 *
 *   1. Wire identifiers are snake_case: the draft's kebab-case value-enum members
 *      (`global-privileged`, `local-estimate`) normalize to underscores.
 *   2. Event-type members carry the `lifecycle.` prefix in the schema; the draft
 *      lists them unprefixed.
 *   3. A small set of value enums (`TerminalReason`, `SettlementState`,
 *      `ActivityKind`) were intentionally re-specified past the draft during
 *      implementation; those are asserted to *differ* on purpose (an unflagged
 *      convergence would mean the draft was edited without updating this pin).
 *
 * The draft is parsed from source text (never imported — it is a doc artifact),
 * mirroring the source-scan style of the Feature 001 cardinality audit.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { Enums } from "@opencode-ai/schema/lifecycle/enums"
import { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import { EventDefinitions } from "@opencode-ai/schema/lifecycle/event-definitions"

const contractSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/contracts/ports.ts",
      import.meta.url,
    ),
  ),
  "utf8",
)

/** Kebab-case → snake_case: the wire-identifier normalization the schema applies. */
function snake(value: string): string {
  return value.replace(/-/g, "_")
}

/** Extract the quoted members of a `const NAME = [ ... ] as const` array. */
function parseConstArray(name: string): string[] {
  const match = contractSrc.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`))
  if (!match) throw new Error(`const array ${name} not found in contracts/ports.ts`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the quoted members of an `export type NAME = "a" | "b" | ...` union. */
function parseUnionType(name: string): string[] {
  const match = contractSrc.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|\\nexport |\\n/\\*)`))
  if (!match) throw new Error(`union type ${name} not found in contracts/ports.ts`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

const asSet = (values: Iterable<string>) => new Set(values)
const stripPrefix = (type: string) => type.replace(/^lifecycle\./, "")

describe("T038 contract parity — closed 26-member vocabulary (FR20)", () => {
  const draftDurable = parseConstArray("DURABLE_LIFECYCLE_EVENT_TYPES")
  const draftLive = parseConstArray("LIVE_LIFECYCLE_EVENT_TYPES")
  const schemaTypes = EventDefinitions.Definitions.map((d) => d.type)

  test("the draft's DURABLE ∪ LIVE is exactly the schema's 26-member vocabulary", () => {
    const draftUnion = asSet([...draftDurable, ...draftLive])
    const schemaUnprefixed = asSet(schemaTypes.map(stripPrefix))
    expect(draftUnion.size).toBe(26)
    expect(schemaUnprefixed.size).toBe(26)
    expect([...draftUnion].sort()).toEqual([...schemaUnprefixed].sort())
    // The schema enum literal set agrees with its own Definition inventory.
    expect(asSet(Enums.LifecycleEventType.literals.map(stripPrefix))).toEqual(schemaUnprefixed)
  })

  test("durable and live members are disjoint on both sides", () => {
    const overlap = draftDurable.filter((t) => draftLive.includes(t))
    expect(overlap).toEqual([])
  })
})

describe("T038 contract parity — durable-versus-live split (FR9, FR24)", () => {
  const draftDurable = asSet(parseConstArray("DURABLE_LIFECYCLE_EVENT_TYPES"))
  const draftLive = asSet(parseConstArray("LIVE_LIFECYCLE_EVENT_TYPES"))
  const schemaDurable = asSet(EventDefinitions.DurableDefinitions.map((d) => stripPrefix(d.type)))
  const schemaLive = asSet(EventDefinitions.LiveDefinitions.map((d) => stripPrefix(d.type)))

  test("the eleven durable members match the draft exactly (prefix-normalized)", () => {
    expect(schemaDurable.size).toBe(11)
    expect([...schemaDurable].sort()).toEqual([...draftDurable].sort())
  })

  test("the fifteen live members match the draft exactly (prefix-normalized)", () => {
    expect(schemaLive.size).toBe(15)
    expect([...schemaLive].sort()).toEqual([...draftLive].sort())
  })

  test("no schema member is classified as both durable and live", () => {
    for (const t of schemaDurable) expect(schemaLive.has(t)).toBe(false)
  })
})

describe("T038 contract parity — contract-stable value enums (FR13)", () => {
  // Enums the implementation kept faithful to the draft. Draft members are
  // wire-normalized (kebab → snake) before comparison; everything else is exact.
  const stable: ReadonlyArray<{ name: string; literals: ReadonlyArray<string> }> = [
    { name: "ProcessState", literals: Enums.ProcessState.literals },
    { name: "AgentKind", literals: Enums.AgentKind.literals },
    { name: "ActorKind", literals: Enums.ActorKind.literals },
    { name: "Visibility", literals: Enums.Visibility.literals },
    { name: "CancelOutcome", literals: EnumsObservation.CancelOutcome.literals },
    { name: "HierarchyRole", literals: EnumsObservation.HierarchyRole.literals },
    { name: "ValidationOutcome", literals: EnumsObservation.ValidationOutcome.literals },
    { name: "UsageProvenance", literals: EnumsObservation.UsageProvenance.literals },
    { name: "UsageSource", literals: EnumsObservation.UsageSource.literals },
  ]

  for (const { name, literals } of stable) {
    test(`${name} members match the draft (wire-normalized)`, () => {
      const draft = asSet(parseUnionType(name).map(snake))
      expect(asSet(literals)).toEqual(draft)
    })
  }
})

describe("T038 contract parity — deliberately re-specified enums are pinned as divergent", () => {
  // These were re-specified past the draft during implementation. If any of them
  // silently re-converges, this pin fails so the divergence is re-reviewed
  // (or the draft was edited and this test must be updated).
  test("TerminalReason was re-specified (draft names never adopted verbatim)", () => {
    const draft = asSet(parseUnionType("TerminalReason").map(snake))
    expect(asSet(Enums.TerminalReason.literals)).not.toEqual(draft)
    // The runtime set is the authoritative one.
    expect(Enums.TerminalReason.literals).toContain("completed_ok")
  })

  test("SettlementState drops the draft's `unsettled` (modeled as absence/null)", () => {
    const draft = asSet(parseUnionType("SettlementState").map(snake))
    expect(draft.has("unsettled")).toBe(true)
    expect(asSet(Enums.SettlementState.literals).has("unsettled")).toBe(false)
    // The remaining members are otherwise the draft minus `unsettled`.
    const draftMinus = new Set([...draft].filter((m) => m !== "unsettled"))
    expect(asSet(Enums.SettlementState.literals)).toEqual(draftMinus)
  })

  test("ActivityKind was re-specified (adds search/settling, drops the draft's `other`)", () => {
    const draft = asSet(parseUnionType("ActivityKind").map(snake))
    const schema = asSet(EnumsObservation.ActivityKind.literals)
    expect(schema).not.toEqual(draft)
    expect(schema.has("settling")).toBe(true)
  })
})
