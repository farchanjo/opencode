/**
 * Feature 019 / T018, T023 (FR14, FR15) — the availability truth flip + parity.
 *
 * Group A composed the reranker cutover/rollback over the config-backed registry
 * with NO Milvus dependency (T001-T003), so those verbs flip UNCONDITIONALLY to the
 * composed truth. The Milvus-conditional embedding/index verbs (T006-T009), the
 * interactive-conditional `mcp.auth.start`/`finish` (T010), and the capability-gated
 * resource subscribe/unsubscribe (T011) reflect the composed truth ONLY when their
 * `#BackendReadiness` dependency is present; the default (unconfigured Milvus /
 * headless surface / absent capability) stays the honest typed gap (FR14). Parity is
 * pinned: no new catalog id, no catalog version bump, no new dispatch path (FR15).
 */
import { describe, expect, test } from "bun:test"
import {
  OPERATOR_PERSISTING_VERBS,
  buildOperatorDomainPanel,
  buildOperatorGroupList,
  listOperatorPaletteEntries,
  RESERVED_CATALOG,
  type OperatorBackendReadiness,
  type OperatorPaletteEntry,
} from "../../src/operator"

function byId(readiness?: OperatorBackendReadiness): Map<string, OperatorPaletteEntry> {
  return new Map(listOperatorPaletteEntries(readiness ? { readiness } : {}).map((e) => [e.id, e]))
}

// The reranker lifecycle verbs Group A made UNCONDITIONALLY real (config-backed, no Milvus).
const RERANKER_UNCONDITIONAL = ["semantic.reranker.cutover", "semantic.reranker.rollback"] as const

// The Milvus-conditional embedding + index maintenance verbs (composed truth needs `milvusConfigured`).
const MILVUS_CONDITIONAL = [
  "semantic.embedding.reindex",
  "semantic.embedding.cutover",
  "semantic.embedding.rollback",
  "semantic.index.reindex",
  "semantic.index.reconcile",
] as const

// The interactive-conditional auth-delegation verbs (composed truth needs `interactiveSurface`).
const AUTH_INTERACTIVE = ["mcp.auth.start", "mcp.auth.finish"] as const

// The capability-gated resource subscription verbs (composed truth needs `subscriptionCapable`).
const SUBSCRIPTION_CAPABILITY = ["mcp.resource.admin.subscribe", "mcp.resource.admin.unsubscribe"] as const

describe("T018 — reranker cutover/rollback flip UNCONDITIONALLY to the composed truth (FR1-FR3, FR14)", () => {
  test("both read persists_today and are never unavailable, with or without readiness", () => {
    for (const readiness of [undefined, {}, { milvusConfigured: false }] as const) {
      const map = byId(readiness)
      for (const id of RERANKER_UNCONDITIONAL) {
        expect(map.get(id)!.persistence).toBe("persists_today")
        expect(map.get(id)!.availability).not.toBe("unavailable")
      }
    }
  })

  test("they ride the persisting set (a config-backed backend, not a Milvus gap)", () => {
    const persisting = new Set<string>(OPERATOR_PERSISTING_VERBS)
    for (const id of RERANKER_UNCONDITIONAL) expect(persisting.has(id)).toBe(true)
  })

  test("the reranker cutover/rollback surface in the semantic Configure panel as non-unavailable", () => {
    const panel = buildOperatorDomainPanel("semantic")
    for (const id of RERANKER_UNCONDITIONAL) {
      const item = panel.configure.find((v) => v.id === id)
      expect(item).toBeDefined()
      expect(item!.availability).not.toBe("unavailable")
    }
  })
})

describe("T018 — Milvus/interactive/capability-conditional verbs stay honest gaps until composed (FR14)", () => {
  test("the default (unconfigured/headless/absent) projection keeps them honest_unavailable", () => {
    const map = byId()
    for (const id of [...MILVUS_CONDITIONAL, ...AUTH_INTERACTIVE, ...SUBSCRIPTION_CAPABILITY]) {
      expect(map.get(id)!.persistence).toBe("honest_unavailable")
      expect(map.get(id)!.availability).toBe("unavailable")
    }
  })

  test("a configured Milvus endpoint flips the embedding + index verbs to the composed truth", () => {
    const map = byId({ milvusConfigured: true })
    for (const id of MILVUS_CONDITIONAL) {
      expect(map.get(id)!.persistence).toBe("persists_today")
      expect(map.get(id)!.availability).not.toBe("unavailable")
    }
    // readiness is per-dependency: a Milvus flag does NOT flip the mcp auth/subscription gaps.
    for (const id of [...AUTH_INTERACTIVE, ...SUBSCRIPTION_CAPABILITY]) {
      expect(map.get(id)!.persistence).toBe("honest_unavailable")
    }
  })

  test("an interactive surface flips only the auth-delegation verbs", () => {
    const map = byId({ interactiveSurface: true })
    for (const id of AUTH_INTERACTIVE) expect(map.get(id)!.persistence).toBe("persists_today")
    for (const id of [...MILVUS_CONDITIONAL, ...SUBSCRIPTION_CAPABILITY]) {
      expect(map.get(id)!.persistence).toBe("honest_unavailable")
    }
  })

  test("a subscribe-capable client flips only the resource subscription verbs", () => {
    const map = byId({ subscriptionCapable: true })
    for (const id of SUBSCRIPTION_CAPABILITY) expect(map.get(id)!.persistence).toBe("persists_today")
    for (const id of [...MILVUS_CONDITIONAL, ...AUTH_INTERACTIVE]) {
      expect(map.get(id)!.persistence).toBe("honest_unavailable")
    }
  })

  test("no conditional verb leaked into the static persisting set (Feature 014/017 parity)", () => {
    const persisting = new Set<string>(OPERATOR_PERSISTING_VERBS)
    for (const id of [...MILVUS_CONDITIONAL, ...AUTH_INTERACTIVE, ...SUBSCRIPTION_CAPABILITY]) {
      expect(persisting.has(id)).toBe(false)
    }
  })
})

describe("T018 — the default domain badges keep the honest Partial semantics (FR14)", () => {
  const groups = new Map(buildOperatorGroupList().map((g) => [g.domain, g]))

  test("semantic stays Partial (embedding + index verbs stay gapped by default)", () => {
    expect(groups.get("semantic")!.badge).toBe("Partial")
  })

  test("mcp stays Partial (auth + subscription verbs stay gapped by default)", () => {
    expect(groups.get("mcp")!.badge).toBe("Partial")
  })

  test("telemetry stays Available (its export is real and its mutations already persist)", () => {
    expect(groups.get("telemetry")!.badge).toBe("Available")
  })
})

describe("T023 — parity: no new catalog id, no version bump, real dispatch ids (FR15)", () => {
  test("the reserved catalog version is unchanged at 1.3.0", () => {
    expect(RESERVED_CATALOG.version).toBe("1.3.0")
  })

  test("the composed verbs ride REAL pre-existing catalog ids — no new dispatch path", () => {
    const catalogIds = new Set(RESERVED_CATALOG.entries.map((e) => e.id))
    for (const id of [
      ...RERANKER_UNCONDITIONAL,
      ...MILVUS_CONDITIONAL,
      ...AUTH_INTERACTIVE,
      ...SUBSCRIPTION_CAPABILITY,
    ]) {
      expect(catalogIds.has(id)).toBe(true)
    }
  })

  test("the catalog entry count is unchanged by this composition-only feature", () => {
    expect(listOperatorPaletteEntries()).toHaveLength(RESERVED_CATALOG.entries.length)
    // A readiness flip changes availability, never the id set (no new dispatch path).
    expect(listOperatorPaletteEntries({ readiness: { milvusConfigured: true, interactiveSurface: true } })).toHaveLength(
      RESERVED_CATALOG.entries.length,
    )
  })

  test("every static persisting verb rides a real catalog id", () => {
    const catalogIds = new Set(RESERVED_CATALOG.entries.map((e) => e.id))
    for (const id of OPERATOR_PERSISTING_VERBS) expect(catalogIds.has(id)).toBe(true)
  })
})
