import { describe, expect, test } from "bun:test"
import type { DegradationGap, McpResourceDescriptor, McpServerProfile } from "@opencode-ai/protocol/mcp/commands"
import { deriveCallCardView, deriveExperimentalFlagRowView, deriveResourceRowView, deriveServerCardView, type McpCallEntry } from "./card"

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

describe("mcp-panel server card projection (FR29, FR48, C14)", () => {
  test("derives text-first fields for a nominal server, never color-only", () => {
    const view = deriveServerCardView(server())
    expect(view.id).toBe("server_1")
    expect(view.nameText).toBe("filesystem")
    expect(view.connectionStateText).toBe("connected")
    expect(view.transportKindText).toBe("streamable-http")
    expect(view.endpointText).toBe("https://mcp.example.com/mcp")
    expect(view.trustProfileText).toBe("untrusted")
    expect(view.sseDeprecationText).toBeNull()
    expect(view.degradedText).toBe("nominal")
    expect(view.enabledText).toBe("enabled")
  })

  test("a degradation gap surfaces status textually without inventing a nominal state (FR7, C1, C2)", () => {
    const gap: DegradationGap = { code: "mcp_unavailable", reason: "connection reset" }
    expect(deriveServerCardView(server(), gap).degradedText).toBe("degraded (mcp_unavailable)")
  })
})

function resource(overrides: Partial<McpResourceDescriptor> = {}): McpResourceDescriptor {
  return { serverId: "server_1", uri: "file:///project/README.md", subscribable: false, ...overrides }
}

describe("mcp-panel resource-admin row projection (C9, C10)", () => {
  test("derives text-first fields for a resource row", () => {
    const view = deriveResourceRowView(resource())
    expect(view.uriText).toBe("file:///project/README.md")
    expect(view.nameText).toBeNull()
    expect(view.mimeTypeText).toBeNull()
    expect(view.subscribableText).toBe("not subscribable")
  })

  test("a subscribable resource is labeled subscribable", () => {
    expect(deriveResourceRowView(resource({ subscribable: true })).subscribableText).toBe("subscribable")
  })
})

describe("mcp-panel experimental-flag row projection (FR41, FR45, C18)", () => {
  test("derives text-first fields; off by default", () => {
    const view = deriveExperimentalFlagRowView({ serverId: "server_1", flag: "tasks", enabled: false })
    expect(view.flagText).toBe("tasks")
    expect(view.enabledText).toBe("disabled")
  })

  test("an operator-enabled flag surfaces enabled textually", () => {
    const view = deriveExperimentalFlagRowView({ serverId: "server_1", flag: "sampling", enabled: true })
    expect(view.enabledText).toBe("enabled")
  })
})

function callEntry(overrides: Partial<McpCallEntry> = {}): McpCallEntry {
  return {
    mcpCallId: "call_1",
    serverId: "server_1",
    toolNameText: "read_file",
    kind: "tool",
    parentSessionId: "session_a",
    statusText: "running",
    startedAtMs: 1_000,
    updatedAtMs: 1_500,
    ...overrides,
  }
}

describe("mcp-panel call card projection (FR14, FR15, FR33, FR34, C7, C16, C17)", () => {
  test("derives status/progress/elapsed for a running call with no envelope yet", () => {
    const view = deriveCallCardView(callEntry(), 2_000)
    expect(view.mcpCallId).toBe("call_1")
    expect(view.serverIdText).toBe("server_1")
    expect(view.toolNameText).toBe("read_file")
    expect(view.kindText).toBe("tool")
    expect(view.statusText).toBe("running")
    expect(view.progressText).toBe("-")
    expect(view.totalText).toBeNull()
    expect(view.messageText).toBeNull()
    expect(view.bytesText).toBeNull()
    expect(view.elapsedMsText).toBe("500ms")
    expect(view.outputRefText).toBeNull()
    expect(view.untrustedLabelText).toBeNull()
  })

  test("progress/total/message surface from the bounded progress event (FR14, FR15, C7)", () => {
    const view = deriveCallCardView(
      callEntry({ progress: { progressToken: "tok_1", progress: 3, total: 10, message: "scanning", mcpCallId: "call_1" } }),
      1_500,
    )
    expect(view.progressText).toBe("3")
    expect(view.totalText).toBe("10")
    expect(view.messageText).toBe("scanning")
  })

  test("a settled call carries an OutputRef for bounded expand, never inline content (FR33, FR34, C16, C17)", () => {
    const view = deriveCallCardView(
      callEntry({
        statusText: "completed",
        envelope: { kind: "text", outputRef: "outref_1", previewBytes: 128, provenance: "trusted", ramSpillApplied: false },
      }),
      2_000,
    )
    expect(view.outputRefText).toBe("outref_1")
    expect(view.bytesText).toBe("128 B")
    expect(view.untrustedLabelText).toBeNull()
  })

  test("non-trusted provenance is labeled, never silently rendered as trusted (FR27, C24)", () => {
    const view = deriveCallCardView(
      callEntry({
        envelope: { kind: "text", outputRef: "outref_1", previewBytes: 64, provenance: "untrusted", ramSpillApplied: false },
      }),
      2_000,
    )
    expect(view.untrustedLabelText).toBe("untrusted")
  })

  test("elapsed never goes negative even with out-of-order clock injection", () => {
    const view = deriveCallCardView(callEntry({ startedAtMs: 2_000, updatedAtMs: 1_000 }), 1_500)
    expect(view.elapsedMsText).toBe("0ms")
  })
})
