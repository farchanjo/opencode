import { describe, expect, test } from "bun:test"
import {
  catalogVersion,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  isErrorCode,
  isReservedCommandId,
  listReservedIds,
  makeOperatorError,
  OPERATOR_DOMAINS,
  parseErrorCode,
  redactSecrets,
  requiresConfirmation,
  RESERVED_CATALOG,
  RESERVED_CATALOG_VERSION,
  reservedCatalogSnapshot,
} from "../../src/operator"

describe("reserved catalog (T007)", () => {
  test("version field present and stable snapshot", () => {
    expect(RESERVED_CATALOG_VERSION).toBe("1.1.0")
    expect(catalogVersion()).toBe("1.1.0")
    expect(RESERVED_CATALOG.version).toBe("1.1.0")
    const snap = reservedCatalogSnapshot()
    expect(snap.version).toBe("1.1.0")
    expect(snap.domainCount).toBe(12)
    expect(snap.idCount).toBeGreaterThan(50)
  })

  test("includes all Phase 1 domains", () => {
    const required = [
      "telemetry",
      "smart",
      "routing",
      "budget",
      "pools",
      "process",
      "task",
      "jobs",
      "langlock",
      "output",
      "semantic",
      "mcp",
    ] as const
    expect([...OPERATOR_DOMAINS]).toEqual([...required])
    for (const d of required) {
      expect(listReservedIds().some((id) => id.startsWith(d + "."))).toBe(true)
    }
  })

  test("no duplicate IDs", () => {
    const ids = listReservedIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("semantic and mcp exhaustive samples present", () => {
    expect(isReservedCommandId("semantic.embedding.cutover")).toBe(true)
    expect(isReservedCommandId("semantic.provider.rotate-secret")).toBe(true)
    expect(isReservedCommandId("mcp.server.list")).toBe(true)
    expect(isReservedCommandId("mcp.experimental.enable")).toBe(true)
    expect(isReservedCommandId("mcp.resource.admin.policy.set")).toBe(true)
    expect(isReservedCommandId("routing.test")).toBe(true)
    expect(isReservedCommandId("langlock.status")).toBe(true)
  })

  test("routing surface ids required by RoutingPort/CLI are reserved (v1.1.0)", () => {
    expect(isReservedCommandId("routing.explain")).toBe(true)
    expect(isReservedCommandId("routing.capability.inspect")).toBe(true)
    // read-only surface: neither mutates nor requires confirmation
    expect(requiresConfirmation("routing.explain")).toBe(false)
    expect(requiresConfirmation("routing.capability.inspect")).toBe(false)
  })

  test("confirmation matrix leaves marked on catalog entries", () => {
    expect(requiresConfirmation("semantic.embedding.cutover")).toBe(true)
    expect(requiresConfirmation("semantic.embedding.rollback")).toBe(true)
    expect(requiresConfirmation("output.purge")).toBe(true)
    expect(requiresConfirmation("semantic.provider.rotate-secret")).toBe(true)
    expect(requiresConfirmation("mcp.experimental.enable")).toBe(true)
    expect(requiresConfirmation("output.export")).toBe(true)
    expect(requiresConfirmation("output.share")).toBe(true)
    expect(requiresConfirmation("langlock.status")).toBe(false)
    expect(requiresConfirmation("jobs.disable")).toBe(true)
  })
})

describe("error taxonomy (T009)", () => {
  test("closed code set matches contract", () => {
    expect([...ERROR_CODES]).toEqual([
      "unauthorized",
      "forbidden_scope",
      "conflict",
      "idempotent_replay",
      "invalid_argument",
      "reserved_name",
      "confirmation_required",
      "unavailable",
      "secret_backend",
      "transport_error",
      "not_implemented",
    ])
    for (const code of ERROR_CODES) {
      expect(isErrorCode(code)).toBe(true)
      expect(typeof ERROR_HTTP_STATUS[code]).toBe("number")
    }
    expect(parseErrorCode("free_string").ok).toBe(false)
    expect(isErrorCode("oops")).toBe(false)
  })

  test("makeOperatorError redacts secrets in message and details", () => {
    const err = makeOperatorError({
      code: "invalid_argument",
      message: "failed api_key=sk_live_abcdefghijklmnop Bearer tok123",
      details: { password: "hunter2", count: 1 },
    })
    expect(err.code).toBe("invalid_argument")
    expect(err.message).not.toContain("sk_live")
    expect(err.message).toContain("[REDACTED]")
    expect(err.details?.password).toBe("[REDACTED]")
    expect(err.details?.count).toBe(1)
    expect(err.retryable).toBe(false)
  })

  test("redactSecrets standalone", () => {
    expect(redactSecrets("token: abcdef")).toContain("[REDACTED]")
  })
})
