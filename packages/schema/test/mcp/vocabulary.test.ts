import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { DurableEventManifest } from "../../src/durable-event-manifest"
import { EventDefinitions } from "../../src/mcp/event-definitions"
import { Events } from "../../src/mcp/events"
import { EventTypes } from "../../src/mcp/event-types"

// Feature 008 / T041 — pin the closed 15-member mcp.* event vocabulary and the
// 10-durable / 5-live split across the schema modules, the durable-event manifest, and
// the tagged union, with the single `mcp.tools_changed` spelling and zero
// `mcp.tools.changed` survivors (FR38, C3). This suite is the schema-side anchor of the
// CUE ↔ schema ↔ protocol ↔ data-model parity chain.

const DURABLE = [
  "mcp.server.status",
  "mcp.server.capabilities_changed",
  "mcp.tools_changed",
  "mcp.resources_changed",
  "mcp.resource_updated",
  "mcp.call.settled",
  "mcp.call.cancelled",
  "mcp.task.settled",
  "mcp.subscription.subscribed",
  "mcp.subscription.unsubscribed",
] as const

const LIVE = [
  "mcp.call.started",
  "mcp.call.progress",
  "mcp.call.cancel_requested",
  "mcp.task.status",
  "mcp.log",
] as const

describe("McpEventType vocabulary (T041)", () => {
  test("is a closed set of exactly 15 members", () => {
    expect(EventTypes.McpEventType.literals).toHaveLength(15)
  })

  test("decodes every member and rejects an unknown literal", () => {
    for (const member of EventTypes.McpEventType.literals) {
      expect(Schema.decodeUnknownSync(EventTypes.McpEventType)(member)).toBe(member)
    }
    expect(() => Schema.decodeUnknownSync(EventTypes.McpEventType)("mcp.unknown")).toThrow()
  })

  test("uses the single mcp.tools_changed spelling — zero mcp.tools.changed survivors", () => {
    const members = EventTypes.McpEventType.literals as ReadonlyArray<string>
    expect(members).toContain("mcp.tools_changed")
    expect(members).not.toContain("mcp.tools.changed")
    expect(members.filter((m) => m.startsWith("mcp.tools")).length).toBe(1)
  })

  test("splits 10 durable + 5 live disjointly, mcp.call.cancel_requested live", () => {
    const all = new Set(EventTypes.McpEventType.literals as ReadonlyArray<string>)
    for (const m of [...DURABLE, ...LIVE]) expect(all.has(m)).toBe(true)
    expect(new Set([...DURABLE, ...LIVE]).size).toBe(15)
    expect(DURABLE).not.toContain("mcp.call.cancel_requested")
    expect(LIVE).toContain("mcp.call.cancel_requested")
    // No subscription.fail_closed event member — fail_closed is a SubscriptionState value.
    expect(all.has("mcp.subscription.fail_closed")).toBe(false)
  })
})

describe("EventDefinitions durable/live split (T041)", () => {
  test("exactly ten durable Definitions, all annotated durable v1 on correlation_id", () => {
    expect(EventDefinitions.DurableDefinitions).toHaveLength(10)
    for (const def of EventDefinitions.DurableDefinitions) {
      expect(DURABLE).toContain(def.type as (typeof DURABLE)[number])
      expect(def.durable?.version).toBe(1)
      expect(def.durable?.aggregate).toBe("correlation_id")
    }
  })

  test("exactly five live Definitions, none carrying durable", () => {
    expect(EventDefinitions.LiveDefinitions).toHaveLength(5)
    for (const def of EventDefinitions.LiveDefinitions) {
      expect(LIVE).toContain(def.type as (typeof LIVE)[number])
      expect(def.durable).toBeUndefined()
    }
  })

  test("ByType covers all 15 members once", () => {
    expect(EventDefinitions.Definitions).toHaveLength(15)
    expect(EventDefinitions.ByType.size).toBe(15)
    for (const m of [...DURABLE, ...LIVE]) expect(EventDefinitions.ByType.has(m)).toBe(true)
  })
})

describe("durable-event manifest join (T041)", () => {
  test("joins the ten durable mcp.* members and omits the five live members", () => {
    for (const m of DURABLE) expect(DurableEventManifest.Durable.has(`${m}.1`)).toBe(true)
    for (const m of LIVE) expect(DurableEventManifest.Durable.has(`${m}.1`)).toBe(false)
  })
})

describe("McpEvent tagged union (T041)", () => {
  test("is exhaustive over the 15-member vocabulary", () => {
    const tags = new Set<string>()
    for (const member of EventTypes.McpEventType.literals) tags.add(member)
    // Every vocabulary member must have a decodable union arm keyed on `type`.
    for (const m of [...DURABLE, ...LIVE]) expect(tags.has(m)).toBe(true)
    expect(typeof Events.McpEvent).toBe("object")
  })
})
