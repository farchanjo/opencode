/**
 * Feature 013 / T001 — protocol/telemetry shape parity against the normative CUE
 * corpus `doc/arch/schemas/operator-config-domains/*.cue` (FR1, FR2, FR6, FR7,
 * FR8).
 *
 * `packages/protocol/src/telemetry/{commands,ports}.ts` is the implemented
 * TypeScript mirror of the telemetry operator-surface ValueObjects — plain
 * `interface`/`type` declarations that source their closed enums
 * (`Transport`/`SecretRef`/`EndpointUrl`) from
 * `@opencode-ai/schema/telemetry/config` so the operator contract can never
 * diverge from the reused effective-config shape. This suite pins, by source
 * scan (the type-only shapes carry no runtime representation), mirroring the
 * scan style of `packages/protocol/test/langlock/contract-parity.test.ts`:
 *
 *   1. `#TelemetrySummary` fields (telemetry.cue) equal the `TelemetrySummary`
 *      interface fields.
 *   2. `#ProbeOutcome` members (enums.cue) equal the `ProbeOutcome` union.
 *   3. `TelemetryDomainError` discriminants equal `#MutationOutcome` (enums.cue)
 *      minus the `success` happy-path member.
 *   4. `TelemetryDomainPort` exposes exactly resolve/on/off/configure/test.
 *   5. `telemetry.configure` carries the export header as a `SecretRef` only —
 *      no plaintext-secret field (FR6, Security).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"

const readRepo = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const commandsSrc = readRepo("../../src/telemetry/commands.ts")
const portsSrc = readRepo("../../src/telemetry/ports.ts")
const enumsCue = readRepo("../../../../doc/arch/schemas/operator-config-domains/enums.cue")
const telemetryCue = readRepo("../../../../doc/arch/schemas/operator-config-domains/telemetry.cue")

/** Extract the quoted members of a CUE `#Name: "a" | "b" | ...` disjunction. */
function parseCueUnion(src: string, name: string): string[] {
  const match = src.match(new RegExp(`#${name}:\\s*([^\\n]+)`))
  if (!match) throw new Error(`CUE union #${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the field keys of a CUE `#Name: { ... }` struct body. */
function parseCueStructFields(src: string, name: string): string[] {
  const match = src.match(new RegExp(`#${name}:\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`CUE struct #${name} not found`)
  return [...match[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
}

/** Extract the `readonly <name>:` field/method keys of an `export interface NAME { ... }` block. */
function parseInterfaceMembers(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`interface ${name} not found`)
  return [...match[1].matchAll(/readonly\s+(\w+)\??[?:(]/g)].map((m) => m[1])
}

/** Extract every `{ readonly type: "..." ... }` discriminant from a closed error union. */
function parseErrorDiscriminants(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|$)`))
  if (!match) throw new Error(`error union ${name} not found`)
  return [...match[1].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
}

const asSet = (values: Iterable<string>) => new Set(values)

describe("T001 parity — telemetry enums sourced from schema, never re-literalled (single vocabulary)", () => {
  test("commands.ts sources Transport/SecretRef/EndpointUrl from @opencode-ai/schema/telemetry/config", () => {
    expect(commandsSrc).toContain('from "@opencode-ai/schema/telemetry/config"')
    for (const alias of ["Transport", "SecretRef", "EndpointUrl"]) {
      expect(commandsSrc).toMatch(new RegExp(`export type ${alias} = Schema${alias}`))
    }
  })

  test("commands.ts does not re-declare the OTLP transport literals", () => {
    expect(commandsSrc).not.toContain('"http/protobuf"')
    expect(commandsSrc).not.toContain('"grpc"')
  })
})

describe("T001 parity — read model + probe outcome match the CUE corpus", () => {
  test("TelemetrySummary fields equal #TelemetrySummary (telemetry.cue)", () => {
    const cue = asSet(parseCueStructFields(telemetryCue, "TelemetrySummary"))
    const protocol = asSet(parseInterfaceMembers(commandsSrc, "TelemetrySummary"))
    expect(protocol).toEqual(cue)
    expect(cue.size).toBe(7)
  })

  test("ProbeOutcome members equal #ProbeOutcome (enums.cue)", () => {
    const cue = asSet(parseCueUnion(enumsCue, "ProbeOutcome"))
    expect(cue).toEqual(asSet(["reachable", "unreachable", "misconfigured"]))
    const protocol = asSet([...commandsSrc.matchAll(/export type ProbeOutcome =\s*([^\n]+)/g)].flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((q) => q[1]),
    ))
    expect(protocol).toEqual(cue)
  })
})

describe("T001 parity — typed error union mirrors #MutationOutcome minus success (FR7, FR8)", () => {
  test("TelemetryDomainError discriminants equal the non-success mutation outcomes", () => {
    const outcomes = asSet(parseCueUnion(enumsCue, "MutationOutcome"))
    expect(outcomes.has("success")).toBe(true)
    const errorOutcomes = new Set([...outcomes].filter((o) => o !== "success"))
    const protocol = asSet(parseErrorDiscriminants(commandsSrc, "TelemetryDomainError"))
    expect(protocol).toEqual(errorOutcomes)
    expect(protocol).toEqual(asSet(["version_conflict", "invalid_argument", "unauthorized", "unavailable"]))
  })

  test("TelemetryDomainError carries no not_implemented member (outcomes are closed to the CUE set)", () => {
    expect(asSet(parseErrorDiscriminants(commandsSrc, "TelemetryDomainError")).has("not_implemented")).toBe(false)
  })
})

describe("T001 parity — port method surface + secret discipline", () => {
  test("TelemetryDomainPort exposes exactly resolve/on/off/configure/test", () => {
    expect(parseInterfaceMembers(portsSrc, "TelemetryDomainPort").sort()).toEqual(
      ["configure", "off", "on", "resolve", "test"].sort(),
    )
  })

  test("TelemetryConfigureInput carries the export header as a SecretRef only — no plaintext-secret field (FR6)", () => {
    const block = commandsSrc.match(/export interface TelemetryConfigureInput\s*\{([\s\S]*?)\n\}/)
    expect(block).not.toBeNull()
    const body = block![1]
    expect(body).toMatch(/readonly headerSecret\?:\s*SecretRef/)
    expect(body).toContain("expectedVersion")
    // No plaintext credential field ever appears on the configure payload.
    expect(body).not.toMatch(/readonly (header|token|password|plaintext|secretValue)\s*:/)
  })
})
