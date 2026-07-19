/**
 * Feature 013 / T001 — protocol/telemetry port shape assignability.
 *
 * The `TelemetryDomainPort` payloads are type-only (no runtime representation),
 * so this suite exercises them through a compile-checked in-memory port double
 * that returns the typed Effects, mirroring the shape checks in
 * `packages/protocol/test/langlock/ports.test.ts`. tsgo enforces the interface
 * conformance; the runtime assertions pin the projected values.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type {
  ProbeResult,
  TelemetryConfigureInput,
  TelemetryDomainError,
  TelemetrySummary,
  TelemetryToggleInput,
} from "../../src/telemetry/commands"
import type { TelemetryDomainPort } from "../../src/telemetry/ports"

const summary: TelemetrySummary = {
  enabled: true,
  configured: true,
  available: true,
  transport: "http/protobuf",
  endpoint: "https://otlp.local:4318",
  updatedAt: "2026-07-19T00:00:00.000Z",
  version: "cas_v3",
}

const toggle: TelemetryToggleInput = {
  expectedVersion: "cas_v3",
  principal: { kind: "operator", id: "op-1" },
}

const configure: TelemetryConfigureInput = {
  transport: "grpc",
  endpoint: "https://collector.internal:4317",
  headerSecret: "vault:otlp-auth@v2",
  expectedVersion: "cas_v3",
  principal: { kind: "operator", id: "op-1" },
}

/** In-memory port double — its mere existence proves the interface is satisfiable. */
const port: TelemetryDomainPort = {
  resolve: () => Effect.succeed({ summary }),
  on: (input) => Effect.succeed({ summary: { ...summary, enabled: true, version: input.expectedVersion }, auditId: "audit_on" }),
  off: (input) => Effect.succeed({ summary: { ...summary, enabled: false, version: input.expectedVersion }, auditId: "audit_off" }),
  configure: (input) =>
    Effect.succeed({ summary: { ...summary, transport: input.transport, endpoint: input.endpoint }, auditId: "audit_cfg" }),
  test: () => Effect.succeed({ outcome: "reachable", target: { transport: summary.transport, endpoint: summary.endpoint } }),
}

describe("T001 — TelemetryDomainPort resolve/on/off/configure/test", () => {
  test("resolve projects the redacted summary", async () => {
    const out = await Effect.runPromise(port.resolve())
    expect(out.summary.transport).toBe("http/protobuf")
    expect(out.summary.version).toBe("cas_v3")
  })

  test("on/off are CAS mutations returning a summary + audit id", async () => {
    const on = await Effect.runPromise(port.on(toggle))
    expect(on.auditId).toBe("audit_on")
    expect(on.summary.enabled).toBe(true)
    const off = await Effect.runPromise(port.off(toggle))
    expect(off.summary.enabled).toBe(false)
  })

  test("configure carries the export header as a SecretRef and returns an audit id", async () => {
    const out = await Effect.runPromise(port.configure(configure))
    expect(out.summary.transport).toBe("grpc")
    expect(out.auditId).toBe("audit_cfg")
    // The SecretRef is an opaque reference, never a plaintext credential.
    expect(configure.headerSecret).toBe("vault:otlp-auth@v2")
  })

  test("test resolves a typed ProbeResult with a target", async () => {
    const probe: ProbeResult = await Effect.runPromise(port.test())
    expect(probe.outcome).toBe("reachable")
    expect(probe.target.endpoint).toBe("https://otlp.local:4318")
  })
})

describe("T001 — TelemetryDomainError typed envelopes carry string CAS versions", () => {
  test("version_conflict carries opaque string expected/actual versions", () => {
    const conflict: TelemetryDomainError = { type: "version_conflict", expectedVersion: "cas_v3", actualVersion: "cas_v4" }
    expect(conflict.type).toBe("version_conflict")
    if (conflict.type === "version_conflict") {
      expect(conflict.expectedVersion).toBe("cas_v3")
      expect(conflict.actualVersion).toBe("cas_v4")
    }
  })

  test("unavailable and invalid_argument carry bounded, secret-free reasons", () => {
    const unavailable: TelemetryDomainError = { type: "unavailable", reason: "config authority unreachable" }
    const invalid: TelemetryDomainError = { type: "invalid_argument", field: "endpoint", reason: "must be http(s)" }
    expect(unavailable.type).toBe("unavailable")
    expect(invalid.type).toBe("invalid_argument")
  })
})
