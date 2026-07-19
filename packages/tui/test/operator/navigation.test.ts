/**
 * Feature 011 T015 — grouped-menu navigation model. Asserts the top-level quick
 * access is the curated read-only subset (no flat per-verb wall, FR1), that Home
 * projects the 12 domain rows (FR2), that a domain panel splits into View and
 * Configure sections (FR3), and that the per-verb routing decision the panel's
 * `onSelectVerb` makes — form vs. direct dispatch — matches the verb's descriptor
 * (FR5, FR7). These are the exact projections + decision functions the
 * `DialogOperatorSettingsHome`/`DialogOperatorDomainPanel` render.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  listOperatorPaletteEntries,
  listOperatorSettingsEntries,
  OPERATOR_SETTINGS_DOMAINS,
  type OperatorPaletteEntry,
} from "@opencode-ai/core/operator"
import { operatorSuggestedEntries } from "../../src/operator/execute"
import { resolveOperatorFormField } from "../../src/operator/form"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

/**
 * The routing branch of `DialogOperatorDomainPanel.onSelectVerb`, isolated: a
 * view verb never dispatches a mutation; a configure verb opens the form iff its
 * descriptor yields a field, else dispatches directly (T011/T012).
 */
function routeFor(e: OperatorPaletteEntry): "view" | "form" | "direct" {
  if (e.section === "view") return "view"
  return resolveOperatorFormField(e) ? "form" : "direct"
}

describe("T015 top-level entry — curated, no flat wall (FR1)", () => {
  test("quick-access is read-only queries only and strictly smaller than the catalog", () => {
    const suggested = operatorSuggestedEntries()
    const all = listOperatorPaletteEntries()
    expect(suggested.length).toBeGreaterThan(0)
    expect(suggested.length).toBeLessThan(all.length)
    expect(suggested.every((e) => !e.mutates)).toBe(true)
    // no mutation ever surfaces as a top-level quick command
    expect(suggested.some((e) => e.mutates)).toBe(false)
  })
})

describe("T015 Home → 12 domain group rows (FR2)", () => {
  test("home lists exactly the 12 reserved domains with a badge subtitle", () => {
    const groups = buildOperatorGroupList()
    expect(groups.map((g) => g.domain)).toEqual([...OPERATOR_SETTINGS_DOMAINS])
    for (const g of groups) {
      expect(g.label.length).toBeGreaterThan(0)
      expect(["Available", "Partial", "Unavailable"]).toContain(g.badge)
      expect(g.subtitle).toContain(g.badge)
    }
  })
})

describe("T015 domain panel → View / Configure split (FR3, FR6)", () => {
  test("langlock panel exposes both sections, each verb tagged with its section", () => {
    const panel = buildOperatorDomainPanel("langlock")
    expect(panel.view.length).toBeGreaterThan(0)
    expect(panel.configure.length).toBeGreaterThan(0)
    expect(panel.view.every((v) => v.section === "view")).toBe(true)
    expect(panel.configure.every((v) => v.section === "configure")).toBe(true)
    // panel rows exactly partition the domain's catalog entries
    const catalog = listOperatorSettingsEntries("langlock")
    expect(panel.view.length + panel.configure.length).toBe(catalog.length)
  })

  test("every View verb is read-only — selecting one can never mutate (FR6)", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      for (const v of buildOperatorDomainPanel(domain).view) {
        expect(entry(v.id).mutates).toBe(false)
        expect(routeFor(entry(v.id))).toBe("view")
      }
    }
  })
})

describe("T015 verb routing decision (FR5, FR7)", () => {
  test("persisting Configure verb with a payload routes to the form", () => {
    expect(routeFor(entry("langlock.set"))).toBe("form")
    expect(routeFor(entry("jobs.create"))).toBe("form")
    expect(routeFor(entry("routing.configure"))).toBe("form")
    expect(routeFor(entry("process.cancel"))).toBe("form")
  })

  test("payload-free Configure verb dispatches directly (no form)", () => {
    expect(routeFor(entry("langlock.reset"))).toBe("direct")
  })

  test("honest-unavailable Configure verb dispatches directly (surfaces the typed envelope)", () => {
    expect(routeFor(entry("semantic.provider.add"))).toBe("direct")
    expect(routeFor(entry("mcp.resource.admin.policy.set"))).toBe("direct")
  })
})
