import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RESERVED_MCP_COMMAND_IDS } from "@opencode-ai/protocol/mcp/commands"
import { McpCommandPort } from "@/operator/mcp/mcp-command-port"
import { McpBackendLive } from "@/operator/mcp/backend-live"
import { McpStackWiring } from "@/operator/mcp/stack-wiring"
import type { McpAdminBackend, McpAuditEvent } from "@/operator/mcp/mcp-port"

// A backend that always succeeds and records which port method was reached.
function spyBackend(calls: string[]): McpAdminBackend {
  const ok = (label: string) => (input: unknown) => {
    calls.push(label)
    return Effect.succeed({ ok: true, label, input } as never)
  }
  return {
    server: {
      list: ok("server.list"), add: ok("server.add"), update: ok("server.update"), test: ok("server.test"),
      connect: ok("server.connect"), disconnect: ok("server.disconnect"), reconnect: ok("server.reconnect"),
      disable: ok("server.disable"), delete: ok("server.delete"), status: ok("server.status"), capabilities: ok("server.capabilities"),
    },
    auth: { start: ok("auth.start"), finish: ok("auth.finish"), remove: ok("auth.remove"), status: ok("auth.status") },
    resource: {
      list: ok("resource.list"), templates: ok("resource.templates"), read: ok("resource.read"),
      subscribe: ok("resource.subscribe"), unsubscribe: ok("resource.unsubscribe"),
      policyShow: ok("resource.policyShow"), policySet: ok("resource.policySet"),
    },
    logging: { show: ok("logging.show"), set: ok("logging.set") },
    experimental: { status: ok("experimental.status"), enable: ok("experimental.enable"), disable: ok("experimental.disable") },
    extension: { status: ok("extension.status"), enable: ok("extension.enable"), disable: ok("extension.disable") },
  } as McpAdminBackend
}

function ctx(id: string, payload: Record<string, unknown> = {}): any {
  return {
    descriptor: { id, domain: "mcp" },
    request: { payload, principal: { kind: "operator", subject: "op-1" }, scope: { kind: "project", ref: "proj-1" } },
  }
}

describe("operator mcp domain (T034)", () => {
  test("all 30 reserved mcp.* ids dispatch to the typed port with an audit event", async () => {
    const calls: string[] = []
    const audits: McpAuditEvent[] = []
    const ports = McpCommandPort.createMcpDomainPorts({
      port: spyBackend(calls),
      audit: { record: (e) => Effect.sync(() => void audits.push(e)) },
    })

    expect(RESERVED_MCP_COMMAND_IDS.length).toBe(30)
    for (const id of RESERVED_MCP_COMMAND_IDS) {
      const result = await ports.mcp.invoke(ctx(id, { id: "srv", serverId: "srv", confirmed: true }))
      expect(result.kind).toBe("query")
    }
    // Every dispatch reached a port method and recorded exactly one ok audit.
    expect(calls.length).toBe(30)
    expect(audits.length).toBe(30)
    expect(audits.every((a) => a.outcome === "ok")).toBe(true)
  })

  test("a non-reserved id is rejected as not a reserved id (no dispatch)", async () => {
    const calls: string[] = []
    const ports = McpCommandPort.createMcpDomainPorts({
      port: spyBackend(calls),
      audit: { record: () => Effect.void },
    })
    const result = await ports.mcp.invoke(ctx("mcp.not.a.real.id"))
    expect(result.kind).toBe("failure")
    expect(calls.length).toBe(0)
  })

  test("reserved-id guard mirrors the catalog exactly", () => {
    expect(McpCommandPort.isReservedMcpId("mcp.server.list")).toBe(true)
    expect(McpCommandPort.isReservedMcpId("mcp.resource.admin.policy.set")).toBe(true)
    expect(McpCommandPort.isReservedMcpId("semantic.provider.list")).toBe(false)
    expect(McpCommandPort.RESERVED_MCP_IDS.size).toBe(30)
  })

  test("honest live gap backend yields an unavailable failure, never a false success", async () => {
    const audits: McpAuditEvent[] = []
    const wiring = McpStackWiring.createMcpDomainWiring({
      backend: McpBackendLive.createLiveMcpBackend({}),
      audit: { record: (e) => Effect.sync(() => void audits.push(e)) },
    })
    const result = await wiring.ports.mcp.invoke(ctx("mcp.server.list"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("unavailable")
    expect(audits[0]?.outcome).toBe("unavailable")
    wiring.dispose()
  })
})
