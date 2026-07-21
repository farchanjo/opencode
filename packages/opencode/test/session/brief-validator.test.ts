/**
 * Feature 053 / T015 — FR6 brief validation + repair (pure module).
 *
 * Placed beside `session/routing-state.test.ts`, mirroring the module's own
 * `session/brief-validator.ts` location (see that file's header for why the
 * path departs from `plan.md`'s `routing/application/` component table).
 */
import { describe, expect, test } from "bun:test"
import { validateBrief, type BriefValidatorDeps, type SpecialistRef } from "@/session/brief-validator"

const REGISTRY: readonly SpecialistRef[] = [
  { name: "golang-pro", description: "Go specialist" },
  { name: "python-pro", description: "Python specialist" },
  { name: "test-agent-a", description: "First ambiguous candidate" },
  { name: "test-agent-b", description: "Second ambiguous candidate" },
]

function deps(overrides: Partial<BriefValidatorDeps> = {}): BriefValidatorDeps {
  const registry = overrides.listSpecialists?.() ?? REGISTRY
  return {
    resolveSpecialist: (id) => registry.find((s) => s.name === id),
    listSpecialists: () => registry,
    ...overrides,
  }
}

describe("validateBrief", () => {
  test("valid specialist names are left untouched", () => {
    const brief = "- [wire the endpoint] → specialist: golang-pro"
    const result = validateBrief(brief, deps())
    expect(result.brief).toBe(brief)
    expect(result.repairs).toEqual([])
    expect(result.flagged).toEqual([])
  })

  test("a hallucinated name with an unambiguous ranked candidate is repaired", () => {
    const brief = "- [wire the endpoint] → specialist: golnag-pro"
    const result = validateBrief(brief, deps({ ranked: ["golang-pro", "python-pro"] }))
    expect(result.brief).toBe("- [wire the endpoint] → specialist: golang-pro")
    expect(result.repairs).toEqual([{ from: "golnag-pro", to: "golang-pro" }])
    expect(result.flagged).toEqual([])
  })

  test("a hallucinated name with an unambiguous fuzzy candidate is repaired without a ranked list", () => {
    const brief = "- [ship the CLI] → specialist: pyhton-pro"
    const result = validateBrief(brief, deps())
    expect(result.brief).toBe("- [ship the CLI] → specialist: python-pro")
    expect(result.repairs).toEqual([{ from: "pyhton-pro", to: "python-pro" }])
    expect(result.flagged).toEqual([])
  })

  test("an ambiguous hallucinated name is flagged, and the subtask is preserved", () => {
    const brief = "- [do the thing] → specialist: test-agent"
    const result = validateBrief(brief, deps())
    expect(result.brief).toBe("- [do the thing] → specialist: test-agent [unassigned — route explicitly]")
    expect(result.repairs).toEqual([])
    expect(result.flagged).toEqual(["do the thing"])
  })

  test("a hallucinated name with no fuzzy candidate at all is flagged, never dropped", () => {
    const brief = "- [audit the infra] → specialist: totally-unknown-name"
    const result = validateBrief(brief, deps())
    expect(result.brief).toBe(
      "- [audit the infra] → specialist: totally-unknown-name [unassigned — route explicitly]",
    )
    expect(result.repairs).toEqual([])
    expect(result.flagged).toEqual(["audit the infra"])
  })

  test("multiple names mixed: valid, repaired, and flagged in one brief", () => {
    const brief = [
      "- [wire the endpoint] → specialist: golang-pro",
      "- [ship the CLI] → specialist: pyhton-pro",
      "- [do the thing] → specialist: test-agent",
    ].join("\n")
    const result = validateBrief(brief, deps())
    expect(result.brief).toBe(
      [
        "- [wire the endpoint] → specialist: golang-pro",
        "- [ship the CLI] → specialist: python-pro",
        "- [do the thing] → specialist: test-agent [unassigned — route explicitly]",
      ].join("\n"),
    )
    expect(result.repairs).toEqual([{ from: "pyhton-pro", to: "python-pro" }])
    expect(result.flagged).toEqual(["do the thing"])
  })

  test("an empty brief is unchanged", () => {
    const result = validateBrief("", deps())
    expect(result).toEqual({ brief: "", repairs: [], flagged: [] })
  })

  test("a brief with no specialist mentions is unchanged", () => {
    const brief = "Investigate the flaky test and report back.\nNo assignments here."
    const result = validateBrief(brief, deps())
    expect(result.brief).toBe(brief)
    expect(result.repairs).toEqual([])
    expect(result.flagged).toEqual([])
  })

  test("a name valid in the registry but absent from the ranked catalog is accepted", () => {
    const brief = "- [wire the endpoint] → specialist: golang-pro"
    const result = validateBrief(brief, deps({ ranked: ["python-pro"] }))
    expect(result.brief).toBe(brief)
    expect(result.repairs).toEqual([])
    expect(result.flagged).toEqual([])
  })

  test("the fallback free-text convention is tolerated without brackets", () => {
    const brief = "Please route this to specialist: golnag-pro for the fix."
    const result = validateBrief(brief, deps({ ranked: ["golang-pro"] }))
    expect(result.brief).toBe("Please route this to specialist: golang-pro for the fix.")
    expect(result.repairs).toEqual([{ from: "golnag-pro", to: "golang-pro" }])
  })

  test("is deterministic across repeated calls with the same input", () => {
    const brief = [
      "- [wire the endpoint] → specialist: golang-pro",
      "- [ship the CLI] → specialist: pyhton-pro",
      "- [do the thing] → specialist: test-agent",
    ].join("\n")
    const first = validateBrief(brief, deps({ ranked: ["golang-pro"] }))
    const second = validateBrief(brief, deps({ ranked: ["golang-pro"] }))
    expect(second).toEqual(first)
  })
})
