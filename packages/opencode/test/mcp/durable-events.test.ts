import { describe, expect, test } from "bun:test"
import { McpDurableEvents } from "@/mcp/durable-events"
import type { Events as McpEvents } from "@opencode-ai/schema/mcp/events"

function eventOf(type: string, extra: Record<string, unknown> = {}): McpEvents.McpEvent {
  return {
    type,
    envelope: { ordering: { correlation_id: "corr-1", sequence: 1, causation_id: null } },
    ...extra,
  } as unknown as McpEvents.McpEvent
}

describe("mcp durable-events projection (T037)", () => {
  test("the durable/live split matches the closed 10/5 vocabulary", () => {
    expect(McpDurableEvents.DURABLE_MCP_TYPES.size).toBe(10)
    expect(McpDurableEvents.LIVE_MCP_TYPES.size).toBe(5)
    expect(McpDurableEvents.isDurableMcpEvent("mcp.tools_changed")).toBe(true)
    expect(McpDurableEvents.isDroppableUnderLoad("mcp.call.progress")).toBe(true)
    expect(McpDurableEvents.isDurableMcpEvent("mcp.call.progress")).toBe(false)
  })

  test("a durable member projects with a top-level correlation_id and resolves its wire Definition", () => {
    const projected = McpDurableEvents.projectForPublish(eventOf("mcp.tools_changed"))
    expect(projected.durable).toBe(true)
    expect(projected.definition.type).toBe("mcp.tools_changed")
    expect(projected.data.correlation_id).toBe("corr-1")
    expect(projected.data).not.toHaveProperty("type") // the Definition owns the discriminant
  })

  test("a live signal projects droppable, omits correlation_id, and carries no content/path", () => {
    const projected = McpDurableEvents.projectForPublish(eventOf("mcp.log"))
    expect(projected.durable).toBe(false)
    expect(projected.data).not.toHaveProperty("correlation_id")
    const serialized = JSON.stringify(projected.data)
    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("/etc/")
  })
})
