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

// =============================================================================
// Feature 017 / T007-T010 — live server reads + mutation-plan conversion
// =============================================================================

const MCP_CONFIG_AUTHORITY = "global:mcp"
const MCP_CONNECTIONS_AUTHORITY = "global:mcp-connections"
const MCP_AUTH_AUTHORITY = "global:mcp-auth"

/** A live-server source double reflecting one connected + one failed configured server. */
function fakeServers(): McpBackendLive.McpLiveServerSource {
  return {
    statuses: async () => ({ srv_a: "connected", srv_b: "failed" }),
    clients: async () => ({ srv_a: { transportPresent: true, capabilitiesPresent: true } }),
  }
}

/** A live-actions double: `missing` is a not-found gap, every other id resolves an honest status. */
function fakeActions(): McpBackendLive.McpLiveActions {
  return {
    connect: async (id) => (id === "missing" ? { kind: "not_found" } : { kind: "ok", status: "connected" }),
    disconnect: async (id) => (id === "missing" ? { kind: "not_found" } : { kind: "ok", status: "disabled" }),
    reconnect: async (id) => (id === "missing" ? { kind: "not_found" } : { kind: "ok", status: "connected" }),
  }
}

interface McpHarnessDeps {
  readonly reader?: McpHostReader
  readonly servers?: McpBackendLive.McpLiveServerSource
  readonly actions?: McpBackendLive.McpLiveActions
  readonly authClear?: McpBackendLive.McpAuthClear
  readonly auth?: McpBackendLive.McpAuthDelegate
  readonly subscription?: McpBackendLive.McpSubscriptionClient
}

/** Compose the mcp domain over ONE shared `store.config` seam behind the real dispatcher (mirrors stack-live). */
function mcpHarness(deps: McpHarnessDeps = {}) {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  const mp: MutationPorts = {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
  const override = McpBackendLive.createMcpServiceOverride(deps.reader ?? fakeReader(), {
    servers: deps.servers,
    mutations: {
      config: store.config,
      actions: deps.actions,
      authClear: deps.authClear,
      auth: deps.auth,
      subscription: deps.subscription,
    },
  })
  const wiring = McpStackWiring.createMcpDomainWiring({
    backend: McpBackendLive.createLiveMcpBackend({ override }),
  })
  const domainPorts = wireDomainPorts({ ...wiring.ports })
  const dispatcher = createDispatcher({
    registry: createSeededOperatorCommandRegistry(),
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: store.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher, config: store.config, wiring }
}

/** Dispatch a project-scoped mcp mutating verb through the FULL Feature 007 pipeline. */
const mcpMutate = (
  dispatcher: ReturnType<typeof mcpHarness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  opts: { version?: string; source?: string } = {},
) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_17" },
      scope: { kind: "project", ref: "proj_17" },
      source: opts.source ?? "cli",
      payload,
      version: opts.version,
      idempotencyKey: `idem_${id}_${opts.version ?? "create"}_${Math.random().toString(36).slice(2)}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

describe("T007 — mcp.server.list/status/capabilities project the live host (no fabricated SSOT field)", () => {
  test("list reflects the real connection status + transport/capabilities presence", async () => {
    const { wiring } = mcpHarness({ servers: fakeServers() })
    const result = await wiring.ports.mcp.invoke(ctx("mcp.server.list"))
    expect(result.kind).toBe("query")
    if (result.kind !== "query") return
    const out = result.effective as { servers: ReadonlyArray<Record<string, unknown>> }
    const a = out.servers.find((s) => s.serverId === "srv_a")!
    const b = out.servers.find((s) => s.serverId === "srv_b")!
    expect(a).toEqual({ serverId: "srv_a", connectionStatus: "connected", transportPresent: true, capabilitiesPresent: true })
    expect(b).toEqual({ serverId: "srv_b", connectionStatus: "failed", transportPresent: false, capabilitiesPresent: false })
    // No SSOT-only field is fabricated (FR1, FR2).
    for (const s of out.servers) {
      for (const forbidden of ["version", "auditId", "trustProfile", "createdAt", "updatedAt"]) {
        expect(forbidden in s).toBe(false)
      }
    }
  })

  test("status projects one live server; an unknown id is honestly null", async () => {
    const { wiring } = mcpHarness({ servers: fakeServers() })
    const known = await wiring.ports.mcp.invoke(ctx("mcp.server.status", { id: "srv_a" }))
    if (known.kind === "query") expect((known.effective as { server: { connectionStatus: string } }).server.connectionStatus).toBe("connected")
    const unknown = await wiring.ports.mcp.invoke(ctx("mcp.server.status", { id: "srv_zzz" }))
    if (unknown.kind === "query") expect((unknown.effective as { server: unknown }).server).toBeNull()
  })

  test("an unbound live server source degrades to a typed mcp_unavailable, never a crash", async () => {
    const source: McpBackendLive.McpLiveServerSource = {
      statuses: () => Promise.reject(new Error("/Users/secret host down token=sr_x")),
      clients: async () => ({}),
    }
    const { wiring } = mcpHarness({ servers: source })
    const result = await wiring.ports.mcp.invoke(ctx("mcp.server.list"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") {
      expect(result.code).toBe("unavailable")
      expect(result.message).not.toMatch(/\/(Users|home|tmp)\//)
      expect(result.message).not.toMatch(/sr_[a-z]/)
    }
  })
})

describe("T008 — config-backed mcp mutations commit through mutateAuthority + round-trip", () => {
  test("mcp.server.add commits and a re-read of the config authority reflects the server", async () => {
    const { dispatcher, config } = mcpHarness()
    const added = await mcpMutate(dispatcher, "mcp.server.add", {
      name: "srv_new",
      transportKind: "streamable-http",
      endpoint: "https://mcp.example.test",
    })
    expect(added.ok).toBe(true)
    expect(added.outcome).toBe("success")
    const doc = (await config.get(MCP_CONFIG_AUTHORITY))!.payload as { servers: Record<string, { transportKind: string; enabled: boolean }> }
    expect(doc.servers.srv_new).toMatchObject({ transportKind: "streamable-http", enabled: true })
  })

  test("mcp.logging.level.set round-trips under CAS onto an existing server", async () => {
    const { dispatcher, config } = mcpHarness()
    const added = await mcpMutate(dispatcher, "mcp.server.add", { name: "srv_new", transportKind: "stdio", endpoint: "opencode" })
    const set = await mcpMutate(dispatcher, "mcp.logging.level.set", { serverId: "srv_new", level: "warning" }, { version: added.version })
    expect(set.ok).toBe(true)
    const doc = (await config.get(MCP_CONFIG_AUTHORITY))!.payload as { servers: Record<string, { loggingLevel: string }> }
    expect(doc.servers.srv_new.loggingLevel).toBe("warning")
  })

  test("mcp.experimental.enable adds the flag to the persisted server entry", async () => {
    const { dispatcher, config } = mcpHarness()
    const added = await mcpMutate(dispatcher, "mcp.server.add", { name: "srv_new", transportKind: "stdio", endpoint: "opencode" })
    const en = await mcpMutate(dispatcher, "mcp.experimental.enable", { serverId: "srv_new", flag: "tasks", confirmed: true }, { version: added.version })
    expect(en.ok).toBe(true)
    const doc = (await config.get(MCP_CONFIG_AUTHORITY))!.payload as { servers: Record<string, { experimental: string[] }> }
    expect(doc.servers.srv_new.experimental).toEqual(["tasks"])
  })
})

describe("T008 — no phantom write: a rejected config-backed mutation persists NOTHING (FR5)", () => {
  test("an invalid transportKind is rejected at plan time and writes nothing", async () => {
    const { dispatcher, config } = mcpHarness()
    // The latent TUI bug: `streamable_http` (underscore) is NOT a valid TransportKind member.
    const result = await mcpMutate(dispatcher, "mcp.server.add", {
      name: "srv_bad",
      transportKind: "streamable_http",
      endpoint: "https://mcp.example.test",
    })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("invalid_argument")
    expect(await config.get(MCP_CONFIG_AUTHORITY)).toBeNull()
  })

  test("the hyphenated streamable-http member IS accepted (transportKind validity pin)", async () => {
    const { dispatcher } = mcpHarness()
    const ok = await mcpMutate(dispatcher, "mcp.server.add", {
      name: "srv_ok",
      transportKind: "streamable-http",
      endpoint: "https://mcp.example.test",
    })
    expect(ok.ok).toBe(true)
  })

  test("mcp.logging.level.set on an absent server is a typed not_found with no phantom write", async () => {
    const { dispatcher, config } = mcpHarness()
    const result = await mcpMutate(dispatcher, "mcp.logging.level.set", { serverId: "srv_absent", level: "info" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("invalid_argument")
    expect(await config.get(MCP_CONFIG_AUTHORITY)).toBeNull()
  })
})

describe("T009 — live-service action plans (connect/disconnect/reconnect)", () => {
  test("mcp.server.connect performs the live op and records the resulting status", async () => {
    const { dispatcher, config } = mcpHarness({ actions: fakeActions() })
    const result = await mcpMutate(dispatcher, "mcp.server.connect", { serverId: "srv_a" })
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
    const doc = (await config.get(MCP_CONNECTIONS_AUTHORITY))!.payload as Record<string, { action: string; status: string }>
    expect(doc.srv_a).toMatchObject({ action: "connect", status: "connected" })
  })

  test("mcp.server.disconnect records a disabled status under the store-scoped authority", async () => {
    const { dispatcher, config } = mcpHarness({ actions: fakeActions() })
    const result = await mcpMutate(dispatcher, "mcp.server.disconnect", { serverId: "srv_a", confirmed: true })
    expect(result.ok).toBe(true)
    const doc = (await config.get(MCP_CONNECTIONS_AUTHORITY))!.payload as Record<string, { status: string }>
    expect(doc.srv_a.status).toBe("disabled")
  })

  test("a not-found live action fails BEFORE any write (no phantom write, FR4)", async () => {
    const { dispatcher, config } = mcpHarness({ actions: fakeActions() })
    const result = await mcpMutate(dispatcher, "mcp.server.connect", { serverId: "missing" })
    expect(result.ok).toBe(false)
    expect(await config.get(MCP_CONNECTIONS_AUTHORITY)).toBeNull()
  })

  test("an unbound live service leaves connect a typed mcp_unavailable gap", async () => {
    const { dispatcher } = mcpHarness() // no actions wired
    const result = await mcpMutate(dispatcher, "mcp.server.connect", { serverId: "srv_a" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})

describe("T010 — auth split: remove converts to a mutation, start/finish stay typed gaps", () => {
  test("mcp.auth.remove performs the local credential clear and records the outcome", async () => {
    const cleared: string[] = []
    const authClear: McpBackendLive.McpAuthClear = { remove: async (id) => void cleared.push(id) }
    const { dispatcher, config } = mcpHarness({ authClear })
    const result = await mcpMutate(dispatcher, "mcp.auth.remove", { serverId: "srv_a", confirmed: true })
    expect(result.ok).toBe(true)
    expect(cleared).toEqual(["srv_a"])
    const doc = (await config.get(MCP_AUTH_AUTHORITY))!.payload as Record<string, { action: string }>
    expect(doc.srv_a.action).toBe("remove")
  })

  test("mcp.auth.start stays a typed capability gap (headless OAuth cannot run through the loopback)", async () => {
    const { wiring } = mcpHarness({ authClear: { remove: async () => {} } })
    const result = await wiring.ports.mcp.invoke(ctx("mcp.auth.start", { serverId: "srv_a" }))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("unavailable")
  })
})

// =============================================================================
// Feature 019 / T010 (FR8) — interactive-OAuth auth delegation vs headless gap
// =============================================================================

/** A live-OAuth delegate double: `start` returns a non-secret authorize URL + a CSRF nonce; `finish` completes. */
function fakeAuthDelegate(overrides: Partial<McpBackendLive.McpAuthDelegate> = {}): McpBackendLive.McpAuthDelegate {
  return {
    start: async (serverId) =>
      serverId === "missing"
        ? { kind: "not_found" }
        : { kind: "ok", authorizationUrl: "https://auth.example.test/authorize?client_id=abc", oauthState: "st_secret_nonce" },
    finish: async (serverId, input) =>
      serverId === "missing"
        ? { kind: "not_found" }
        : input.oauthState === "mismatch"
          ? { kind: "state_mismatch" }
          : { kind: "ok", status: "connected" },
    ...overrides,
  }
}

describe("Feature 019 T010 — mcp.auth.start/finish delegate for the interactive TUI (FR8)", () => {
  test("an interactive TUI surface delegates start and returns the authorize URL — no secret in the envelope", async () => {
    const { dispatcher } = mcpHarness({ auth: fakeAuthDelegate() })
    const result = await mcpMutate(dispatcher, "mcp.auth.start", { serverId: "srv_a" }, { source: "palette" })
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
    const eff = result.effective as { serverId: string; delegation: string; authorizationUrl: string }
    expect(eff.delegation).toBe("interactive_delegated")
    expect(eff.authorizationUrl).toBe("https://auth.example.test/authorize?client_id=abc")
    // The authorize URL is not a secret; NO token, code, verifier, or oauthState crosses the envelope.
    const serialized = JSON.stringify(result.effective)
    for (const forbidden of ["oauthState", "st_secret_nonce", "code_verifier", "access_token", "secret", "token"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("a headless surface (cli) keeps the exact typed capability gap — never delegates", async () => {
    const { dispatcher } = mcpHarness({ auth: fakeAuthDelegate() })
    const result = await mcpMutate(dispatcher, "mcp.auth.start", { serverId: "srv_a" }, { source: "cli" })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("unavailable")
  })

  test("an interactive slash surface completes the exchange via finish", async () => {
    const { dispatcher } = mcpHarness({ auth: fakeAuthDelegate() })
    const result = await mcpMutate(
      dispatcher,
      "mcp.auth.finish",
      { serverId: "srv_a", oauthState: "st_secret_nonce", callbackParams: "code=abc&state=st_secret_nonce" },
      { source: "slash" },
    )
    expect(result.ok).toBe(true)
    const eff = result.effective as { serverId: string; delegation: string; status: string }
    expect(eff.delegation).toBe("interactive_delegated")
    expect(eff.status).toBe("connected")
  })

  test("a state mismatch surfaces a typed conflict, never a completed exchange", async () => {
    const { dispatcher } = mcpHarness({ auth: fakeAuthDelegate() })
    const result = await mcpMutate(
      dispatcher,
      "mcp.auth.finish",
      { serverId: "srv_a", oauthState: "mismatch", callbackParams: "code=abc&state=other" },
      { source: "palette" },
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("conflict")
  })

  test("an unbound auth delegate on an interactive surface is a typed mcp_unavailable gap", async () => {
    const { dispatcher } = mcpHarness() // no auth delegate wired
    const result = await mcpMutate(dispatcher, "mcp.auth.start", { serverId: "srv_a" }, { source: "palette" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})

// =============================================================================
// Feature 019 / T011 (FR9) — resource subscribe/unsubscribe over the live client
// =============================================================================

/** A subscribe-capable client double; `absent` lacks the capability, `nolink` has no connected client. */
function fakeSubscriptionClient(spy: { calls: string[] }): McpBackendLive.McpSubscriptionClient {
  return {
    capability: async (serverId) =>
      serverId === "absent"
        ? { kind: "capability_absent" }
        : serverId === "nolink"
          ? { kind: "no_client" }
          : { kind: "capable" },
    subscribe: async (serverId, uri) => void spy.calls.push(`sub:${serverId}:${uri}`),
    unsubscribe: async (serverId, uri) => void spy.calls.push(`unsub:${serverId}:${uri}`),
  }
}

describe("Feature 019 T011 — mcp.resource.admin.subscribe/unsubscribe over the dual-authority machine (FR9)", () => {
  test("a capable server drives the live subscribe exactly once and reports the subscribed state", async () => {
    const spy = { calls: [] as string[] }
    const { dispatcher } = mcpHarness({ subscription: fakeSubscriptionClient(spy) })
    const result = await mcpMutate(dispatcher, "mcp.resource.admin.subscribe", { serverId: "srv_a", uri: "mcp://srv/doc.md" })
    expect(result.ok).toBe(true)
    const eff = result.effective as { serverId: string; resourceUri: string; state: string }
    expect(eff.state).toBe("subscribed")
    expect(eff.resourceUri).toBe("mcp://srv/doc.md")
    expect(spy.calls).toEqual(["sub:srv_a:mcp://srv/doc.md"])
  })

  test("unsubscribe drives the live unsubscribe once and reports the unsubscribed state", async () => {
    const spy = { calls: [] as string[] }
    const { dispatcher } = mcpHarness({ subscription: fakeSubscriptionClient(spy) })
    const result = await mcpMutate(dispatcher, "mcp.resource.admin.unsubscribe", { serverId: "srv_a", uri: "mcp://srv/doc.md" })
    expect(result.ok).toBe(true)
    expect((result.effective as { state: string }).state).toBe("unsubscribed")
    expect(spy.calls).toEqual(["unsub:srv_a:mcp://srv/doc.md"])
  })

  test("a server without the subscribe capability fails closed (capability_absent) — no phantom subscription", async () => {
    const spy = { calls: [] as string[] }
    const { dispatcher } = mcpHarness({ subscription: fakeSubscriptionClient(spy) })
    const result = await mcpMutate(dispatcher, "mcp.resource.admin.subscribe", { serverId: "absent", uri: "mcp://srv/doc.md" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("invalid_argument")
    expect(JSON.stringify(result.error)).toContain("capability_absent")
    expect(spy.calls).toEqual([]) // no live subscribe attempted
  })

  test("no connected client is a typed unavailable, never a fabricated subscription", async () => {
    const spy = { calls: [] as string[] }
    const { dispatcher } = mcpHarness({ subscription: fakeSubscriptionClient(spy) })
    const result = await mcpMutate(dispatcher, "mcp.resource.admin.subscribe", { serverId: "nolink", uri: "mcp://srv/doc.md" })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("unavailable")
    expect(spy.calls).toEqual([])
  })

  test("an unbound subscription client is a typed mcp_unavailable gap", async () => {
    const { dispatcher } = mcpHarness() // no subscription client wired
    const result = await mcpMutate(dispatcher, "mcp.resource.admin.subscribe", { serverId: "srv_a", uri: "mcp://srv/doc.md" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})

// =============================================================================
// Feature 019 T012 (FR10) — truthful Experimental/Extension badges from config SSOT
// =============================================================================

describe("Feature 019 T012 — mcp status carries config-backed experimental/extension flag state (FR10)", () => {
  test("experimental.status projects the config-backed flag SSOT so badges render truthfully", async () => {
    const { dispatcher, wiring } = mcpHarness()
    const added = await mcpMutate(dispatcher, "mcp.server.add", { name: "srv_x", transportKind: "stdio", endpoint: "opencode" })
    await mcpMutate(dispatcher, "mcp.experimental.enable", { serverId: "srv_x", flag: "tasks", confirmed: true }, { version: added.version })
    const status = await wiring.ports.mcp.invoke(ctx("mcp.experimental.status", { serverId: "srv_x" }))
    expect(status.kind).toBe("query")
    if (status.kind !== "query") return
    const out = status.effective as { enabled: boolean; flags: ReadonlyArray<{ flag: string; enabled: boolean }> }
    // The aggregate `enabled` (the default `tasks` flag) is the boolean the toggle row reads.
    expect(out.enabled).toBe(true)
    expect(out.flags.find((f) => f.flag === "tasks")?.enabled).toBe(true)
    expect(out.flags.find((f) => f.flag === "sampling")?.enabled).toBe(false)
  })

  test("extension.status projects the config-backed enabled flag truthfully", async () => {
    const { dispatcher, wiring } = mcpHarness()
    const added = await mcpMutate(dispatcher, "mcp.server.add", { name: "srv_x", transportKind: "stdio", endpoint: "opencode" })
    await mcpMutate(dispatcher, "mcp.extension.enable", { serverId: "srv_x", confirmed: true }, { version: added.version })
    const status = await wiring.ports.mcp.invoke(ctx("mcp.extension.status", { serverId: "srv_x" }))
    if (status.kind === "query") expect((status.effective as { enabled: boolean }).enabled).toBe(true)
  })

  test("a configured-but-unset server renders Disabled (enabled:false), not Unknown", async () => {
    const { dispatcher, wiring } = mcpHarness()
    await mcpMutate(dispatcher, "mcp.server.add", { name: "srv_y", transportKind: "stdio", endpoint: "opencode" })
    const status = await wiring.ports.mcp.invoke(ctx("mcp.experimental.status", { serverId: "srv_y" }))
    if (status.kind === "query") expect((status.effective as { enabled: boolean }).enabled).toBe(false)
  })

  test("a genuinely absent server carries NO aggregate enabled — the honest Unknown baseline", async () => {
    const { wiring } = mcpHarness()
    const experimental = await wiring.ports.mcp.invoke(ctx("mcp.experimental.status", { serverId: "srv_absent" }))
    if (experimental.kind === "query") expect("enabled" in (experimental.effective as object)).toBe(false)
    const extension = await wiring.ports.mcp.invoke(ctx("mcp.extension.status", { serverId: "srv_absent" }))
    if (extension.kind === "query") expect("enabled" in (extension.effective as object)).toBe(false)
  })
})
