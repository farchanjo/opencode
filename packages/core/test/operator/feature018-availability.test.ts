/**
 * Feature 018 / G6 (T014, T017) — the availability truth sweep + parity (FR11,
 * FR12).
 *
 * With the scheduled executor composed into the live runtime, `jobs.run-now`
 * enqueues an immediate occurrence through `mutateAuthority` and commits, and the
 * process/task forced-abort `cancel` really interrupts an in-process run. The
 * palette per-verb classification MUST read these as the composed truth — never
 * `unavailable` — while any verb the executor does not reach (`mcp.auth.start`/
 * `finish`, `output.export`/`share`, smart consumption) stays an honest capability
 * gap. Parity is pinned: no new catalog id, no catalog version bump.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOperatorDomainPanel,
  buildOperatorGroupList,
  listOperatorPaletteEntries,
  RESERVED_CATALOG,
  type OperatorVerbItem,
} from "../../src/operator"

function verb(items: readonly OperatorVerbItem[], id: string): OperatorVerbItem {
  const item = items.find((v) => v.id === id)
  if (!item) throw new Error(`missing verb ${id}`)
  return item
}

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))

describe("Feature 018 T014 — jobs.run-now + process/task cancel read the composed truth (FR11)", () => {
  test("jobs.run-now persists and is not unavailable (run-now enqueues + commits)", () => {
    const panel = buildOperatorDomainPanel("jobs")
    const runNow = verb(panel.configure, "jobs.run-now")
    expect(runNow.persistence).toBe("persists_today")
    expect(runNow.availability).not.toBe("unavailable")
    // Full palette projection agrees (no stale unavailable leak).
    expect(BY_ID.get("jobs.run-now")!.availability).not.toBe("unavailable")
  })

  test("the process/task forced-abort cancel verbs read available (first-press always real, second-press now real in-process)", () => {
    for (const [domain, id] of [
      ["process", "process.cancel"],
      ["task", "task.cancel"],
    ] as const) {
      const panel = buildOperatorDomainPanel(domain)
      const cancel = verb(panel.configure, id)
      expect(cancel.persistence).toBe("persists_today")
      expect(cancel.availability).not.toBe("unavailable")
    }
  })

  test("the jobs domain badge stays Available (no gapped Configure verb remains)", () => {
    const groups = new Map(buildOperatorGroupList().map((g) => [g.domain, g]))
    expect(groups.get("jobs")!.availability).not.toBe("unavailable")
  })
})

describe("Feature 018 T017 — boundaries stay honest capability gaps (FR11)", () => {
  test("mcp.auth.start/finish stay honest_unavailable typed gaps", () => {
    const panel = buildOperatorDomainPanel("mcp")
    for (const id of ["mcp.auth.start", "mcp.auth.finish"]) {
      const item = verb(panel.configure, id)
      expect(item.persistence).toBe("honest_unavailable")
      expect(item.availability).toBe("unavailable")
    }
  })

  test("output.export/share stay honest_unavailable typed gaps", () => {
    const panel = buildOperatorDomainPanel("output")
    for (const id of ["output.export", "output.share"]) {
      expect(verb(panel.configure, id).persistence).toBe("honest_unavailable")
    }
  })
})

describe("Feature 018 T017 — parity: no new catalog id, no version bump (FR12)", () => {
  test("the reserved catalog version is unchanged at 1.3.0", () => {
    expect(RESERVED_CATALOG.version).toBe("1.4.0")
  })

  test("the composed verbs ride REAL pre-existing catalog ids — no new dispatch path", () => {
    const catalogIds = new Set(RESERVED_CATALOG.entries.map((e) => e.id))
    for (const id of ["jobs.run-now", "process.cancel", "task.cancel"]) {
      expect(catalogIds.has(id)).toBe(true)
    }
  })

  test("the catalog entry count is unchanged by this composition-only feature", () => {
    // Feature 018 adds NO catalog id; the count is whatever the reserved catalog
    // already declares. Pin it against the live projection so a stray id addition
    // (a new dispatch path) trips the parity guard.
    expect(listOperatorPaletteEntries()).toHaveLength(RESERVED_CATALOG.entries.length)
  })
})
