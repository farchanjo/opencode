import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { EventTypes } from "../../src/langlock/event-types"
import { EventDefinitions } from "../../src/langlock/event-definitions"
import { Enums } from "../../src/langlock/enums"

// Feature 004 / T038 (S20) — the closed 15-member langlock.* event vocabulary and
// its durable-versus-live split (FR27, C8, AC14). Mirrors
// doc/arch/schemas/langlock/event-types.cue and events-audit/events-advisory.cue.
// The six durable audit members replay through EventV2; the nine live members
// carry no sequence. generic_code is a PathKind member but is never advisory-eligible.

const ALL_MEMBERS = [
  "langlock.policy_set",
  "langlock.policy_reset",
  "langlock.override_authorized",
  "langlock.override_denied",
  "langlock.exception_registered",
  "langlock.exception_revoked",
  "langlock.policy_injected",
  "langlock.policy_reapplied",
  "langlock.envelope_stamped",
  "langlock.advisory_flagged",
  "langlock.advisory_acknowledged",
  "langlock.advisory_suppressed",
  "langlock.detector_unknown",
  "langlock.resolution_retained",
  "langlock.unknown",
] as const

describe("EventTypes.LangLockEventType — closed 15-member vocabulary (C8)", () => {
  test("decodes every one of the fifteen members", () => {
    for (const member of ALL_MEMBERS) {
      expect(Schema.decodeUnknownSync(EventTypes.LangLockEventType)(member)).toBe(member)
    }
  })

  test("rejects an out-of-vocabulary event type", () => {
    expect(() => Schema.decodeUnknownSync(EventTypes.LangLockEventType)("langlock.made_up")).toThrow()
  })

  test("carries no member outside the langlock.* prefix", () => {
    for (const member of ALL_MEMBERS) expect(member.startsWith("langlock.")).toBe(true)
  })
})

describe("EventDefinitions — the durable-versus-live split (C8)", () => {
  test("all fifteen members register exactly one Definition each", () => {
    expect(EventDefinitions.Definitions.length).toBe(15)
    expect(new Set(EventDefinitions.Definitions.map((d) => d.type))).toEqual(new Set(ALL_MEMBERS))
  })

  test("exactly six durable audit members, in vocabulary order", () => {
    expect(EventDefinitions.DurableDefinitions.map((d) => d.type)).toEqual([
      "langlock.policy_set",
      "langlock.policy_reset",
      "langlock.override_authorized",
      "langlock.override_denied",
      "langlock.exception_registered",
      "langlock.exception_revoked",
    ])
  })

  test("exactly nine live members with no durable members leaking in", () => {
    expect(EventDefinitions.LiveDefinitions.length).toBe(9)
    const durable = new Set(EventDefinitions.DurableDefinitions.map((d) => d.type))
    for (const live of EventDefinitions.LiveDefinitions) expect(durable.has(live.type)).toBe(false)
  })

  test("ByType resolves every member to its Definition", () => {
    for (const member of ALL_MEMBERS) expect(EventDefinitions.ByType.get(member)?.type).toBe(member)
  })
})

describe("Enums.PathKind — generic_code present but never advisory-eligible (FR20, C5, AC11)", () => {
  test("decodes generic_code as a valid path kind", () => {
    expect(Schema.decodeUnknownSync(Enums.PathKind)("generic_code")).toBe("generic_code")
  })

  test("the seven-member PathKind vocabulary is closed", () => {
    for (const kind of [
      "prose_markdown",
      "docs",
      "instruction_file",
      "commit_text",
      "generic_code",
      "exempt",
      "unknown",
    ] as const) {
      expect(Schema.decodeUnknownSync(Enums.PathKind)(kind)).toBe(kind)
    }
    expect(() => Schema.decodeUnknownSync(Enums.PathKind)("source_code")).toThrow()
  })
})
