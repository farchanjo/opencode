import { describe, expect, test } from "bun:test"
import type { McpServerProfile, NegotiatedCapabilitySet } from "@opencode-ai/protocol/mcp/commands"
import { deriveCapabilityBadgeRowView, deriveServerBadgeRowView } from "./badges"

function server(overrides: Partial<McpServerProfile> = {}): McpServerProfile {
  return {
    id: "server_1",
    version: 1,
    name: "filesystem",
    transportKind: "streamable-http",
    endpoint: "https://mcp.example.com/mcp",
    scope: "project",
    trustProfile: "untrusted",
    connectionState: "connected",
    enabled: true,
    sseDeprecationLabel: false,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    auditId: "audit_1",
    ...overrides,
  }
}

function capabilities(overrides: Partial<NegotiatedCapabilitySet> = {}): NegotiatedCapabilitySet {
  return {
    serverId: "server_1",
    protocolVersion: "2025-11-25",
    tools: true,
    toolsListChanged: false,
    resources: false,
    resourcesSubscribe: false,
    resourcesListChanged: false,
    prompts: false,
    promptsListChanged: false,
    logging: false,
    roots: false,
    experimentalTasks: false,
    experimentalContentStream: false,
    recordedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  }
}

describe("mcp-panel server badge projection (FR29, C14)", () => {
  test("derives text-first connection/transport fields, never color-only", () => {
    const view = deriveServerBadgeRowView(server())
    expect(view.connectionStateText).toBe("connected")
    expect(view.transportKindText).toBe("streamable-http")
    expect(view.trustProfileText).toBe("untrusted")
    expect(view.scopeText).toBe("project")
    expect(view.enabledText).toBe("enabled")
    expect(view.sseDeprecationText).toBeNull()
  })

  test("a legacy SSE fallback is labeled textually, never color-only (C14)", () => {
    const view = deriveServerBadgeRowView(server({ sseDeprecationLabel: true }))
    expect(view.sseDeprecationText).toBe("legacy SSE fallback (deprecated)")
  })

  test("a disabled server surfaces disabled textually", () => {
    expect(deriveServerBadgeRowView(server({ enabled: false })).enabledText).toBe("disabled")
  })
})

describe("mcp-panel capability badge projection (FR7, FR8, C2)", () => {
  test("undefined capabilities render the honest empty baseline, never an invented badge", () => {
    const view = deriveCapabilityBadgeRowView(undefined)
    expect(view.capabilityBadgesText).toEqual([])
    expect(view.protocolVersionText).toBeNull()
  })

  test("only advertised capabilities appear as badges", () => {
    const view = deriveCapabilityBadgeRowView(capabilities())
    expect(view.capabilityBadgesText).toEqual(["tools"])
    expect(view.protocolVersionText).toBe("2025-11-25")
  })

  test("every negotiated capability produces its own badge", () => {
    const view = deriveCapabilityBadgeRowView(
      capabilities({
        toolsListChanged: true,
        resources: true,
        resourcesSubscribe: true,
        resourcesListChanged: true,
        prompts: true,
        promptsListChanged: true,
        logging: true,
        roots: true,
        experimentalTasks: true,
        experimentalContentStream: true,
      }),
    )
    expect(view.capabilityBadgesText).toEqual([
      "tools",
      "tools.list_changed",
      "resources",
      "resources.subscribe",
      "resources.list_changed",
      "prompts",
      "prompts.list_changed",
      "logging",
      "roots",
      "experimental.tasks",
      "experimental.content_stream",
    ])
  })
})
