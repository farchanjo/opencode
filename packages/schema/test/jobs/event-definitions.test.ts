import { describe, expect, test } from "bun:test"
import { EventDefinitions } from "../../src/jobs/event-definitions"

// Feature 003 / T032 — packages/schema/src/jobs/event-definitions.ts registers
// one EventV2.define Definition per job.* member (FR11), mirroring the
// Feature 001/002 pattern. Durable members carry the EventV2
// durable {version, aggregate: "root_session_id"} annotation and replay
// through readAggregate; live members omit it (C8).

// `Definition["data"]` is typed generically as `Schema.Codec<unknown, unknown>`
// once erased into `ReadonlyArray<Definition>`, so the concrete `Schema.Struct`
// `.fields` accessor needs a narrowing cast; the runtime object is always the
// `Schema.Struct(input.schema)` built by `Event.define` (see `../../src/event.ts`).
const fieldsOf = (definition: (typeof EventDefinitions.Definitions)[number]): ReadonlyArray<string> =>
  Object.keys((definition.data as unknown as { fields: Record<string, unknown> }).fields)

describe("EventDefinitions.Definitions — one Definition per job.* member", () => {
  test("carries all thirty members, twenty-three durable then seven live", () => {
    expect(EventDefinitions.DurableDefinitions.length).toBe(23)
    expect(EventDefinitions.LiveDefinitions.length).toBe(7)
    expect(EventDefinitions.Definitions.length).toBe(30)
    expect(EventDefinitions.Definitions).toEqual([
      ...EventDefinitions.DurableDefinitions,
      ...EventDefinitions.LiveDefinitions,
    ])
  })

  test("every Definition.type is prefixed job. and unique", () => {
    const types = EventDefinitions.Definitions.map((definition) => definition.type)
    expect(new Set(types).size).toBe(30)
    for (const type of types) expect(type.startsWith("job.")).toBe(true)
  })

  test("every durable Definition carries version:1 and aggregate:root_session_id (C8)", () => {
    for (const definition of EventDefinitions.DurableDefinitions) {
      expect(definition.durable).toEqual({ version: 1, aggregate: "root_session_id" })
    }
  })

  test("every live Definition omits the durable annotation — no sequence, no replay (C8, C19)", () => {
    for (const definition of EventDefinitions.LiveDefinitions) {
      expect(definition.durable).toBeUndefined()
    }
  })

  test("every durable member's data carries a top-level root_session_id field for aggregate wiring (C8)", () => {
    for (const definition of EventDefinitions.DurableDefinitions) {
      expect(fieldsOf(definition)).toContain("root_session_id")
    }
  })

  test("no member's data fields carry the top-level type discriminant — dataFields strips it before EventV2.define", () => {
    for (const definition of EventDefinitions.Definitions) {
      expect(fieldsOf(definition)).not.toContain("type")
    }
  })
})

describe("EventDefinitions.ByType — lookup keyed by the bare unversioned type string", () => {
  test("resolves every registered member's own Definition", () => {
    for (const definition of EventDefinitions.Definitions) {
      expect(EventDefinitions.ByType.get(definition.type)).toBe(definition)
    }
  })

  test("has exactly thirty entries, matching the Definitions inventory", () => {
    expect(EventDefinitions.ByType.size).toBe(30)
  })

  test("returns undefined for an unregistered type", () => {
    expect(EventDefinitions.ByType.get("job.paused")).toBeUndefined()
    expect(EventDefinitions.ByType.get("jobs.list")).toBeUndefined()
  })
})
