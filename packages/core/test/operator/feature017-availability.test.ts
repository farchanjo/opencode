/**
 * Feature 017 / T017 (FR15) — the palette availability flip to the new truth.
 *
 * T008/T009/T010 made the config-backed MCP mutations, the live-service connection
 * actions, and `auth.remove` commit honestly; T014 wired the output control-store
 * admin edge (release/delete/purge). The palette per-verb classification MUST now
 * flip those verbs from `honest_unavailable` to `persists_today` while keeping the
 * genuine capability gaps — `auth.start`/`finish`, resource subscribe/unsubscribe,
 * and output export/share — honest. No verb advertises persistence it lacks, and
 * no verb that now works reads as `unavailable`.
 */
import { describe, expect, test } from "bun:test"
import {
  OPERATOR_PERSISTING_VERBS,
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

// The MCP mutations now committing honestly (T008 config + T009 live + T010 auth.remove).
const MCP_NOW_REAL = [
  "mcp.server.add",
  "mcp.server.update",
  "mcp.server.delete",
  "mcp.server.disable",
  "mcp.server.connect",
  "mcp.server.disconnect",
  "mcp.server.reconnect",
  "mcp.logging.level.set",
  "mcp.experimental.enable",
  "mcp.experimental.disable",
  "mcp.extension.enable",
  "mcp.extension.disable",
  "mcp.resource.admin.policy.set",
  "mcp.auth.remove",
] as const

// The MCP mutations that stay typed capability gaps by design (FR16).
const MCP_STILL_GAPPED = [
  "mcp.auth.start",
  "mcp.auth.finish",
  "mcp.resource.admin.subscribe",
  "mcp.resource.admin.unsubscribe",
] as const

describe("T017 — mcp flips to a mixed (Partial) domain", () => {
  const groups = new Map(buildOperatorGroupList().map((g) => [g.domain, g]))
  const panel = buildOperatorDomainPanel("mcp")

  test("the mcp domain renders the honest Partial badge", () => {
    expect(groups.get("mcp")!.badge).toBe("Partial")
    expect(groups.get("mcp")!.availability).toBe("confirm_required")
  })

  test("every newly-real mcp mutation reads persists_today and is not unavailable", () => {
    for (const id of MCP_NOW_REAL) {
      const item = verb(panel.configure, id)
      expect(item.persistence).toBe("persists_today")
      expect(item.availability).not.toBe("unavailable")
    }
  })

  test("the deferred mcp mutations stay honest capability gaps", () => {
    for (const id of MCP_STILL_GAPPED) {
      const item = verb(panel.configure, id)
      expect(item.persistence).toBe("honest_unavailable")
      expect(item.availability).toBe("unavailable")
    }
  })
})

describe("T017 — output control-store admin edge flips to real", () => {
  const panel = buildOperatorDomainPanel("output")

  test("release/delete/purge persist; export/share stay honest gaps", () => {
    for (const id of ["output.release", "output.delete", "output.purge"]) {
      expect(verb(panel.configure, id).persistence).toBe("persists_today")
    }
    for (const id of ["output.export", "output.share"]) {
      expect(verb(panel.configure, id).persistence).toBe("honest_unavailable")
    }
  })
})

describe("T017 — persisting-set truthfulness + parity (FR15, FR17)", () => {
  test("no gapped verb leaked into the persisting set; every persisting verb is real", () => {
    const persisting = new Set<string>(OPERATOR_PERSISTING_VERBS)
    for (const id of MCP_NOW_REAL) expect(persisting.has(id)).toBe(true)
    for (const id of MCP_STILL_GAPPED) expect(persisting.has(id)).toBe(false)
    for (const id of ["output.release", "output.delete", "output.purge"]) expect(persisting.has(id)).toBe(true)
  })

  test("every persisting verb rides a REAL catalog id — no new dispatch path (FR17)", () => {
    const catalogIds = new Set(RESERVED_CATALOG.entries.map((e) => e.id))
    for (const id of OPERATOR_PERSISTING_VERBS) expect(catalogIds.has(id)).toBe(true)
  })

  test("no newly-real verb reads as unavailable in the full palette projection", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    for (const id of [...MCP_NOW_REAL, "output.release", "output.delete", "output.purge"]) {
      expect(byId.get(id)!.availability).not.toBe("unavailable")
    }
  })
})
