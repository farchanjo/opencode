/**
 * T041–T047 unit coverage (flag, reserved names, offline, SSRF, OTEL).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  isOperatorControlPlaneEnabled,
  getOperatorFlagState,
  resolveOperatorControlPlaneFlag,
  readOperatorControlPlaneFromConfig,
  operatorUnavailableWhenFlagOff,
  OPERATOR_CONTROL_PLANE_FLAG,
  checkReservedRegistrationName,
  classifyLegacyAdminName,
  dryRunLegacyMigration,
  checkOfflineCapability,
  assertCatalogOfflineInvariants,
  resolveConnectivity,
  validateOperatorUrl,
  validateRedirectChain,
  expandIpv4Tricks,
  expandIpv6MappedIpv4,
  isBlockedIpv4,
  isValidPort,
  buildOperatorOtelAttributes,
  sanitizeOperatorOtelAttributes,
  createOperatorSpanRecorder,
  OPERATOR_OTEL_ALLOWED_KEYS,
  RESERVED_CATALOG,
  RESERVED_CATALOG_VERSION,
  listReservedIds,
} from "../../src/operator"

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
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe("T041 feature flag single source", () => {
  test("default off", () => {
    expect(isOperatorControlPlaneEnabled({})).toBe(false)
    expect(getOperatorFlagState({}).enabled).toBe(false)
    expect(getOperatorFlagState({}).migrationDefault).toBe("off")
    expect(OPERATOR_CONTROL_PLANE_FLAG).toBe("operator_control_plane")
  })

  test("precedence: sandbox > env > config > default", () => {
    expect(resolveOperatorControlPlaneFlag({ configEnabled: true, env: {} }).enabled).toBe(true)
    expect(resolveOperatorControlPlaneFlag({ configEnabled: true, env: {} }).source).toBe("config")
    expect(
      resolveOperatorControlPlaneFlag({
        configEnabled: false,
        env: { OPENCODE_OPERATOR_CONTROL_PLANE: "1" },
      }).source,
    ).toBe("env")
    expect(
      resolveOperatorControlPlaneFlag({
        configEnabled: false,
        env: { OPENCODE_DEV_OPERATOR_: "1" },
      }).source,
    ).toBe("sandbox")
    // OPENCODE_OPERATOR_HTTP is NOT an enable source
    expect(
      resolveOperatorControlPlaneFlag({
        env: { OPENCODE_OPERATOR_HTTP: "1" } as NodeJS.ProcessEnv,
      }).enabled,
    ).toBe(false)
  })

  test("read config experimental.operator_control_plane", () => {
    expect(readOperatorControlPlaneFromConfig({ experimental: { operator_control_plane: true } })).toBe(true)
    expect(readOperatorControlPlaneFromConfig({ experimental: { operator_control_plane: false } })).toBe(false)
    expect(readOperatorControlPlaneFromConfig({})).toBeUndefined()
  })

  test("flag-off envelope is unavailable not prompt", () => {
    const r = operatorUnavailableWhenFlagOff("langlock.status")
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe("unavailable")
    expect(r.kind).toBe("operator.admin_result")
    expect(r.error.message).toContain("operator_control_plane")
  })
})

describe("T042–T043 reserved names + migration", () => {
  test("rejects /op.* and catalog ids for plugin/mcp/custom", () => {
    for (const source of ["plugin", "mcp", "custom", "slash", "palette"] as const) {
      expect(checkReservedRegistrationName("/op.langlock.status", source).ok).toBe(false)
      expect(checkReservedRegistrationName("langlock.status", source).ok).toBe(false)
      expect(checkReservedRegistrationName("op.langlock.status", source).ok).toBe(false)
      expect(checkReservedRegistrationName("operator.foo", source).ok).toBe(false)
      const bad = checkReservedRegistrationName("langlock.status", source)
      if (!bad.ok) expect(bad.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
    }
  })

  test("builtin source allows; non-admin customs allowed", () => {
    expect(checkReservedRegistrationName("task", "builtin").ok).toBe(true)
    expect(checkReservedRegistrationName("my-review-cmd", "custom").ok).toBe(true)
    expect(checkReservedRegistrationName("team.notes", "plugin").ok).toBe(true)
  })

  test("legacy admin-like narrow classifier + dry-run", () => {
    expect(classifyLegacyAdminName("admin").kind).toBe("legacy_admin_like")
    expect(classifyLegacyAdminName("settings-admin").kind).toBe("legacy_admin_like")
    // mid-string admin is clean (no false positive)
    expect(classifyLegacyAdminName("read-admin-notes").kind).toBe("clean")
    expect(classifyLegacyAdminName("langlock.status").kind).toBe("reserved_collision")
    expect(classifyLegacyAdminName("my-tool").kind).toBe("clean")
    const report = dryRunLegacyMigration(["admin", "langlock.status", "notes", "read-admin-notes"])
    expect(report.warn).toContain("admin")
    expect(report.reject).toContain("langlock.status")
    expect(report.clean).toContain("notes")
    expect(report.clean).toContain("read-admin-notes")
    expect(report.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
    expect(report.autoRename).toBe(false)
    expect(report.autoDelete).toBe(false)
  })
})

describe("T044 offline matrix", () => {
  test("network ops blocked offline; status allowed", () => {
    const status = {
      id: "langlock.status" as never,
      aliases: [],
      mutates: false,
      scopesAllowed: ["project" as const],
      confirmRequired: false,
      offlineCapable: true,
      schemaVersion: "1.0.0",
      authority: "native" as const,
      domain: "langlock",
    }
    const testOp = { ...status, id: "telemetry.test" as never, offlineCapable: false, mutates: true }
    expect(checkOfflineCapability(status, "offline").allowed).toBe(true)
    expect(checkOfflineCapability(testOp, "offline").allowed).toBe(false)
    expect(checkOfflineCapability(testOp, "online").allowed).toBe(true)
  })

  test("resolveConnectivity from env and config", () => {
    expect(resolveConnectivity({ env: {} })).toBe("online")
    expect(resolveConnectivity({ env: { OPENCODE_OFFLINE: "1" } })).toBe("offline")
    expect(resolveConnectivity({ env: { OPENCODE_CONNECTIVITY: "offline" } })).toBe("offline")
    expect(resolveConnectivity({ configOffline: true, env: {} })).toBe("offline")
  })

  test("catalog status/show/list offlineCapable invariant", () => {
    const errors = assertCatalogOfflineInvariants(RESERVED_CATALOG.entries)
    expect(errors).toEqual([])
  })
})

describe("T045 SSRF", () => {
  test("denies private/metadata/loopback on remote profile", async () => {
    expect((await validateOperatorUrl("http://127.0.0.1/x")).ok).toBe(false)
    expect((await validateOperatorUrl("https://169.254.169.254/latest/meta-data/")).ok).toBe(false)
    expect((await validateOperatorUrl("https://192.168.1.1/")).ok).toBe(false)
    expect((await validateOperatorUrl("https://[::1]/")).ok).toBe(false)
  })

  test("port validated before accept — 0 and out-of-range denied", async () => {
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
    expect((await validateOperatorUrl("https://example.com:0/", { resolver: async () => ["93.184.216.34"] })).ok).toBe(
      false,
    )
    expect(
      (await validateOperatorUrl("https://example.com:99999/", { resolver: async () => ["93.184.216.34"] })).ok,
    ).toBe(false)
  })

  test("IPv6-mapped IPv4 dotted+hex", () => {
    expect(expandIpv6MappedIpv4("::ffff:127.0.0.1")).toBe("127.0.0.1")
    expect(expandIpv6MappedIpv4("::ffff:7f00:1")).toBe("127.0.0.1")
    expect(expandIpv6MappedIpv4("::ffff:c0a8:0101")).toBe("192.168.1.1")
    expect(expandIpv6MappedIpv4("::ffff:a00:1")).toBe("10.0.0.1")
  })

  test("mapped IPv6 denied on remote", async () => {
    expect((await validateOperatorUrl("https://[::ffff:127.0.0.1]/")).ok).toBe(false)
    expect((await validateOperatorUrl("https://[::ffff:7f00:1]/")).ok).toBe(false)
    expect((await validateOperatorUrl("https://[::ffff:a00:1]/")).ok).toBe(false)
  })

  test("decimal/octal/hex IPv4 tricks", () => {
    expect(expandIpv4Tricks("2130706433")).toBe("127.0.0.1")
    expect(isBlockedIpv4("127.0.0.1", "remote")).toBe(true)
    expect(isBlockedIpv4("127.0.0.1", "local")).toBe(false)
  })

  test("userinfo denied; DNS rebinding denied; redirect hop limit", async () => {
    expect((await validateOperatorUrl("https://user:pass@example.com/")).ok).toBe(false)
    expect(
      (
        await validateOperatorUrl("https://evil.example/", {
          resolver: async () => ["127.0.0.1"],
        })
      ).ok,
    ).toBe(false)
    const hops = await validateRedirectChain(
      Array.from({ length: 6 }, () => "https://example.com/"),
      { resolver: async () => ["93.184.216.34"], maxRedirects: 5 },
    )
    expect(hops.ok).toBe(false)
  })

  test("https public OK with clean resolve", async () => {
    const ok = await validateOperatorUrl("https://example.com/api", {
      resolver: async () => ["93.184.216.34"],
    })
    expect(ok.ok).toBe(true)
  })

  test("local profile allows loopback https", async () => {
    const ok = await validateOperatorUrl("https://127.0.0.1:8443/", { profile: "local" })
    expect(ok.ok).toBe(true)
  })
})

describe("T046 OTEL content-free", () => {
  test("allowed keys only; rejects path/secret values", () => {
    const attrs = buildOperatorOtelAttributes({
      commandId: "langlock.status",
      domain: "langlock",
      surface: "cli",
      scopeKind: "project",
      outcome: "success",
      durationMs: 12,
    })
    for (const k of Object.keys(attrs)) {
      expect(OPERATOR_OTEL_ALLOWED_KEYS.includes(k as never)).toBe(true)
    }
    const bad = sanitizeOperatorOtelAttributes({
      command_id: "x",
      domain: "d",
      surface: "s",
      scope_kind: "project",
      outcome: "ok",
      duration_ms: 1,
      retry: false,
      payload: "nope",
    })
    expect(bad.ok).toBe(false)

    const pathy = sanitizeOperatorOtelAttributes({
      command_id: "/tmp/secret",
      domain: "d",
      surface: "s",
      scope_kind: "project",
      outcome: "ok",
      duration_ms: 1,
      retry: false,
    })
    expect(pathy.ok).toBe(false)

    const rec = createOperatorSpanRecorder()
    rec.record(attrs)
    expect(rec.snapshots().length).toBe(1)
  })
})

describe("T045 production DNS resolver", () => {
  test("uses injected lookup; empty on error (fail closed)", async () => {
    const { createProductionDnsResolver } = await import("../../src/operator/dns")
    const ok = createProductionDnsResolver({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    })
    expect(await ok("example.com")).toEqual(["93.184.216.34"])
    const fail = createProductionDnsResolver({
      lookup: async () => {
        throw new Error("dns down")
      },
    })
    expect(await fail("example.com")).toEqual([])
  })
})

describe("catalog size sanity", () => {
  test("reserved ids non-empty", () => {
    expect(listReservedIds().length).toBeGreaterThan(50)
  })
})
