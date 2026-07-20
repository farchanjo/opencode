/**
 * Feature 014 / T019 — TUI `Partial` availability for the mixed domains (FR12).
 *
 * T012 refined `persistenceFor`/`domainBadge` to per-verb granularity: semantic's
 * config-backed registry mutations persist (T009) while its Milvus-gated
 * index/reindex/cutover/rollback mutations stay capability gaps, and output's two
 * policy setters persist (T007) while its control-store lifecycle mutations stay
 * gaps. The grouped menu MUST therefore derive `Partial` for those two domains,
 * their registry Configure entries MUST be editable, their gated entries MUST
 * surface the typed gap, and every pre-existing domain MUST be unchanged.
 */
import { describe, expect, test } from "bun:test"
import {
  OPERATOR_PERSISTING_VERBS,
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  listOperatorPaletteEntries,
  type OperatorVerbItem,
} from "../../src/operator"

function verb(items: readonly OperatorVerbItem[], id: string): OperatorVerbItem {
  const item = items.find((v) => v.id === id)
  if (!item) throw new Error(`missing verb ${id}`)
  return item
}

// The nine semantic config-backed registry mutations (T009).
const SEMANTIC_REGISTRY = [
  "semantic.provider.add",
  "semantic.provider.update",
  "semantic.provider.disable",
  "semantic.provider.delete",
  "semantic.provider.rotate-secret",
  "semantic.model.register",
  "semantic.model.disable",
  "semantic.embedding.select",
  "semantic.reranker.select",
] as const

// The Milvus-gated semantic mutations that stay honest-unavailable in the default
// (unconfigured) palette. Feature 019 T018 moved `reranker.cutover`/`rollback` OUT of
// this set — they route through the config-backed registry with no Milvus dependency,
// so they flip to persists_today unconditionally (see feature019-availability.test.ts).
const SEMANTIC_GATED = [
  "semantic.embedding.reindex",
  "semantic.embedding.cutover",
  "semantic.embedding.rollback",
  "semantic.index.reindex",
  "semantic.index.reconcile",
] as const

describe("T019 — mixed domains derive Partial", () => {
  const groups = new Map(buildOperatorGroupList().map((g) => [g.domain, g]))

  test("semantic and output render Partial with the confirm_required availability", () => {
    for (const domain of ["semantic", "output"]) {
      const g = groups.get(domain)!
      expect(g.badge).toBe("Partial")
      expect(g.availability).toBe("confirm_required")
      expect(g.subtitle).toBe(`Partial · ${g.viewCount} views · ${g.configureCount} settings`)
    }
  })

  test("mcp becomes Partial after Feature 017; a fully-persisting domain (langlock) stays Available", () => {
    // Feature 017 flipped mcp from fully-gated to mixed: config/live/auth-remove
    // mutations persist, auth.start/finish + resource subscribe/unsubscribe stay gaps.
    expect(groups.get("mcp")!.badge).toBe("Partial")
    expect(groups.get("langlock")!.badge).toBe("Available")
  })
})

describe("T019 — semantic per-verb truthfulness (FR12)", () => {
  const panel = buildOperatorDomainPanel("semantic")

  test("every registry Configure entry is editable (persists_today, never unavailable)", () => {
    for (const id of SEMANTIC_REGISTRY) {
      const item = verb(panel.configure, id)
      expect(item.persistence).toBe("persists_today")
      expect(item.availability).not.toBe("unavailable")
      expect(["available", "confirm_required"]).toContain(item.availability)
    }
  })

  test("every Milvus-gated Configure entry surfaces the typed gap", () => {
    for (const id of SEMANTIC_GATED) {
      const item = verb(panel.configure, id)
      expect(item.persistence).toBe("honest_unavailable")
      expect(item.availability).toBe("unavailable")
      expect(item.subtitle).toContain("not implemented yet")
    }
  })

  test("no registry verb advertises persistence it lacks, no gated verb reads persisting", () => {
    const persisting = new Set<string>(OPERATOR_PERSISTING_VERBS)
    for (const id of SEMANTIC_REGISTRY) expect(persisting.has(id)).toBe(true)
    for (const id of SEMANTIC_GATED) expect(persisting.has(id)).toBe(false)
  })
})

describe("T019 — output per-verb truthfulness (FR12)", () => {
  const panel = buildOperatorDomainPanel("output")

  test("the policy setters + Feature 017 admin edge persist; export/share stay gated", () => {
    expect(verb(panel.configure, "output.retention.set").persistence).toBe("persists_today")
    expect(verb(panel.configure, "output.quota.set").persistence).toBe("persists_today")
    // Feature 017 T014 — the store-scoped admin edge now commits release/delete/purge.
    for (const id of ["output.release", "output.delete", "output.purge"]) {
      expect(verb(panel.configure, id).persistence).toBe("persists_today")
    }
    // export/share remain honest capability gaps by design (FR16).
    for (const id of ["output.export", "output.share"]) {
      expect(verb(panel.configure, id).persistence).toBe("honest_unavailable")
    }
  })
})

describe("T019 — pre-existing domains unchanged", () => {
  test("read views stay available; no persisting domain regressed to Partial", () => {
    const groups = new Map(buildOperatorGroupList().map((g) => [g.domain, g]))
    for (const domain of ["telemetry", "smart", "budget", "pools", "langlock", "jobs", "routing", "process", "task"]) {
      expect(groups.get(domain)!.badge).toBe("Available")
    }
  })

  test("registry verbs are editable via the input form; gated verbs dispatch directly", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    expect(byId.get("semantic.provider.add")!.inputMode).toBe("text_input")
    expect(byId.get("semantic.embedding.select")!.inputMode).toBe("text_input")
    expect(byId.get("output.retention.set")!.inputMode).toBe("text_input")
    for (const id of SEMANTIC_GATED) expect(byId.get(id)!.inputMode).toBe("none")
  })
})
