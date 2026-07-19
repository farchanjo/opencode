/**
 * Feature 013 / T020 — TUI availability for the four config-backed domains (FR12).
 *
 * The `OPERATOR_PERSISTING_DOMAINS` flip (T011) moves telemetry/smart/budget/pools
 * from `honest_unavailable` to `persists_today`, so their palette rows read
 * "Available" and their Configure entries become editable. This pins the derived
 * availability map directly (not just the badge copy) and guards that the five
 * pre-existing persisting domains are untouched.
 */
import { describe, expect, test } from "bun:test"
import {
  OPERATOR_PERSISTING_DOMAINS,
  buildOperatorDomainPanel,
  listOperatorPaletteEntries,
  type OperatorVerbItem,
} from "../../src/operator"

const FEATURE_013_DOMAINS = ["telemetry", "smart", "budget", "pools"] as const
const PRE_EXISTING_PERSISTING = ["langlock", "jobs", "routing", "process", "task"] as const

function verb(items: readonly OperatorVerbItem[], id: string): OperatorVerbItem {
  const item = items.find((v) => v.id === id)
  if (!item) throw new Error(`missing verb ${id}`)
  return item
}

describe("T020 — the four domains report persists_today", () => {
  test("OPERATOR_PERSISTING_DOMAINS includes the four config-backed domains", () => {
    for (const domain of FEATURE_013_DOMAINS) {
      expect(OPERATOR_PERSISTING_DOMAINS).toContain(domain)
    }
  })

  test("every view + configure verb of the four domains resolves persists_today (never honest_unavailable)", () => {
    for (const domain of FEATURE_013_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      const rows = [...panel.view, ...panel.configure]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.persistence).toBe("persists_today")
      }
    }
  })
})

describe("T020 — the Configure entries are editable, not unavailable", () => {
  test("each domain's Configure verbs are available/confirm_required, never unavailable", () => {
    for (const domain of FEATURE_013_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      expect(panel.configure.length).toBeGreaterThan(0)
      for (const row of panel.configure) {
        expect(row.section).toBe("configure")
        expect(["available", "confirm_required"]).toContain(row.availability)
        expect(row.availability).not.toBe("unavailable")
      }
    }
  })

  test("the read views stay available read-only rows", () => {
    for (const domain of FEATURE_013_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      for (const row of panel.view) {
        expect(row.section).toBe("view")
        expect(row.availability).toBe("available")
      }
    }
  })

  test("representative editable Configure entries per domain", () => {
    expect(verb(buildOperatorDomainPanel("telemetry").configure, "telemetry.on").availability).toBe("available")
    expect(verb(buildOperatorDomainPanel("smart").configure, "smart.auto").availability).toBe("available")
    expect(verb(buildOperatorDomainPanel("budget").configure, "budget.set").availability).toBe("available")
    expect(verb(buildOperatorDomainPanel("pools").configure, "pools.set").availability).toBe("available")
  })
})

describe("T020 — the pre-existing persisting domains are unchanged", () => {
  test("langlock/jobs/routing/process/task still persist their mutations", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    // A representative persisting mutation per domain stays editable.
    for (const id of ["langlock.set", "jobs.create", "routing.configure", "process.cancel", "task.cancel"]) {
      const entry = byId.get(id)
      if (!entry) continue
      expect(entry.persistence).toBe("persists_today")
    }
  })

  test("no honest-unavailable domain leaked into the persisting set", () => {
    for (const domain of ["semantic", "mcp", "output"]) {
      expect(OPERATOR_PERSISTING_DOMAINS).not.toContain(domain)
    }
    expect([...OPERATOR_PERSISTING_DOMAINS].sort()).toEqual(
      [...FEATURE_013_DOMAINS, ...PRE_EXISTING_PERSISTING].sort(),
    )
  })
})
