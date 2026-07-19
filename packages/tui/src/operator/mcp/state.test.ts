import { describe, expect, test } from "bun:test"
import type { McpServerProfile, NegotiatedCapabilitySet } from "@opencode-ai/protocol/mcp/commands"
import type { McpCallEntry } from "./card"
import {
  deriveDirectChildCalls,
  deriveServerCapabilityBadges,
  deriveVisibleExperimentalFlagRows,
  deriveVisibleResourceRows,
  deriveVisibleServerCards,
  derivePanelPageView,
  EMPTY_MCP_PANEL_SIGNAL,
  MAX_VISIBLE_CALLS,
  MAX_VISIBLE_SERVERS,
  resolveMcpExpandAction,
  type McpPanelSignal,
} from "./state"

function server(id: string, overrides: Partial<McpServerProfile> = {}): McpServerProfile {
  return {
    id,
    version: 1,
    name: id,
    transportKind: "streamable-http",
    endpoint: "https://mcp.example.com/mcp",
    scope: "project",
    trustProfile: "untrusted",
    connectionState: "connected",
    enabled: true,
    sseDeprecationLabel: false,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    auditId: `audit_${id}`,
    ...overrides,
  }
}

function call(mcpCallId: string, parentSessionId: string): McpCallEntry {
  return {
    mcpCallId,
    serverId: "server_1",
    toolNameText: "read_file",
    kind: "tool",
    parentSessionId,
    statusText: "running",
    startedAtMs: 0,
    updatedAtMs: 0,
  }
}

describe("mcp-panel signal + projections (FR29, FR48, FR57, C14, C24)", () => {
  test("the empty baseline renders no servers, resources, flags, calls, or pages", () => {
    expect(deriveVisibleServerCards(EMPTY_MCP_PANEL_SIGNAL)).toEqual([])
    expect(deriveVisibleResourceRows(EMPTY_MCP_PANEL_SIGNAL)).toEqual([])
    expect(deriveVisibleExperimentalFlagRows(EMPTY_MCP_PANEL_SIGNAL)).toEqual([])
    expect(deriveDirectChildCalls(EMPTY_MCP_PANEL_SIGNAL)).toEqual([])
    expect(derivePanelPageView(EMPTY_MCP_PANEL_SIGNAL, "outref_1")).toBeNull()
  })

  test("the visible server count is bounded", () => {
    const servers = Array.from({ length: MAX_VISIBLE_SERVERS + 5 }, (_, i) => server(`server_${i}`))
    const signal: McpPanelSignal = { ...EMPTY_MCP_PANEL_SIGNAL, servers }
    expect(deriveVisibleServerCards(signal).length).toBe(MAX_VISIBLE_SERVERS)
  })

  test("a degradation gap keyed by serverId surfaces on that server's card only (FR7, C1, C2)", () => {
    const signal: McpPanelSignal = {
      ...EMPTY_MCP_PANEL_SIGNAL,
      servers: [server("server_1"), server("server_2")],
      degradation: { server_1: { code: "mcp_unavailable", reason: "reset" } },
    }
    const cards = deriveVisibleServerCards(signal)
    expect(cards.find((c) => c.id === "server_1")?.degradedText).toBe("degraded (mcp_unavailable)")
    expect(cards.find((c) => c.id === "server_2")?.degradedText).toBe("nominal")
  })

  test("capability badges resolve per serverId; an unknown server renders the honest empty baseline", () => {
    const capabilities: NegotiatedCapabilitySet = {
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
    }
    const signal: McpPanelSignal = { ...EMPTY_MCP_PANEL_SIGNAL, capabilities: { server_1: capabilities } }
    expect(deriveServerCapabilityBadges(signal, "server_1").capabilityBadgesText).toEqual(["tools"])
    expect(deriveServerCapabilityBadges(signal, "server_missing").capabilityBadgesText).toEqual([])
  })

  test("shows only direct-child calls — a call under a different session is excluded", () => {
    const signal: McpPanelSignal = {
      ...EMPTY_MCP_PANEL_SIGNAL,
      currentSessionId: "session_a",
      calls: [call("call_1", "session_a"), call("call_2", "session_b"), call("call_3", "session_a")],
    }
    const visible = deriveDirectChildCalls(signal)
    expect(visible.map((v) => v.mcpCallId)).toEqual(["call_1", "call_3"])
  })

  test("the visible call count is bounded", () => {
    const calls = Array.from({ length: MAX_VISIBLE_CALLS + 5 }, (_, i) => call(`call_${i}`, "session_a"))
    const signal: McpPanelSignal = { ...EMPTY_MCP_PANEL_SIGNAL, currentSessionId: "session_a", calls }
    expect(deriveDirectChildCalls(signal).length).toBe(MAX_VISIBLE_CALLS)
  })

  test("resolveMcpExpandAction requests a load when no page is cached (FR33, FR34, C16, C17)", () => {
    expect(resolveMcpExpandAction(EMPTY_MCP_PANEL_SIGNAL, null, "outref_1")).toEqual({ kind: "load" })
  })

  test("resolveMcpExpandAction collapses an already-expanded call", () => {
    expect(resolveMcpExpandAction(EMPTY_MCP_PANEL_SIGNAL, "outref_1", "outref_1")).toEqual({ kind: "already-expanded" })
  })

  test("resolveMcpExpandAction resumes from the cached page's cursor on reconnect (C14, C18)", () => {
    const signal: McpPanelSignal = {
      ...EMPTY_MCP_PANEL_SIGNAL,
      pages: { outref_1: { page: { bytes: new Uint8Array(), nextOffset: 4, committedBytes: 4, caughtUp: true, eof: false }, cursor: "cursor-token" } },
    }
    expect(resolveMcpExpandAction(signal, null, "outref_1")).toEqual({ kind: "resume", cursor: "cursor-token" })
  })

  test("resolveMcpExpandAction reports loaded when the cached page is eof or carries no cursor", () => {
    const signal: McpPanelSignal = {
      ...EMPTY_MCP_PANEL_SIGNAL,
      pages: {
        outref_eof: { page: { bytes: new Uint8Array(), nextOffset: 4, committedBytes: 4, caughtUp: true, eof: true }, cursor: "cursor-token" },
        outref_no_cursor: { page: { bytes: new Uint8Array(), nextOffset: 4, committedBytes: 4, caughtUp: true, eof: false }, cursor: null },
      },
    }
    expect(resolveMcpExpandAction(signal, null, "outref_eof")).toEqual({ kind: "loaded" })
    expect(resolveMcpExpandAction(signal, null, "outref_no_cursor")).toEqual({ kind: "loaded" })
  })

  test("derivePanelPageView projects a cached page for its outputRef", () => {
    const signal: McpPanelSignal = {
      ...EMPTY_MCP_PANEL_SIGNAL,
      pages: { outref_1: { page: { bytes: new TextEncoder().encode("hi"), nextOffset: 2, committedBytes: 2, caughtUp: true, eof: false }, cursor: null } },
    }
    expect(derivePanelPageView(signal, "outref_1")?.text).toBe("hi")
    expect(derivePanelPageView(signal, "outref_missing")).toBeNull()
  })
})
