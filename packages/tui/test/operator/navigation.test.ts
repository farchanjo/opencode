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
import { buildOperatorPaletteCommands } from "@opencode-ai/core/operator"
import * as executeModule from "../../src/operator/execute"
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

describe("Feature 015 T001/T002 — one Operator entry, suggest machinery retired (FR1, FR2)", () => {
  test("the suggested-spread re-export is gone from the execute module", () => {
    expect("operatorSuggestedEntries" in executeModule).toBe(false)
  })

  test("every read-only verb stays reachable through the grouped domain panels", () => {
    // FR1 discoverability compensation: with the top-level spread removed, each
    // read-only verb is still reached through the single grouped Operator entry.
    const readOnly = listOperatorPaletteEntries().filter((e) => !e.mutates)
    expect(readOnly.length).toBeGreaterThan(0)
    const panelViewIds = new Set(
      OPERATOR_SETTINGS_DOMAINS.flatMap((d) => buildOperatorDomainPanel(d).view.map((v) => v.id)),
    )
    for (const e of readOnly) expect(panelViewIds.has(e.id)).toBe(true)
  })
})

describe("Feature 015 T019 — palette-command registrations carry no suggested spread (FR1, FR2)", () => {
  test("no `/op.*` command registration carries the retired `suggested` field", () => {
    // app.tsx builds the top-level Commands from `buildOperatorPaletteCommands()`;
    // the retired suggested-spread field must not resurface on any registration.
    for (const command of buildOperatorPaletteCommands()) {
      expect("suggested" in command).toBe(false)
    }
  })

  test("every registration resolves to its canonical `/op.<id>` command name (one loopback, no divergent path)", () => {
    const commands = buildOperatorPaletteCommands()
    expect(commands.length).toBeGreaterThan(0)
    const names = commands.map((c) => c.name)
    // command names are unique — no duplicated Operator entry per verb.
    expect(new Set(names).size).toBe(names.length)
    for (const command of commands) expect(command.name).toBe(`operator.${command.id}`)
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
    // Feature 014 T012: the config-backed registry + output policy verbs are editable.
    expect(routeFor(entry("semantic.provider.add"))).toBe("form")
    expect(routeFor(entry("semantic.embedding.select"))).toBe("form")
    expect(routeFor(entry("output.retention.set"))).toBe("form")
  })

  test("payload-free Configure verb dispatches directly (no form)", () => {
    expect(routeFor(entry("langlock.reset"))).toBe("direct")
  })

  test("honest-unavailable Configure verb dispatches directly (surfaces the typed envelope)", () => {
    // Milvus-gated + fully-gated mcp mutations keep no form → direct dispatch.
    expect(routeFor(entry("semantic.index.reindex"))).toBe("direct")
    expect(routeFor(entry("mcp.resource.admin.policy.set"))).toBe("direct")
  })
})
