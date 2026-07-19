/**
 * Feature 011 T014 — palette metadata + normative copy for the grouped operator
 * menu. Pins the 12-domain group list (FR2), the derived availability classes
 * (FR3, FR7), the per-verb input-mode map (FR5), and the exact relabelled copy
 * that replaced the old "Operator query: <id>" line (FR4), matching
 * `operator-menu/text-values.cue` + `operator-menu/navigation.cue`.
 */
import { describe, expect, test } from "bun:test"
import {
  OPERATOR_TOP_TITLE,
  OPERATOR_TOP_SUBTITLE,
  OPERATOR_SETTINGS_DOMAINS,
  OPERATOR_INPUT_MODES,
  OPERATOR_PERSISTING_DOMAINS,
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  listOperatorPaletteEntries,
  listOperatorSuggestedEntries,
  listOperatorSettingsEntries,
  type OperatorVerbItem,
} from "../../src/operator"

function verb(items: readonly OperatorVerbItem[], id: string): OperatorVerbItem {
  const item = items.find((v) => v.id === id)
  if (!item) throw new Error(`missing verb ${id}`)
  return item
}

describe("T014 grouped operator menu — top-level copy (FR1, FR4)", () => {
  test("top entry uses the normative title/subtitle, not a dotted id", () => {
    expect(OPERATOR_TOP_TITLE).toBe("Operator")
    expect(OPERATOR_TOP_SUBTITLE).toBe("Grouped operator settings and views")
  })

  test("no retired \"Operator query: <id>\" copy remains on any entry", () => {
    for (const entry of listOperatorPaletteEntries()) {
      expect(entry.title.startsWith("Operator query")).toBe(false)
      expect(entry.title.startsWith("Operator mutation")).toBe(false)
      expect(entry.description.startsWith("Operator query")).toBe(false)
    }
  })
})

describe("T014 group list — 12 domains with badges + counts (FR2)", () => {
  const groups = buildOperatorGroupList()

  test("exactly the 12 reserved domains, in order", () => {
    expect(OPERATOR_SETTINGS_DOMAINS.length).toBe(12)
    expect(groups.length).toBe(12)
    expect(groups.map((g) => g.domain)).toEqual([...OPERATOR_SETTINGS_DOMAINS])
  })

  test("domain-row subtitle matches `{Badge} · {n} views · {m} settings`", () => {
    for (const g of groups) {
      expect(g.subtitle).toBe(`${g.badge} · ${g.viewCount} views · ${g.configureCount} settings`)
      expect(g.label).not.toContain(".")
    }
  })

  test("persisting-only domains badge Available; honest-unavailable badge Unavailable", () => {
    const byDomain = new Map(groups.map((g) => [g.domain, g]))
    expect(byDomain.get("langlock")!.badge).toBe("Available")
    expect(byDomain.get("jobs")!.badge).toBe("Available")
    expect(byDomain.get("routing")!.badge).toBe("Available")
    expect(byDomain.get("task")!.badge).toBe("Available")
    expect(byDomain.get("process")!.badge).toBe("Available")
    expect(byDomain.get("semantic")!.badge).toBe("Unavailable")
    expect(byDomain.get("mcp")!.badge).toBe("Unavailable")
    // Feature 013 flipped the four config-backed domains to persists_today (FR12).
    expect(byDomain.get("telemetry")!.badge).toBe("Available")
    expect(byDomain.get("smart")!.badge).toBe("Available")
    expect(byDomain.get("budget")!.badge).toBe("Available")
    expect(byDomain.get("pools")!.badge).toBe("Available")
  })

  test("counts equal the split of the domain's catalog verbs by section", () => {
    for (const g of groups) {
      const entries = listOperatorSettingsEntries(g.domain)
      expect(g.viewCount).toBe(entries.filter((e) => e.section === "view").length)
      expect(g.configureCount).toBe(entries.filter((e) => e.section === "configure").length)
    }
  })
})

describe("T014 domain panel — View/Configure split + normative subtitles (FR3, FR4)", () => {
  test("langlock splits into read views and editable settings", () => {
    const panel = buildOperatorDomainPanel("langlock")
    expect(panel.view.map((v) => v.id)).toEqual(["langlock.status", "langlock.show"])
    expect(panel.configure.map((v) => v.id)).toEqual(["langlock.set", "langlock.reset"])
    expect(panel.view.every((v) => v.section === "view")).toBe(true)
    expect(panel.configure.every((v) => v.section === "configure")).toBe(true)
  })

  test("view row copy: `Read-only view · {id}`", () => {
    const panel = buildOperatorDomainPanel("langlock")
    expect(verb(panel.view, "langlock.status").subtitle).toBe("Read-only view · langlock.status")
  })

  test("configure (available) copy: `Editable setting · {id}`", () => {
    const panel = buildOperatorDomainPanel("langlock")
    const set = verb(panel.configure, "langlock.set")
    expect(set.subtitle).toBe("Editable setting · langlock.set")
    expect(set.availability).toBe("available")
  })

  test("configure (confirm-required) copy adds `· confirm required`", () => {
    const panel = buildOperatorDomainPanel("jobs")
    const del = verb(panel.configure, "jobs.delete")
    expect(del.subtitle).toBe("Editable setting · confirm required · jobs.delete")
    expect(del.availability).toBe("confirm_required")
    expect(del.confirmRequired).toBe(true)
  })

  test("honest-unavailable copy: `Unavailable · not implemented yet · {id}`", () => {
    const panel = buildOperatorDomainPanel("semantic")
    const add = verb(panel.configure, "semantic.provider.add")
    expect(add.subtitle).toBe("Unavailable · not implemented yet · semantic.provider.add")
    expect(add.availability).toBe("unavailable")
    expect(add.persistence).toBe("honest_unavailable")
  })

  test("secret rows append `· secret`", () => {
    const panel = buildOperatorDomainPanel("mcp")
    const start = verb(panel.configure, "mcp.auth.start")
    expect(start.subtitle).toBe("Unavailable · not implemented yet · mcp.auth.start · secret")
    expect(start.secretRelated).toBe(true)
  })
})

describe("T014 availability + input-mode derivation (FR3, FR5, FR7)", () => {
  test("availability class per sample verb", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    expect(byId.get("langlock.status")!.availability).toBe("available") // read-only
    expect(byId.get("langlock.set")!.availability).toBe("available") // persisting plain mutation
    expect(byId.get("jobs.delete")!.availability).toBe("confirm_required") // persisting confirm mutation
    expect(byId.get("semantic.provider.add")!.availability).toBe("unavailable") // honest-unavailable mutation
  })

  test("persisting-domain set is exactly the nine persisting domains", () => {
    expect([...OPERATOR_PERSISTING_DOMAINS].sort()).toEqual([
      "budget",
      "jobs",
      "langlock",
      "pools",
      "process",
      "routing",
      "smart",
      "task",
      "telemetry",
    ])
  })

  test("input-mode map assigns only the 14 persisting Configure verbs; all others `none`", () => {
    expect(Object.keys(OPERATOR_INPUT_MODES).length).toBe(14)
    expect(OPERATOR_INPUT_MODES["langlock.set"]).toBe("value_picker")
    expect(OPERATOR_INPUT_MODES["jobs.create"]).toBe("text_input")
    expect(OPERATOR_INPUT_MODES["langlock.reset"]).toBe("none")
    // a verb outside the persisting Configure set resolves to `none`
    const status = listOperatorPaletteEntries().find((e) => e.id === "langlock.status")!
    expect(status.inputMode).toBe("none")
    const add = listOperatorPaletteEntries().find((e) => e.id === "semantic.provider.add")!
    expect(add.inputMode).toBe("none")
  })
})

describe("T014 curated suggestions replace the flat wall (FR1)", () => {
  test("suggested set is a strict read-only subset of the full catalog", () => {
    const all = listOperatorPaletteEntries()
    const suggested = listOperatorSuggestedEntries()
    expect(suggested.length).toBeGreaterThan(0)
    expect(suggested.length).toBeLessThan(all.length)
    expect(suggested.every((e) => !e.mutates)).toBe(true)
    expect(suggested.every((e) => !e.secretRelated)).toBe(true)
  })
})
