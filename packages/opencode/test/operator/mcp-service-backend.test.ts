/**
 * Feature 014 / T008 (FR7, FR14) — the real MCP admin backend over the live
 * `MCP.Service` host.
 *
 * `createMcpServiceOverride` turns a narrow live-host READ seam (`McpHostReader`,
 * implemented in `stack-live.ts` over `MCP.Service` + `McpAuth` via `AppRuntime`)
 * into the `override` `createLiveMcpBackend` overlays onto the honest gap. This suite
 * proves, with an injected fake reader (no live host needed):
 *
 *   - the faithful live reads — `mcp.auth.status`, `mcp.resource.admin.list`/
 *     `templates` — reflect the injected host state through the FULL dispatcher;
 *   - a live-host read that throws degrades to a typed `unavailable` failure, never a
 *     crash and never a leak of the underlying error (FR14);
 *   - every mutating verb (`server.add`, `auth.remove`, …) stays a typed capability
 *     gap — it NEVER returns a successful `query`, so the dispatcher's `mutates`→`query`
 *     rejection (the FR5 phantom-write trap) is never reached;
 *   - the reads surface no secret, raw token, or filesystem path.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
} from "@/operator/adapters"
import { domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import { McpBackendLive } from "@/operator/mcp/backend-live"
import { McpStackWiring } from "@/operator/mcp/stack-wiring"
import type { McpHostReader } from "@/operator/mcp/backend-live"
import type { McpAuditEvent } from "@/operator/mcp/mcp-port"
import type { CommandRequest } from "@opencode-ai/core/operator"

function baseRequest(overrides: Partial<CommandRequest> & Pick<CommandRequest, "id">): CommandRequest {
  return {
    principal: { kind: "operator", subject: "local", projectBinding: null },
    scope: { kind: "project", ref: "proj_1" },
    source: "cli",
    confirm: true,
    isTty: false,
    payload: {},
    ...overrides,
  }
}

function mutationPorts(): MutationPorts {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  return {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
}

/** A live-host reader double reflecting a single connected server with one resource + template. */
function fakeReader(): McpHostReader {
  return {
    authStatus: async (serverId) => (serverId === "srv_authed" ? "authenticated" : "not_authenticated"),
    listResources: async (serverId) => [
      { serverId, uri: "mcp://srv/readme.md", name: "readme", mimeType: "text/markdown", subscribable: true },
    ],
    listResourceTemplates: async (serverId) => [
      { serverId, uriTemplate: "mcp://srv/{path}", name: "files", mimeType: "text/plain" },
    ],
  }
}

/** A reader whose every read throws — the genuinely-unbound / unreachable live host. */
function throwingReader(): McpHostReader {
  const boom = () => Promise.reject(new Error("/Users/secret/host is down token=sr_abc"))
  return { authStatus: boom, listResources: boom, listResourceTemplates: boom }
}

function ctx(id: string, payload: Record<string, unknown> = {}): any {
  return {
    descriptor: { id, domain: "mcp" },
    request: { payload, principal: { kind: "operator", subject: "op-1" }, scope: { kind: "project", ref: "proj_1" } },
  }
}

describe("T008 mcp service backend — faithful live reads via the DomainInvoke", () => {
  test("auth.status reflects the live OAuth state", async () => {
    const audits: McpAuditEvent[] = []
    const wiring = McpStackWiring.createMcpDomainWiring({
      backend: McpBackendLive.createLiveMcpBackend({ override: McpBackendLive.createMcpServiceOverride(fakeReader()) }),
      audit: { record: (e) => Effect.sync(() => void audits.push(e)) },
    })
    const authed = await wiring.ports.mcp.invoke(ctx("mcp.auth.status", { serverId: "srv_authed" }))
    expect(authed.kind).toBe("query")
    if (authed.kind === "query") expect((authed.effective as { authStatus: string }).authStatus).toBe("authenticated")

    const anon = await wiring.ports.mcp.invoke(ctx("mcp.auth.status", { serverId: "srv_other" }))
    if (anon.kind === "query") expect((anon.effective as { authStatus: string }).authStatus).toBe("not_authenticated")
    expect(audits.every((a) => a.outcome === "ok")).toBe(true)
    wiring.dispose()
  })

  test("resource.admin.list + templates reflect the live client host", async () => {
    const wiring = McpStackWiring.createMcpDomainWiring({
      backend: McpBackendLive.createLiveMcpBackend({ override: McpBackendLive.createMcpServiceOverride(fakeReader()) }),
    })
    const list = await wiring.ports.mcp.invoke(ctx("mcp.resource.admin.list", { serverId: "srv" }))
    expect(list.kind).toBe("query")
    if (list.kind === "query") {
      const out = list.effective as { resources: ReadonlyArray<{ uri: string; subscribable: boolean }> }
      expect(out.resources[0]?.uri).toBe("mcp://srv/readme.md")
      expect(out.resources[0]?.subscribable).toBe(true)
    }
    const templates = await wiring.ports.mcp.invoke(ctx("mcp.resource.admin.templates", { serverId: "srv" }))
    if (templates.kind === "query") {
      const out = templates.effective as { templates: ReadonlyArray<{ uriTemplate: string }> }
      expect(out.templates[0]?.uriTemplate).toBe("mcp://srv/{path}")
    }
    wiring.dispose()
  })

  test("an unreachable live-host read degrades to a typed unavailable, never a crash or a leak", async () => {
    const audits: McpAuditEvent[] = []
    const wiring = McpStackWiring.createMcpDomainWiring({
      backend: McpBackendLive.createLiveMcpBackend({ override: McpBackendLive.createMcpServiceOverride(throwingReader()) }),
      audit: { record: (e) => Effect.sync(() => void audits.push(e)) },
    })
    const result = await wiring.ports.mcp.invoke(ctx("mcp.auth.status", { serverId: "srv" }))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") {
      expect(result.code).toBe("unavailable")
      // The underlying error (a path + a token) is NEVER surfaced (FR14).
      expect(result.message).not.toMatch(/\/(Users|home|tmp)\//)
      expect(result.message).not.toMatch(/sr_[a-z]+/)
    }
    expect(audits[0]?.outcome).toBe("unavailable")
    wiring.dispose()
  })

  test("mutating verbs stay typed gaps — a successful query for a mutates verb is never produced", async () => {
    // Any success here would hit the dispatcher's mutates→query rejection (the FR5 trap);
    // the backend must fail every mutation instead. Assert the DomainInvoke returns failure.
    const wiring = McpStackWiring.createMcpDomainWiring({
      backend: McpBackendLive.createLiveMcpBackend({ override: McpBackendLive.createMcpServiceOverride(fakeReader()) }),
    })
    for (const id of ["mcp.server.add", "mcp.server.connect", "mcp.auth.remove", "mcp.logging.level.set"]) {
      const result = await wiring.ports.mcp.invoke(ctx(id, { serverId: "srv", name: "srv", confirmed: true }))
      expect(result.kind).toBe("failure")
    }
    wiring.dispose()
  })
})

describe("T008 mcp service backend — full dispatcher pipeline (parity, no phantom write)", () => {
  function dispatcher(reader: McpHostReader) {
    const registry = createSeededOperatorCommandRegistry()
    const wiring = McpStackWiring.createMcpDomainWiring({
      backend: McpBackendLive.createLiveMcpBackend({ override: McpBackendLive.createMcpServiceOverride(reader) }),
    })
    const domainPorts = wireDomainPorts({ ...wiring.ports })
    return createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      handlers: handlersFromDomainPorts(domainPorts),
      defaultHandler: domainHandlerFor(domainPorts),
    })
  }

  test("a live read rides the pipeline to a success envelope", async () => {
    const result = await dispatcher(fakeReader()).dispatch(
      baseRequest({ id: "mcp.auth.status" as CommandRequest["id"], payload: { serverId: "srv_authed" } }),
    )
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
  })

  test("a live mutating verb degrades to a typed gap under the mutates contract — never invalid_argument phantom", async () => {
    const result = await dispatcher(fakeReader()).dispatch(
      baseRequest({
        id: "mcp.server.disconnect" as CommandRequest["id"],
        version: "1",
        idempotencyKey: "d-1",
        payload: { serverId: "srv" },
      }),
    )
    // The backend fails BEFORE any side effect, so the dispatcher never sees a successful
    // query for a mutates descriptor — the outcome is the honest gap, not the FR5 rejection.
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("unavailable")
  })
})
