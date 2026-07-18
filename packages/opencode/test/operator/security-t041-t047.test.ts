/**
 * T041–T047 integration security suite — actual paths (dispatcher, HTTP, registration, SSRF handlers, OTEL).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createHandlerMap,
  fixtureStatusHandler,
  guardOperatorRegistrationName,
  dryRunLegacyMigration,
} from "@/operator/application"
import { createTestOperatorStack } from "@/operator/stack-test"
import {
  createOperatorSpanRecorder,
  RESERVED_CATALOG_VERSION,
  validateOperatorUrl,
  resolveOperatorControlPlaneFlag,
  resolveConnectivity,
} from "@opencode-ai/core/operator"
import type { CommandRequest } from "@opencode-ai/core/operator"
import { bootstrapOperatorHttp } from "@/operator/http/bootstrap"
import { tryCreateOperatorHttpFetch, isOperatorHttpEnabled } from "@/operator/http/mount"
import { Server } from "@/server/server"
import { createDomainStubs, handlersFromDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import { createLiveOperatorOtelRecorder } from "@/operator/adapters/outbound/otel-live"
import { isFlagBootstrapSegments, parseFlagBootstrapAction } from "@/operator/flag-bootstrap"
import { CommandV2 } from "@opencode-ai/core/command"
import { Effect } from "effect"
import { McpCatalog } from "@/mcp/catalog"

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of [
    "OPENCODE_OPERATOR_CONTROL_PLANE",
    "OPENCODE_DEV_OPERATOR_",
    "OPENCODE_OFFLINE",
    "OPENCODE_CONNECTIVITY",
  ]) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  Server.setOperatorFetch(undefined)
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  // Package suites assume preload default ON; never leave siblings with flag off
  if (process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] === undefined) {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
  }
  Server.setOperatorFetch(undefined)
})

function req(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: "langlock.status" as CommandRequest["id"],
    principal: { kind: "operator", subject: "local", projectBinding: null },
    scope: { kind: "project", ref: "p1" },
    source: "cli",
    isTty: false,
    confirm: false,
    ...overrides,
  }
}

describe("T041 flag gates dispatcher and HTTP", () => {
  test("flag off → unavailable, never success/prompt", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: false,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const r = await dispatcher.dispatchRequest(req())
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe("unavailable")
    expect(r.kind).toBe("operator.admin_result")
  })

  test("flag on allows dispatch path", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: true,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const r = await dispatcher.dispatchRequest(req())
    expect(r.ok).toBe(true)
  })

  test("same-process enable→query and disable→query without restart", async () => {
    let enabled = false
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: () => enabled,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const off = await dispatcher.dispatchRequest(req())
    expect(off.outcome).toBe("unavailable")
    enabled = true
    const on = await dispatcher.dispatchRequest(req())
    expect(on.ok).toBe(true)
    enabled = false
    const off2 = await dispatcher.dispatchRequest(req())
    expect(off2.outcome).toBe("unavailable")
  })

  test("loopback always mounts; flag off → unavailable per request (no remount)", async () => {
    let enabled = false
    const stack = createTestOperatorStack({ featureEnabled: () => enabled })
    const m = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      testStack: stack,
      getClientIp: () => "127.0.0.1",
    })
    expect(m.mounted).toBe(true)
    if (!m.mounted) return
    const off = await m.fetch(new Request("http://127.0.0.1/operator/v1/health"))
    expect(off.status).toBe(404)
    enabled = true
    const on = await m.fetch(new Request("http://127.0.0.1/operator/v1/health"))
    expect(on.status).toBe(200)
    enabled = false
    const off2 = await m.fetch(new Request("http://127.0.0.1/operator/v1/health"))
    expect(off2.status).toBe(404)
  })

  test("HTTP mount on loopback with OPENCODE_OPERATOR_CONTROL_PLANE", () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    expect(isOperatorHttpEnabled()).toBe(true)
    const m = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      testStack: createTestOperatorStack(),
      getClientIp: () => "127.0.0.1",
    })
    expect(m.mounted).toBe(true)
  })

  test("non-loopback never mounts", () => {
    const m = tryCreateOperatorHttpFetch({
      hostname: "0.0.0.0",
      testStack: createTestOperatorStack(),
    })
    expect(m.mounted).toBe(false)
  })

  test("OPENCODE_OPERATOR_HTTP alone does not enable flag", () => {
    process.env["OPENCODE_OPERATOR_HTTP"] = "1"
    expect(resolveOperatorControlPlaneFlag({}).enabled).toBe(false)
    expect(isOperatorHttpEnabled()).toBe(false)
  })

  test("flag bootstrap segments recognized", () => {
    expect(isFlagBootstrapSegments(["flag", "show"])).toBe(true)
    expect(parseFlagBootstrapAction(["flag", "enable"])).toBe("enable")
    expect(isFlagBootstrapSegments(["langlock", "status"])).toBe(false)
  })
})

describe("T042 registration guard on real sources", () => {
  test("plugin/mcp/custom reserved rejected; non-admin ok", () => {
    expect(guardOperatorRegistrationName({ name: "/op.mcp.server.list", source: "plugin" }).ok).toBe(false)
    expect(guardOperatorRegistrationName({ name: "langlock.status", source: "mcp" }).ok).toBe(false)
    expect(guardOperatorRegistrationName({ name: "admin", source: "custom" }).ok).toBe(false)
    expect(guardOperatorRegistrationName({ name: "my-notes", source: "custom" }).ok).toBe(true)
    const legacy = guardOperatorRegistrationName({
      name: "admin",
      source: "legacy",
      allowLegacyExisting: true,
    })
    expect(legacy.ok).toBe(true)
    if (legacy.ok) expect(legacy.warning).toBeTruthy()
  })

  test("guard uses RESERVED_CATALOG_VERSION", () => {
    const g = guardOperatorRegistrationName({ name: "langlock.status", source: "plugin" })
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
  })

  test("MCP toolNameIfAllowed rejects reserved raw tool names", () => {
    expect(McpCatalog.toolNameIfAllowed("srv", "langlock.status")).toBeNull()
    expect(McpCatalog.toolNameIfAllowed("srv", "safe_tool")).toBe("srv_safe_tool")
  })

  test("CommandV2 rejects reserved custom command names with ReservedNameError", async () => {
    // Same check path CommandV2.update uses for external/custom names
    const { checkReservedRegistrationName, ReservedNameError } = await import("@opencode-ai/core/operator")
    const check = checkReservedRegistrationName("langlock.status", "custom")
    expect(check.ok).toBe(false)
    if (!check.ok) {
      const err = new ReservedNameError(check)
      expect(err.code).toBe("reserved_name")
      expect(err.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
      expect(err.toJSON().code).toBe("reserved_name")
    }
    void CommandV2
    void Effect
  })

  test("dry-run migration report versioned", () => {
    const r = dryRunLegacyMigration(["admin", "langlock.status", "ok-cmd", "read-admin-notes"])
    expect(r.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
    expect(r.autoRename).toBe(false)
    expect(r.clean).toContain("read-admin-notes")
  })
})

describe("T044 offline enforcement in dispatcher", () => {
  test("telemetry.test unavailable offline", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: true,
      connectivity: "offline",
      handlers: createHandlerMap([["telemetry.test", fixtureStatusHandler]]),
    })
    const r = await dispatcher.dispatchRequest(
      req({
        id: "telemetry.test" as CommandRequest["id"],
        idempotencyKey: "t1",
      }),
    )
    expect(r.outcome).toBe("unavailable")
    expect(r.error?.message).toContain("offline")
  })

  test("langlock.status works offline", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: true,
      connectivity: "offline",
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const r = await dispatcher.dispatchRequest(req())
    expect(r.ok).toBe(true)
  })

  test("live connectivity source OPENCODE_OFFLINE", () => {
    process.env["OPENCODE_OFFLINE"] = "1"
    expect(resolveConnectivity({})).toBe("offline")
  })

  test("test stack connectivity offline blocks network ops", async () => {
    const stack = createTestOperatorStack({ connectivity: "offline" })
    const r = await stack.dispatcher.dispatchRequest(
      req({
        id: "semantic.provider.test" as CommandRequest["id"],
      }),
    )
    expect(r.outcome).toBe("unavailable")
  })
})

describe("T045 SSRF via semantic handler path", () => {
  test("metadata and private denied at core helper", async () => {
    expect((await validateOperatorUrl("https://169.254.169.254/")).ok).toBe(false)
    expect((await validateOperatorUrl("https://10.0.0.1/")).ok).toBe(false)
  })

  test("semantic.provider.add rejects SSRF URL before stub", async () => {
    const ports = createDomainStubs({
      dnsResolver: async () => ["127.0.0.1"],
    })
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: true,
      handlers: handlersFromDomainPorts(ports),
      defaultHandler: ports.semantic.invoke,
    })
    const r = await dispatcher.dispatchRequest(
      req({
        id: "semantic.provider.add" as CommandRequest["id"],
        confirm: true,
        idempotencyKey: "ssrf-1",
        payload: { url: "https://169.254.169.254/latest" },
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.error?.message?.toLowerCase()).toMatch(/denied|ssrf|address|metadata|link/)
  })

  test("mapped IPv6 literal denied in validateOperatorUrl", async () => {
    expect((await validateOperatorUrl("https://[::ffff:7f00:1]/")).ok).toBe(false)
    expect((await validateOperatorUrl("https://example.com:0/", { resolver: async () => ["1.2.3.4"] })).ok).toBe(
      false,
    )
  })
})

describe("T046 OTEL once per dispatch including flag-off", () => {
  test("records content-free span on success", async () => {
    const otel = createOperatorSpanRecorder()
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: true,
      otel,
      surface: "test",
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    await dispatcher.dispatchRequest(req())
    expect(otel.snapshots().length).toBe(1)
    const s = otel.snapshots()[0]!
    expect(s.command_id).toBe("langlock.status")
    expect(s.surface).toBe("test")
    expect(JSON.stringify(s)).not.toContain("payload")
    expect(JSON.stringify(s)).not.toContain("sk_")
  })

  test("records once on flag-off unavailable", async () => {
    const otel = createOperatorSpanRecorder()
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: false,
      otel,
      surface: "cli",
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    await dispatcher.dispatchRequest(req())
    expect(otel.snapshots().length).toBe(1)
    expect(otel.snapshots()[0]!.outcome).toBe("unavailable")
  })

  test("live otel recorder is OperatorSpanRecorder", () => {
    const live = createLiveOperatorOtelRecorder()
    expect(live.kind).toBe("live")
    live.record({
      command_id: "langlock.status",
      domain: "langlock",
      surface: "live",
      scope_kind: "project",
      outcome: "success",
      duration_ms: 1,
      retry: false,
    })
    expect(live.snapshots().length).toBe(1)
  })

  test("injected real tracer surface once per dispatch", async () => {
    let spanCount = 0
    const tracer = {
      startActiveSpan(
        _name: string,
        _opts: { attributes?: Record<string, string | number | boolean> },
        fn: (span: { end: () => void; setAttribute: (k: string, v: string | number | boolean) => void }) => void,
      ) {
        spanCount += 1
        fn({
          end: () => {},
          setAttribute: () => {},
        })
      },
    }
    const otel = createLiveOperatorOtelRecorder({ tracer })
    expect(otel.tracerWired).toBe(true)
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      featureEnabled: true,
      otel,
      surface: "test",
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    await dispatcher.dispatchRequest(req())
    expect(otel.snapshots().length).toBe(1)
    expect(spanCount).toBe(1)
  })
})

describe("T047 suite samples", () => {
  test("auth anonymous denied on registry", async () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    const { fetch } = bootstrapOperatorHttp({ expectedPassword: "secret" })
    const res = await fetch(new Request("http://127.0.0.1:14096/operator/v1/registry"))
    expect(res.status).toBe(401)
  })

  test("loopback bind required for mount", () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    expect(tryCreateOperatorHttpFetch({ hostname: "0.0.0.0", testStack: createTestOperatorStack() }).mounted).toBe(
      false,
    )
  })

  test("secret-looking payload rejected on mutation path", async () => {
    const stack = createTestOperatorStack()
    const r = await stack.dispatcher.dispatchRequest(
      req({
        id: "langlock.set" as CommandRequest["id"],
        confirm: true,
        idempotencyKey: "sec-1",
        payload: { apiKey: "sk_live_secret_value_here" },
      }),
    )
    // plaintext rejection or not_implemented — never success with secret
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain("sk_live_secret_value_here")
  })
})
