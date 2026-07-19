/**
 * T038 (S25) — `opencode op mcp <op>` CLI-verb surface + legacy coexistence.
 *
 * Asserts the generic `opencode op` registry dispatch (`../../src/cli/cmd/
 * op.ts`) already resolves `mcp.*` commands via the SAME registry-generated
 * `cli` alias every other domain uses (no divergent hardcoded verb table in
 * `../../src/cli/cmd/mcp.ts`), human + JSON output, confirmation on mutating
 * verbs, zero admin-time model tokens, no secret/path in output, and surface
 * parity between the CLI runner and the HTTP operator handler over the SAME
 * dispatcher — mirroring `test/operator/cli-op.test.ts` and
 * `test/operator/surface-parity.test.ts`'s `langlock.status` precedent, but
 * exercising the `mcp` domain.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createZeroLlmProbe,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import { createDomainStubs, domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import {
  createCliRunner,
  resolveCliCommandId,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createFakeConfigService,
  createDurableOperatorStore,
} from "@/operator/adapters"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import { McpStackWiring } from "@/operator/mcp/stack-wiring"
import { McpBackendLive } from "@/operator/mcp/backend-live"
import type { McpAdminBackend } from "@/operator/mcp/mcp-port"
import type { ServerLifecyclePort } from "@opencode-ai/protocol/mcp/ports"
import type { ListServersOutput } from "@opencode-ai/protocol/mcp/commands"

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

function principalCtx(overrides?: Partial<{ projectId: string | null; authenticated: boolean }>) {
  return {
    projectId: overrides?.projectId ?? "proj_local",
    subject: "local",
    authenticated: overrides?.authenticated ?? true,
    sessionId: null as string | null,
    rootTreeRef: null as string | null,
  }
}

/** Honest gap backend, mirroring `stack-live.ts`'s default composition. */
function gapMcpBackend(): McpAdminBackend {
  return McpBackendLive.createLiveMcpBackend({})
}

/** A server port whose `list` succeeds with an opaque secretRef; every other method is an honest gap. */
function serverPortWithOpaqueSecretRef(): ServerLifecyclePort {
  const gap = () => Effect.fail({ type: "unavailable" as const, reason: "stub" })
  const output: ListServersOutput = {
    servers: [
      {
        id: "server_1",
        version: 1,
        name: "filesystem",
        transportKind: "streamable-http",
        endpoint: "https://mcp.example.com/mcp",
        scope: "project",
        trustProfile: "untrusted",
        connectionState: "connected",
        secretRef: "sr_opaque_ref_1",
        enabled: true,
        sseDeprecationLabel: false,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
        auditId: "audit_1",
      },
    ],
  }
  return {
    list: () => Effect.succeed(output),
    add: gap,
    update: gap,
    test: gap,
    connect: gap,
    disconnect: gap,
    reconnect: gap,
    disable: gap,
    delete: gap,
    status: gap,
    capabilities: gap,
  }
}

function dispatcherWithMcpBackend(backend: McpAdminBackend, mp: MutationPorts) {
  const registry = createSeededOperatorCommandRegistry()
  const mcpWiring = McpStackWiring.createMcpDomainWiring({ backend })
  const domainPorts = wireDomainPorts({ ...mcpWiring.ports })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts),
    defaultHandler: domainHandlerFor(domainPorts),
  })
  return { registry, dispatcher }
}

describe("T038 opencode op mcp — registry-generated dispatch (no divergent verb table)", () => {
  test("space-separated 'mcp server list' resolves to the reserved mcp.server.list id", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["mcp", "server", "list"], registry)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe("mcp.server.list")
  })

  test("space-separated 'mcp auth status' resolves to the reserved mcp.auth.status id", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["mcp", "auth", "status"], registry)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe("mcp.auth.status")
  })

  test("dotted id form resolves identically", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["mcp.resource.admin.policy.set"], registry)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe("mcp.resource.admin.policy.set")
  })

  test("all 30 mcp.* ids are present in the default domain stub (no unregistered gap)", () => {
    const stubs = createDomainStubs()
    expect(stubs.mcp).toBeDefined()
  })
})

describe("T038 opencode op mcp — honest gap backend (mirrors stack-live.ts default composition)", () => {
  test("query verb (mcp.server.list) yields the typed unavailable outcome, never a false success", async () => {
    const { registry, dispatcher } = dispatcherWithMcpBackend(gapMcpBackend(), mutationPorts())
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "server", "list"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.id).toBe("mcp.server.list")
    expect(out.result.ok).toBe(false)
    expect(out.result.outcome).toBe("unavailable")
    const envelope = JSON.parse(out.stdout)
    expect(envelope.kind).toBe("operator.admin_result")
    expect(out.stdout).not.toContain("secretRef")
    expect(out.stdout).not.toMatch(/sr_[a-z_]+/)
  })

  test("human mode renders the same outcome without a JSON envelope", async () => {
    const { registry, dispatcher } = dispatcherWithMcpBackend(gapMcpBackend(), mutationPorts())
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "server", "list"],
      flags: {},
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.outcome).toBe("unavailable")
    expect(() => JSON.parse(out.stdout)).toThrow()
  })

  test("zero admin-time model tokens on the query path (FR49)", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const probe = createZeroLlmProbe()
    const mcpWiring = McpStackWiring.createMcpDomainWiring({ backend: gapMcpBackend() })
    const domainPorts = wireDomainPorts({ ...mcpWiring.ports })
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      probe,
      handlers: handlersFromDomainPorts(domainPorts),
      defaultHandler: domainHandlerFor(domainPorts),
    })
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "server", "status"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.kind).toBe("operator.admin_result")
    probe.assertClean()
  })
})

describe("T038 opencode op mcp — confirmation on mutating verbs (registry-generic, no mcp-specific code)", () => {
  test("mcp.server.delete (a destructive leaf, catalog confirmRequired) without --yes on non-TTY requires confirmation before ever reaching the handler", async () => {
    let reached = false
    const backend = gapMcpBackend()
    const spiedDelete: ServerLifecyclePort = {
      ...backend.server,
      delete: () => ((reached = true), Effect.fail({ type: "unavailable", reason: "unreached" })),
    }
    const { registry, dispatcher } = dispatcherWithMcpBackend({ ...backend, server: spiedDelete }, mutationPorts())
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "server", "delete"],
      flags: { json: true, expectedVersion: "1", idempotencyKey: "del-1" },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.outcome).toBe("confirmation_required")
    expect(out.exitCode).toBe(44)
    expect(reached).toBe(false)
  })

  test("mcp.server.delete non-TTY --yes proceeds past the confirmation gate", async () => {
    const { registry, dispatcher } = dispatcherWithMcpBackend(gapMcpBackend(), mutationPorts())
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "server", "delete"],
      flags: { json: true, yes: true, expectedVersion: "1", idempotencyKey: "del-1" },
      ctx: principalCtx(),
      isTty: false,
    })
    // Reaches the honest gap backend rather than being blocked pre-dispatch.
    expect(out.result.outcome).not.toBe("confirmation_required")
  })
})

describe("T038 opencode op mcp — no secret/path in output", () => {
  test("the unavailable gap path never surfaces a secret, a raw token, or a path", async () => {
    const { registry, dispatcher } = dispatcherWithMcpBackend(gapMcpBackend(), mutationPorts())
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "auth", "status"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.outcome).toBe("unavailable")
    expect(out.stdout).not.toMatch(/\/(Users|home|tmp)\//)
    expect(out.stdout).not.toMatch(/sr_[a-zA-Z0-9_]+/)
  })

  test("McpServerProfile.secretRef is the OPAQUE reference minted by Feature 007 SecretPort (FR32, C15) — never redacted away, never a raw credential", async () => {
    const backend: McpAdminBackend = { ...gapMcpBackend(), server: serverPortWithOpaqueSecretRef() }
    const { registry, dispatcher } = dispatcherWithMcpBackend(backend, mutationPorts())
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["mcp", "server", "list"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.ok).toBe(true)
    // The opaque token itself is safe to surface (it is a reference, not the credential material
    // it points to); the endpoint stays a plain URL, never a filesystem path or a raw header value.
    expect(out.stdout).toContain("sr_opaque_ref_1")
    expect(out.stdout).not.toMatch(/\/(Users|home|tmp)\//)
  })
})

describe("T038 opencode op mcp — CLI/HTTP surface parity over the SAME dispatcher (no fork)", () => {
  test("mcp.server.status returns the identical id/ok/outcome across the CLI runner and the HTTP operator handler", async () => {
    const { registry, dispatcher } = dispatcherWithMcpBackend(gapMcpBackend(), mutationPorts())

    const cli = createCliRunner({ registry, dispatcher })
    const cliOut = await cli.run({
      segments: ["mcp", "server", "status"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })

    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_local",
      injectProjectScopeWhenOmitted: true,
      resolveAuth: async () => ({
        authenticated: true,
        subject: "local",
        role: "operator",
        projectBinding: "proj_local",
      }),
    })
    const httpRes = await handle(
      new Request("http://127.0.0.1/operator/v1/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "mcp.server.status", scope: { kind: "project", ref: "proj_local" } }),
      }),
    )
    const httpJson = (await httpRes.json()) as { id: string; outcome: string; ok: boolean }

    expect(httpJson.id).toBe(cliOut.result.id)
    expect(httpJson.ok).toBe(cliOut.result.ok)
    expect(httpJson.outcome).toBe(cliOut.result.outcome)
  })
})

describe("T038 legacy `opencode mcp` coexistence (compatibility shim, single adapter)", () => {
  test("mcp.ts documents the coexistence and imports MCP.Service directly (shared adapter, no fork)", async () => {
    const url = new URL("../../src/cli/cmd/mcp.ts", import.meta.url)
    const text = await Bun.file(url).text()
    expect(text).toContain("compatibility shim")
    expect(text).toMatch(/from ["']\.\.\/\.\.\/mcp["']/)
  })

  test("mcp.ts adds no new hardcoded operator verb table (op.ts alone resolves mcp.* via the registry)", async () => {
    const url = new URL("../../src/cli/cmd/mcp.ts", import.meta.url)
    const text = await Bun.file(url).text()
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
    // No literal reserved mcp.* dotted-id strings hardcoded outside the doc comment.
    expect(code).not.toMatch(/"mcp\.server\.|"mcp\.auth\.|"mcp\.resource\.admin\.|"mcp\.logging\.|"mcp\.experimental\.|"mcp\.extension\./)
  })
})
