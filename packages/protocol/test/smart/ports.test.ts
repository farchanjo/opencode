/**
 * Feature 013 / T002 — protocol/smart payload + port surface (FR1, FR3, FR7, FR8).
 *
 * smart is a PROJECTION of `RoutingConfig.Activation`: the protocol module
 * declares the projected read model, the shared `on`/`off`/`auto` CAS mutation
 * input, and the typed error union. The payloads carry no runtime representation
 * (type-only `interface`/`type`), so assignability is pinned by constructing
 * typed literals; the closed error union and its `expectedVersion` CAS discipline
 * are pinned from the source text.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import type {
  SmartError,
  SmartMutationInput,
  SmartMutationOutput,
  SmartResolveOutput,
  SmartSummary,
} from "../../src/smart/commands"

const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/smart/commands.ts", import.meta.url)), "utf8")

const summary: SmartSummary = {
  enabled: true,
  auto: false,
  configured: true,
  available: true,
  authority: "routing",
  updatedAt: "2026-07-19T00:00:00Z",
  version: "v3",
}

describe("protocol/smart — projected read model (FR3)", () => {
  test("SmartSummary projects the enabled/auto state plus config-derived flags", () => {
    const resolve: SmartResolveOutput = { summary }
    expect(resolve.summary.enabled).toBe(true)
    expect(resolve.summary.auto).toBe(false)
    expect(resolve.summary.authority).toBe("routing")
    expect(resolve.summary.version).toBe("v3")
  })

  test("available is a plain projection flag, never fabricated (FR8)", () => {
    const degraded: SmartSummary = { ...summary, available: false, configured: false }
    expect(degraded.available).toBe(false)
    expect(degraded.configured).toBe(false)
  })
})

describe("protocol/smart — CAS mutation input carries expectedVersion (FR7)", () => {
  test("the on/off/auto mutation input carries an expectedVersion CAS token and a principal", () => {
    const input: SmartMutationInput = { expectedVersion: "v3", principal: { kind: "operator", id: "op-1" } }
    const output: SmartMutationOutput = { summary, auditId: "audit-1" }
    expect(input.expectedVersion).toBe("v3")
    expect(input.principal.kind).toBe("operator")
    expect(output.auditId).toBe("audit-1")
  })

  test("the mutation input source declaration requires an expectedVersion field", () => {
    const match = commandsSrc.match(/interface SmartMutationInput\s*\{([\s\S]*?)\n\}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("expectedVersion")
  })

  test("no payload carries a secret-ref or export-header field (smart holds no secrets)", () => {
    expect(commandsSrc).not.toContain("SecretRef")
    expect(commandsSrc).not.toContain("header")
  })
})

describe("protocol/smart — typed error union, honest degradation (FR8)", () => {
  test("SmartError carries every non-success MutationOutcome plus the not_implemented stub", () => {
    const discriminants = new Set(
      [...commandsSrc.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]).filter((t) => t !== "operator"),
    )
    for (const expected of ["version_conflict", "invalid_argument", "unauthorized", "unavailable", "not_implemented"]) {
      expect(discriminants.has(expected)).toBe(true)
    }
  })

  test("a version_conflict envelope carries expected/actual CAS tokens", () => {
    const conflict: SmartError = { type: "version_conflict", expectedVersion: "v3", actualVersion: "v4" }
    expect(conflict.type).toBe("version_conflict")
    if (conflict.type === "version_conflict") expect(conflict.actualVersion).toBe("v4")
  })
})
