/**
 * Feature 013 / T004 — protocol/pools payload + port surface (FR1, FR5, FR7, FR8).
 *
 * pools is a PROJECTION of `RoutingConfig.Models.role_pools`: the protocol module
 * declares the bounded projection read model, the `set`/`reset` CAS mutation
 * inputs, the `validate` output, and the typed error union. The payloads carry no
 * runtime representation (type-only `interface`/`type`), so assignability is
 * pinned by constructing typed literals; the closed error union and its
 * `expectedVersion` CAS discipline are pinned from the source text.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import type {
  PoolsError,
  PoolsProjection,
  PoolsResetInput,
  PoolsResolveOutput,
  PoolsSetInput,
  PoolsValidateOutput,
  RolePoolBinding,
} from "../../src/pools/commands"

const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/pools/commands.ts", import.meta.url)), "utf8")

const projection: PoolsProjection = {
  configured: true,
  available: true,
  valid: true,
  bindings: [{ role: "architect", models: ["opus", "sonnet"] }],
  updatedAt: "2026-07-19T00:00:00Z",
  version: "v3",
}

describe("protocol/pools — bounded projection read model (FR5)", () => {
  test("PoolsProjection.bindings is a bounded role→models binding list", () => {
    const binding: RolePoolBinding = projection.bindings[0]
    expect(binding.role).toBe("architect")
    expect(binding.models).toEqual(["opus", "sonnet"])
    expect(Array.isArray(projection.bindings)).toBe(true)
  })

  test("resolve output and validate output both surface the same projection shape", () => {
    const resolve: PoolsResolveOutput = { projection }
    const validate: PoolsValidateOutput = { valid: true, projection }
    expect(resolve.projection.version).toBe("v3")
    expect(validate.valid).toBe(true)
    expect(validate.projection.bindings).toHaveLength(1)
  })
})

describe("protocol/pools — CAS mutation inputs carry expectedVersion (FR7)", () => {
  test("set and reset inputs both carry an expectedVersion CAS token and a principal", () => {
    const set: PoolsSetInput = {
      bindings: [{ role: "worker", models: ["haiku"] }],
      expectedVersion: "v3",
      principal: { kind: "operator", id: "op-1" },
    }
    const reset: PoolsResetInput = { expectedVersion: "v3", principal: { kind: "operator", id: "op-1" } }
    expect(set.expectedVersion).toBe("v3")
    expect(reset.expectedVersion).toBe("v3")
    expect(set.principal.kind).toBe("operator")
  })

  test("the set/reset source declarations both require an expectedVersion field", () => {
    for (const iface of ["PoolsSetInput", "PoolsResetInput"]) {
      const match = commandsSrc.match(new RegExp(`interface ${iface}\\s*\\{([\\s\\S]*?)\\n\\}`))
      expect(match).not.toBeNull()
      expect(match![1]).toContain("expectedVersion")
    }
  })

  test("no payload carries a secret-ref or export-header field (pools holds no secrets)", () => {
    expect(commandsSrc).not.toContain("SecretRef")
    expect(commandsSrc).not.toContain("header")
  })
})

describe("protocol/pools — typed error union, honest degradation (FR8)", () => {
  test("PoolsError carries every non-success MutationOutcome plus the not_implemented stub", () => {
    const discriminants = new Set(
      [...commandsSrc.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]).filter((t) => t !== "operator"),
    )
    for (const expected of ["version_conflict", "invalid_argument", "unauthorized", "unavailable", "not_implemented"]) {
      expect(discriminants.has(expected)).toBe(true)
    }
  })

  test("a version_conflict envelope carries expected/actual CAS tokens", () => {
    const conflict: PoolsError = { type: "version_conflict", expectedVersion: "v3", actualVersion: "v4" }
    expect(conflict.type).toBe("version_conflict")
    if (conflict.type === "version_conflict") expect(conflict.actualVersion).toBe("v4")
  })
})
