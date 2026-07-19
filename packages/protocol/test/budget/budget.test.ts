/**
 * Feature 013 / T003 — protocol/budget parity against the CUE corpus authority
 * (FR1, FR4, FR7, FR8).
 *
 * Feature 013 adds no `contracts/ports.ts` draft; the normative authority for the
 * budget-domain operator-surface shapes is the CUE corpus
 * `doc/arch/schemas/operator-config-domains/{budget,enums,persistence}.cue`,
 * mirrored by the plain `interface`/`type` declarations in
 * `packages/protocol/src/budget/**`. This suite pins:
 *
 *   1. The `budget.*` verb surface (`BUDGET_VERBS`) equals `enums.cue` #BudgetVerb.
 *   2. The `BudgetError` discriminants equal the `enums.cue` #MutationOutcome
 *      non-`success` outcomes (plus the `not_implemented` honest-degradation guard).
 *   3. The `BudgetPort` interface exposes exactly one method per verb.
 *   4. The `BudgetLimitsView` fields equal the `budget.cue` #BudgetLimitsView keys.
 *   5. No payload carries a plaintext secret or a free-form command id (FR1).
 *
 * The port/command TypeScript is type-only (no runtime union representation), so
 * the interface/error shapes are parsed from source text, mirroring the
 * source-scan style of `packages/protocol/test/langlock/contract-parity.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { BUDGET_VERBS, type BudgetVerb, type MutationOutcome } from "../../src/budget/commands"

const schemaDir = "../../../../doc/arch/schemas/operator-config-domains"
const enumsSrc = readFileSync(fileURLToPath(new URL(`${schemaDir}/enums.cue`, import.meta.url)), "utf8")
const budgetSrc = readFileSync(fileURLToPath(new URL(`${schemaDir}/budget.cue`, import.meta.url)), "utf8")
const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/budget/commands.ts", import.meta.url)), "utf8")
const portsSrc = readFileSync(fileURLToPath(new URL("../../src/budget/ports.ts", import.meta.url)), "utf8")

const asSet = (values: Iterable<string>) => new Set(values)

/** Extract the quoted members of a CUE `#Name: "a" | "b" | ...` disjunction. */
function parseCueEnum(src: string, name: string): string[] {
  const match = src.match(new RegExp(`#${name}:\\s*([^\\n]+)`))
  if (!match) throw new Error(`CUE enum #${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the field keys of a CUE `#Name: { key: ... }` struct. */
function parseCueStructKeys(src: string, name: string): string[] {
  const match = src.match(new RegExp(`#${name}:\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`CUE struct #${name} not found`)
  return [...match[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1])
}

/** Extract every `{ readonly type: "..." ... }` discriminant from a closed TS error union. */
function parseErrorDiscriminants(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|$)`))
  if (!match) throw new Error(`error union ${name} not found`)
  return [...match[1].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the `readonly <name>:` method keys of an `export interface NAME { ... }` block. */
function parseInterfaceMembers(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`interface ${name} not found`)
  return [...match[1].matchAll(/readonly\s+(\w+):/g)].map((m) => m[1])
}

describe("T003 parity — budget.* verb surface matches enums.cue (FR4)", () => {
  test("BUDGET_VERBS equals the enums.cue #BudgetVerb disjunction", () => {
    expect(asSet(BUDGET_VERBS)).toEqual(asSet(parseCueEnum(enumsSrc, "BudgetVerb")))
    expect(BUDGET_VERBS.length).toBe(5)
  })

  test("the verb members narrow to the BudgetVerb type", () => {
    const status: BudgetVerb = "status"
    const validate: BudgetVerb = "validate"
    expect(status).toBe("status")
    expect(validate).toBe("validate")
  })
})

describe("T003 parity — BudgetError degrades to the enums.cue #MutationOutcome envelope (FR7, FR8)", () => {
  const nonSuccessOutcomes = parseCueEnum(enumsSrc, "MutationOutcome").filter((o) => o !== "success")
  const discriminants = asSet(parseErrorDiscriminants(commandsSrc, "BudgetError"))

  test("every non-success #MutationOutcome maps to a BudgetError discriminant", () => {
    for (const outcome of nonSuccessOutcomes) expect(discriminants.has(outcome)).toBe(true)
  })

  test("BudgetError carries version_conflict and unavailable — guards CAS and honest degradation (FR7, FR8)", () => {
    expect(discriminants.has("version_conflict")).toBe(true)
    expect(discriminants.has("unavailable")).toBe(true)
    expect(discriminants.has("invalid_argument")).toBe(true)
    expect(discriminants.has("unauthorized")).toBe(true)
  })

  test("MutationOutcome success is the only member absent from the error union", () => {
    const outcomes: MutationOutcome[] = ["success", "version_conflict", "invalid_argument", "unauthorized", "unavailable"]
    const missing = outcomes.filter((o) => !discriminants.has(o))
    expect(missing).toEqual(["success"])
  })
})

describe("T003 parity — BudgetPort exposes one method per verb (FR4)", () => {
  test("BudgetPort method names equal BUDGET_VERBS", () => {
    expect(parseInterfaceMembers(portsSrc, "BudgetPort").sort()).toEqual([...BUDGET_VERBS].sort())
  })
})

describe("T003 parity — BudgetLimitsView mirrors budget.cue #BudgetLimitsView (FR4)", () => {
  test("the limits view carries exactly the CUE #BudgetLimitsView fields", () => {
    const cueKeys = asSet(parseCueStructKeys(budgetSrc, "BudgetLimitsView"))
    const tsKeys = asSet(parseInterfaceMembers(commandsSrc, "BudgetLimitsView"))
    expect(tsKeys).toEqual(cueKeys)
  })
})

describe("T003 security — no plaintext secret, no free-form command id (FR1)", () => {
  test("no budget payload declares a secret-bearing field", () => {
    // budget mutates only turn/token limits — it carries no telemetry export
    // header, so no readonly member may be a secret/credential value, nor may any
    // field reuse the SecretRef type (the tokenBudget *limit* is not a secret).
    expect(commandsSrc).not.toMatch(/readonly\s+\w*(secret|password|credential|apikey)\w*\s*:/i)
    expect(commandsSrc).not.toMatch(/:\s*SecretRef\b/)
  })

  test("no budget input carries a free-form commandId — Feature 007 owns registration (FR1, FR11)", () => {
    expect(commandsSrc).not.toMatch(/readonly\s+commandId:/)
  })
})
