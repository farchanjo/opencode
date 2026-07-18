import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { EventTypes } from "../../src/outputspool/event-types"
import { EventDefinitions } from "../../src/outputspool/event-definitions"
import { DurableEventManifest } from "../../src/durable-event-manifest"

// Feature 005 / T041 (S27) — the closed 11-member output.* content-plane
// vocabulary and its durable-versus-live split (FR4, C20, AC18). Mirrors
// doc/arch/schemas/outputspool/event-types.cue (7 durable + 4 live). The seven
// durable settlement members replay through the single EventV2 authority; the
// four live members carry no durable annotation and are droppable under load.

const DURABLE_MEMBERS = [
  "output.channel_sealed",
  "output.channel_aborted",
  "output.settlement_recorded",
  "output.reconciled",
  "output.generation_fenced",
  "output.group_released",
  "output.group_reclaimed",
] as const

const LIVE_MEMBERS = [
  "output.chunk_appended",
  "output.backpressure_signalled",
  "output.admission_degraded",
  "output.unknown",
] as const

const ALL_MEMBERS = [...DURABLE_MEMBERS, ...LIVE_MEMBERS] as const

describe("EventTypes.OutputEventType — closed 11-member vocabulary (C20)", () => {
  test("decodes every one of the eleven members", () => {
    for (const member of ALL_MEMBERS) {
      expect(Schema.decodeUnknownSync(EventTypes.OutputEventType)(member)).toBe(member)
    }
  })

  test("the literal set is exactly eleven closed members", () => {
    expect(EventTypes.OutputEventType.literals).toHaveLength(11)
    expect(new Set(EventTypes.OutputEventType.literals)).toEqual(new Set(ALL_MEMBERS))
  })

  test("rejects an out-of-vocabulary event type", () => {
    expect(() => Schema.decodeUnknownSync(EventTypes.OutputEventType)("output.made_up")).toThrow()
    // The Feature 007 operator command domain (output.read) is NOT a content-plane member.
    expect(() => Schema.decodeUnknownSync(EventTypes.OutputEventType)("output.read")).toThrow()
  })

  test("carries no member outside the output.* prefix", () => {
    for (const member of ALL_MEMBERS) expect(member.startsWith("output.")).toBe(true)
  })
})

describe("EventDefinitions — the durable-versus-live split (C20)", () => {
  test("all eleven members register exactly one Definition each", () => {
    expect(EventDefinitions.Definitions.length).toBe(11)
    expect(new Set(EventDefinitions.Definitions.map((d) => d.type))).toEqual(new Set(ALL_MEMBERS))
  })

  test("exactly seven durable settlement members, in vocabulary order", () => {
    expect(EventDefinitions.DurableDefinitions.map((d) => d.type)).toEqual([...DURABLE_MEMBERS])
  })

  test("only the seven durable members carry the durable annotation", () => {
    for (const d of EventDefinitions.DurableDefinitions) expect(d.durable).toBeDefined()
  })

  test("exactly four live members with no durable members leaking in", () => {
    expect(EventDefinitions.LiveDefinitions.length).toBe(4)
    const durable = new Set(EventDefinitions.DurableDefinitions.map((d) => d.type))
    for (const live of EventDefinitions.LiveDefinitions) {
      expect(durable.has(live.type)).toBe(false)
      expect(live.durable).toBeUndefined()
    }
  })

  test("ByType resolves every member to its Definition", () => {
    for (const member of ALL_MEMBERS) expect(EventDefinitions.ByType.get(member)?.type).toBe(member)
  })
})

describe("DurableEventManifest — the seven durable output.* members are registered (T013, C20)", () => {
  test("every durable settlement member is present at version 1", () => {
    for (const member of DURABLE_MEMBERS) {
      expect(DurableEventManifest.Durable.has(`${member}.1`)).toBe(true)
    }
  })

  test("no live member leaks into the durable inventory", () => {
    for (const member of LIVE_MEMBERS) {
      expect(DurableEventManifest.Durable.has(`${member}.1`)).toBe(false)
    }
  })
})
