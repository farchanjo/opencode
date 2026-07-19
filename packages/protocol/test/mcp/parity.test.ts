import { describe, expect, test } from "bun:test"
import { EventTypes } from "@opencode-ai/schema/mcp/event-types"
import {
  DURABLE_MCP_EVENT_TYPES,
  LIVE_MCP_EVENT_TYPES,
  RESERVED_MCP_COMMAND_IDS,
} from "../../src/mcp/commands"

// Feature 008 / T041 — pin protocol/mcp parity against the schema modules reconciled to
// the CUE authority: the 15-member vocabulary (10 durable / 5 live),
// `mcp.call.cancel_requested` **live**, no `mcp.subscription.fail_closed` event member,
// and exactly 30 reserved `mcp.*` command ids across six sub-namespaces (FR38, FR48,
// C3, C8, C25). The protocol arrays `satisfies ReadonlyArray<SchemaMcpEventType>` at the
// type level; this suite pins the runtime values to the schema literals.

describe("protocol mcp event vocabulary parity (T041)", () => {
  test("durable + live reconstruct exactly the 15 schema members", () => {
    const schemaMembers = new Set(EventTypes.McpEventType.literals as ReadonlyArray<string>)
    const protocolMembers = new Set<string>([...DURABLE_MCP_EVENT_TYPES, ...LIVE_MCP_EVENT_TYPES])
    expect(protocolMembers.size).toBe(15)
    expect(protocolMembers).toEqual(schemaMembers)
  })

  test("10 durable / 5 live split", () => {
    expect(DURABLE_MCP_EVENT_TYPES).toHaveLength(10)
    expect(LIVE_MCP_EVENT_TYPES).toHaveLength(5)
    // disjoint
    for (const durable of DURABLE_MCP_EVENT_TYPES) {
      expect((LIVE_MCP_EVENT_TYPES as ReadonlyArray<string>)).not.toContain(durable)
    }
  })

  test("mcp.call.cancel_requested is live, its durable audit is mcp.call.cancelled", () => {
    expect((LIVE_MCP_EVENT_TYPES as ReadonlyArray<string>)).toContain("mcp.call.cancel_requested")
    expect((DURABLE_MCP_EVENT_TYPES as ReadonlyArray<string>)).not.toContain("mcp.call.cancel_requested")
    expect((DURABLE_MCP_EVENT_TYPES as ReadonlyArray<string>)).toContain("mcp.call.cancelled")
  })

  test("no mcp.subscription.fail_closed event member; only the two durable transitions", () => {
    const all = [...DURABLE_MCP_EVENT_TYPES, ...LIVE_MCP_EVENT_TYPES] as ReadonlyArray<string>
    expect(all).not.toContain("mcp.subscription.fail_closed")
    expect(all).toContain("mcp.subscription.subscribed")
    expect(all).toContain("mcp.subscription.unsubscribed")
  })

  test("single mcp.tools_changed spelling — zero mcp.tools.changed survivors", () => {
    const all = [...DURABLE_MCP_EVENT_TYPES, ...LIVE_MCP_EVENT_TYPES] as ReadonlyArray<string>
    expect(all).toContain("mcp.tools_changed")
    expect(all).not.toContain("mcp.tools.changed")
  })
})

describe("reserved mcp.* command ids (T041)", () => {
  const byNamespace = (prefix: string) =>
    (RESERVED_MCP_COMMAND_IDS as ReadonlyArray<string>).filter((id) => id.startsWith(prefix))

  test("exactly 30 ids across six sub-namespaces (11/4/7/2/3/3)", () => {
    expect(RESERVED_MCP_COMMAND_IDS).toHaveLength(30)
    expect(byNamespace("mcp.server.")).toHaveLength(11)
    expect(byNamespace("mcp.auth.")).toHaveLength(4)
    expect(byNamespace("mcp.resource.admin.")).toHaveLength(7)
    expect(byNamespace("mcp.logging.level.")).toHaveLength(2)
    expect(byNamespace("mcp.experimental.")).toHaveLength(3)
    expect(byNamespace("mcp.extension.")).toHaveLength(3)
  })

  test("all ids are unique and mcp.*-prefixed", () => {
    const ids = RESERVED_MCP_COMMAND_IDS as ReadonlyArray<string>
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith("mcp."))).toBe(true)
  })

  test("no reserved id embeds a secret/token/path token", () => {
    const ids = RESERVED_MCP_COMMAND_IDS as ReadonlyArray<string>
    for (const id of ids) {
      expect(id).not.toMatch(/secret|token|password|path/)
    }
  })
})
