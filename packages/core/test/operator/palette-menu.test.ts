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
  MAX_ROW_COMMAND_ID,
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  operatorSectionOrder,
  operatorRowSubtitle,
  listOperatorPaletteEntries,
  listOperatorSettingsEntries,
  type OperatorVerbItem,
  type OperatorVerbSection,
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

  test("exactly the 14 reserved domains, in order", () => {
    expect(OPERATOR_SETTINGS_DOMAINS.length).toBe(14)
    expect(groups.length).toBe(14)
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
    // Feature 014 T012 (FR12): semantic is now a mixed domain — the config-backed
    // registry verbs persist while the Milvus-gated index verbs stay gated → Partial.
    expect(byDomain.get("semantic")!.badge).toBe("Partial")
    // output likewise: retention/quota persist, the lifecycle mutations stay gated.
    expect(byDomain.get("output")!.badge).toBe("Partial")
    // Feature 017 T008/T009/T010 flipped mcp to a mixed domain: the config-backed
    // mutations, live connection actions, and auth.remove commit honestly while
    // auth.start/finish and resource subscribe/unsubscribe stay typed gaps → Partial.
    expect(byDomain.get("mcp")!.badge).toBe("Partial")
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

  // Feature 016 FR3: the row copy contract dropped the `Read-only view ·` /
  // `Editable setting ·` boilerplate — the section header alone carries the kind.
  // The subtitle carries only an availability marker (when NOT fully available)
  // plus the dotted id (only when it fits without truncation).
  test("view row copy: the bare id, no `Read-only view ·` boilerplate (FR3)", () => {
    const panel = buildOperatorDomainPanel("langlock")
    const status = verb(panel.view, "langlock.status")
    expect(status.subtitle).toBe("langlock.status")
    expect(status.subtitle).not.toContain("Read-only view")
  })

  test("configure (available) copy: the bare id, no `Editable setting ·` boilerplate (FR3)", () => {
    const panel = buildOperatorDomainPanel("langlock")
    const set = verb(panel.configure, "langlock.set")
    expect(set.subtitle).toBe("langlock.set")
    expect(set.subtitle).not.toContain("Editable setting")
    expect(set.availability).toBe("available")
  })

  test("configure (confirm-required) carries the `confirm required` marker, no boilerplate (FR3)", () => {
    const panel = buildOperatorDomainPanel("jobs")
    const del = verb(panel.configure, "jobs.delete")
    expect(del.subtitle).toBe("confirm required · jobs.delete")
    expect(del.subtitle).not.toContain("Editable setting")
    expect(del.availability).toBe("confirm_required")
    expect(del.confirmRequired).toBe(true)
  })

  test("honest-unavailable Milvus-gated copy names the dependency (FR3, FR14)", () => {
    const panel = buildOperatorDomainPanel("semantic")
    // Feature 014 T012: the Milvus-gated index verbs remain honest-unavailable.
    const reindex = verb(panel.configure, "semantic.index.reindex")
    expect(reindex.subtitle).toBe("Unavailable · requires Milvus · semantic.index.reindex")
    expect(reindex.availability).toBe("unavailable")
    expect(reindex.persistence).toBe("honest_unavailable")
  })

  test("Feature 014 T012: the config-backed registry verbs are editable, not unavailable", () => {
    const panel = buildOperatorDomainPanel("semantic")
    const add = verb(panel.configure, "semantic.provider.add")
    // a fully-available verb carries no marker — just its id (FR3).
    expect(add.subtitle).toBe("semantic.provider.add")
    expect(add.availability).toBe("available")
    expect(add.persistence).toBe("persists_today")
    // a confirm-required registry mutation still persists.
    const del = verb(panel.configure, "semantic.provider.delete")
    expect(del.availability).toBe("confirm_required")
    expect(del.persistence).toBe("persists_today")
  })

  test("secret rows carry the `secret` marker (ordered before the id, FR3)", () => {
    const panel = buildOperatorDomainPanel("mcp")
    const start = verb(panel.configure, "mcp.auth.start")
    expect(start.subtitle).toBe("Unavailable · requires interactive surface · secret · mcp.auth.start")
    expect(start.secretRelated).toBe(true)
  })

  test("a command id longer than the bound is omitted, never truncated mid-token (FR3)", () => {
    const panel = buildOperatorDomainPanel("semantic")
    // `semantic.provider.rotate-secret` (31 chars) exceeds MAX_ROW_COMMAND_ID (28):
    // the id is dropped from the secondary line; only the markers remain (this verb
    // persists + is confirm-required + secret).
    const rotate = verb(panel.configure, "semantic.provider.rotate-secret")
    expect(rotate.subtitle).not.toContain("semantic.provider.rotate-secret")
    expect(rotate.subtitle).toBe("confirm required · secret")
  })
})

describe("T014 availability + input-mode derivation (FR3, FR5, FR7)", () => {
  test("availability class per sample verb", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    expect(byId.get("langlock.status")!.availability).toBe("available") // read-only
    expect(byId.get("langlock.set")!.availability).toBe("available") // persisting plain mutation
    expect(byId.get("jobs.delete")!.availability).toBe("confirm_required") // persisting confirm mutation
    expect(byId.get("semantic.provider.add")!.availability).toBe("available") // T012 config-backed registry mutation
    expect(byId.get("semantic.index.reindex")!.availability).toBe("unavailable") // Milvus-gated mutation
  })

  test("persisting-domain set is exactly the eleven persisting domains", () => {
    expect([...OPERATOR_PERSISTING_DOMAINS].sort()).toEqual([
      "budget",
      "capability",
      "hierarchy",
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

  test("input-mode map assigns the persisting Configure verbs; all others `none`", () => {
    // Feature 014 T012 added the 9 semantic registry + 2 output policy setters.
    expect(Object.keys(OPERATOR_INPUT_MODES).length).toBe(25)
    expect(OPERATOR_INPUT_MODES["langlock.set"]).toBe("value_picker")
    expect(OPERATOR_INPUT_MODES["jobs.create"]).toBe("text_input")
    expect(OPERATOR_INPUT_MODES["langlock.reset"]).toBe("none")
    expect(OPERATOR_INPUT_MODES["semantic.embedding.select"]).toBe("text_input")
    expect(OPERATOR_INPUT_MODES["output.retention.set"]).toBe("text_input")
    // a verb outside the persisting Configure set resolves to `none`
    const status = listOperatorPaletteEntries().find((e) => e.id === "langlock.status")!
    expect(status.inputMode).toBe("none")
    // the config-backed registry mutation is now editable (T012)
    const add = listOperatorPaletteEntries().find((e) => e.id === "semantic.provider.add")!
    expect(add.inputMode).toBe("text_input")
    // a Milvus-gated mutation stays `none` (no form for a capability gap)
    const reindex = listOperatorPaletteEntries().find((e) => e.id === "semantic.index.reindex")!
    expect(reindex.inputMode).toBe("none")
  })
})

describe("Feature 015 T002 — the `suggest` machinery is retired (FR2)", () => {
  test("no palette entry carries a `suggest` field", () => {
    for (const entry of listOperatorPaletteEntries()) {
      expect("suggest" in entry).toBe(false)
    }
  })
})

describe("Feature 015 T003 — unique row-title copy contract (FR3)", () => {
  test("entry-level titles are domain-qualified `{Domain} {action}`, never a dotted id", () => {
    for (const entry of listOperatorPaletteEntries()) {
      // domain-qualified: the human title starts with the humanised domain label.
      const domainLabel = entry.domain.charAt(0).toUpperCase() + entry.domain.slice(1)
      expect(entry.title.startsWith(`${domainLabel} `)).toBe(true)
      // the dotted id is never the primary label.
      expect(entry.title).not.toContain(".")
      expect(entry.title).not.toBe(entry.id)
    }
  })

  test("entry-level titles are globally unique — no `View: Status` ×8 duplication", () => {
    const titles = listOperatorPaletteEntries().map((e) => e.title)
    expect(new Set(titles).size).toBe(titles.length)
    expect(titles.some((t) => t === "View: Status")).toBe(false)
  })

  test("each domain panel's rows carry a unique human title, id secondary only when it fits (FR3)", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      const rows = [...panel.view, ...panel.configure]
      const labels = rows.map((r) => r.label)
      // no two rows on this surface share a human title.
      expect(new Set(labels).size).toBe(labels.length)
      for (const row of rows) {
        // the primary label is never the dotted id.
        expect(row.label).not.toBe(row.id)
        expect(row.label).not.toContain(".")
        // Feature 016 FR3: the id lives in the subtitle only when it fits without
        // truncation, and is omitted (never truncated mid-token) otherwise.
        if (row.id.length <= MAX_ROW_COMMAND_ID) expect(row.subtitle).toContain(row.id)
        else expect(row.subtitle).not.toContain(row.id)
      }
    }
  })
})

describe("Feature 016 T005 — the `operatorRowSubtitle` copy contract (FR3)", () => {
  test("a fully-available verb whose id fits reads as the bare id, no boilerplate/marker", () => {
    expect(operatorRowSubtitle({ commandId: "langlock.status", availability: "available" })).toBe("langlock.status")
  })

  test("a confirm-required verb prefixes the `confirm required` marker", () => {
    expect(operatorRowSubtitle({ commandId: "jobs.delete", availability: "confirm_required" })).toBe(
      "confirm required · jobs.delete",
    )
  })

  test("an unavailable verb keeps the `Unavailable · not implemented yet` marker", () => {
    expect(operatorRowSubtitle({ commandId: "mcp.export", availability: "unavailable" })).toBe(
      "Unavailable · not implemented yet · mcp.export",
    )
  })

  test("a secret marker is ordered before the id and combines with unavailable", () => {
    expect(operatorRowSubtitle({ commandId: "mcp.auth.start", availability: "unavailable", secretRelated: true })).toBe(
      "Unavailable · requires interactive surface · secret · mcp.auth.start",
    )
  })

  test("an id longer than MAX_ROW_COMMAND_ID is omitted (never truncated mid-token)", () => {
    const longId = "semantic.provider.rotate-secret"
    expect(longId.length).toBeGreaterThan(MAX_ROW_COMMAND_ID)
    // available + long id → no secondary line at all.
    expect(operatorRowSubtitle({ commandId: longId, availability: "available" })).toBe("")
    // unavailable + long id → only the marker survives, the id is dropped.
    expect(operatorRowSubtitle({ commandId: longId, availability: "unavailable" })).toBe(
      "Unavailable · not implemented yet",
    )
  })
})

describe("Feature 016 T008 — Configure-before-View section order centralised in palette (FR4)", () => {
  test("a domain with editable state orders Configure before View", () => {
    for (const domain of ["mcp", "jobs", "semantic", "langlock", "telemetry"]) {
      const panel = buildOperatorDomainPanel(domain)
      expect(panel.configure.length).toBeGreaterThan(0)
      expect(operatorSectionOrder(domain)).toEqual(["configure", "view"])
    }
  })

  test("a pure read-only domain keeps View leading", () => {
    // Synthesised guard: any domain with no configure verbs leads with View. Every
    // reserved domain today has editable state, so assert the projection's rule
    // directly on the section counts rather than fabricating a domain.
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      const expected: readonly OperatorVerbSection[] = panel.configure.length > 0 ? ["configure", "view"] : ["view"]
      expect([...operatorSectionOrder(domain)]).toEqual([...expected])
      // the order always ends with View — View is never dropped.
      expect(operatorSectionOrder(domain).at(-1)).toBe("view")
    }
  })
})
