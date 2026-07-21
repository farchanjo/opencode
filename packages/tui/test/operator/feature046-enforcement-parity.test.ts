/**
 * Feature 046 — the TUI operator forms for the hierarchy/capability/budget
 * enforcement leaves, generated from the SHARED
 * `@opencode-ai/protocol/enforcement/leaves` registry the op CLI backend also
 * validates against. Pins:
 *   - every registry leaf of a domain is a TUI field for its `.set`/`.configure`
 *     verb, and every TUI enforcement field maps back to a registry leaf (op↔TUI
 *     parity, FR4/FR10 — the two surfaces cannot drift);
 *   - fields prefill from the effective read's `leaves` map (FR10);
 *   - `composePayload` yields the byte-exact `{ values: { … } }` partial payload,
 *     carrying ONLY the leaves the operator set (FR7);
 *   - an out-of-bounds numeric and an unknown enum member are rejected IN-MODAL
 *     (the SAME validation the backend applies, FR9).
 */
import { describe, expect, test } from "bun:test"
import { composePayload, resolveOperatorFieldList } from "../../src/operator/form/field-list"
import { EnforcementLeaves, type EnforcementDomain } from "@opencode-ai/protocol/enforcement/leaves"

const CASES: ReadonlyArray<{ readonly verb: string; readonly domain: EnforcementDomain }> = [
  { verb: "hierarchy.set", domain: "hierarchy" },
  { verb: "capability.set", domain: "capability" },
  { verb: "budget.configure", domain: "budget" },
]

describe("Feature 046 — op↔TUI leaf parity (single shared registry)", () => {
  for (const { verb, domain } of CASES) {
    test(`${verb} exposes EXACTLY the ${domain} registry leaves`, () => {
      const descriptor = resolveOperatorFieldList(verb)
      expect(descriptor).toBeDefined()
      const fieldKeys = descriptor!.fields.map((f) => f.key).sort()
      const leafKeys = EnforcementLeaves.leavesForDomain(domain).map((l) => l.key).sort()
      expect(fieldKeys).toEqual(leafKeys)
    })
  }
})

describe("Feature 046 — fields prefill from the effective leaves map", () => {
  test("hierarchy.set prefills max_depth from effective.leaves", () => {
    const fields = resolveOperatorFieldList("hierarchy.set")!.fields
    const effective = { leaves: { maxDepth: 1, orchestrationOnly: false } }
    expect(fields.find((f) => f.key === "maxDepth")!.prefill!(effective)).toBe("1")
    expect(fields.find((f) => f.key === "orchestrationOnly")!.prefill!(effective)).toBe("false")
  })

  test("capability.set prefills the enum + boolean leaves", () => {
    const fields = resolveOperatorFieldList("capability.set")!.fields
    const effective = { leaves: { metadataSource: "observed", unknownPolicy: "allow", probingEnabled: true } }
    expect(fields.find((f) => f.key === "metadataSource")!.prefill!(effective)).toBe("observed")
    expect(fields.find((f) => f.key === "probingEnabled")!.prefill!(effective)).toBe("true")
  })
})

describe("Feature 046 — composePayload yields the partial { values } payload", () => {
  test("only the leaves the operator entered ride the wire — an untouched toggle is dropped", () => {
    const descriptor = resolveOperatorFieldList("hierarchy.set")!
    // Operator sets max_depth only; orchestration_only left blank (unseeded toggle) →
    // DROPPED, never force-emitted as false (persist-only-set, FR7).
    const out = composePayload(descriptor, { maxDepth: "1" })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.payload).toEqual({ values: { maxDepth: 1 } })
  })

  test("a seeded/toggled boolean leaf IS emitted with its state", () => {
    const descriptor = resolveOperatorFieldList("hierarchy.set")!
    const out = composePayload(descriptor, { orchestrationOnly: "false" })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.payload).toEqual({ values: { orchestrationOnly: false } })
  })

  test("budget.configure composes a single numeric leaf under values", () => {
    const descriptor = resolveOperatorFieldList("budget.configure")!
    const out = composePayload(descriptor, { costBudgetUsd: "3.5" })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.payload.values).toMatchObject({ costBudgetUsd: 3.5 })
  })
})

describe("Feature 046 — in-modal validation mirrors the backend (FR9)", () => {
  test("an out-of-bounds hierarchy.max_depth is rejected in-modal", () => {
    const descriptor = resolveOperatorFieldList("hierarchy.set")!
    const out = composePayload(descriptor, { maxDepth: "5" })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain("maxDepth")
  })

  test("a non-numeric budget leaf is rejected in-modal", () => {
    const descriptor = resolveOperatorFieldList("budget.configure")!
    const out = composePayload(descriptor, { maxWorkers: "abc" })
    expect(out.ok).toBe(false)
  })
})
