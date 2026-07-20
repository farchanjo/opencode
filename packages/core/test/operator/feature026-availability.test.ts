/**
 * Feature 026 / T001 (FR1) — the `semantic.reranker.validate` availability truth flip.
 *
 * Before this feature `semantic.reranker.validate` was in NEITHER the static persisting
 * set NOR the Milvus-conditional set, so it rendered STATICALLY `unavailable` ("not
 * implemented yet") in the Operator · Semantic panel — even though its config-backed
 * backend (a provider rerank probe over the `store.config` `semantic` authority, NO Milvus)
 * is UNCONDITIONALLY composed in the live stack, exactly like `reranker.cutover`/`rollback`.
 * This pins the flip: it now reads `persists_today` / non-unavailable with or without any
 * `#BackendReadiness`, rides the static persisting set, and never leaks into the
 * Milvus-conditional set. Parity is preserved: no new catalog id, no version bump.
 */
import { describe, expect, test } from "bun:test"
import {
  OPERATOR_PERSISTING_VERBS,
  buildOperatorDomainPanel,
  listOperatorPaletteEntries,
  RESERVED_CATALOG,
  operatorRowSubtitle,
  type OperatorBackendReadiness,
  type OperatorPaletteEntry,
} from "../../src/operator"

const RERANKER_VALIDATE = "semantic.reranker.validate"

function byId(readiness?: OperatorBackendReadiness): Map<string, OperatorPaletteEntry> {
  return new Map(listOperatorPaletteEntries(readiness ? { readiness } : {}).map((e) => [e.id, e]))
}

describe("T001 — semantic.reranker.validate flips UNCONDITIONALLY to the composed truth (FR1)", () => {
  test("it reads persists_today and is never unavailable, with or without readiness", () => {
    for (const readiness of [undefined, {}, { milvusConfigured: false }] as const) {
      const entry = byId(readiness).get(RERANKER_VALIDATE)!
      expect(entry.persistence).toBe("persists_today")
      expect(entry.availability).not.toBe("unavailable")
    }
  })

  test("it rides the static persisting set (a config-backed backend, not a Milvus gap)", () => {
    expect(new Set<string>(OPERATOR_PERSISTING_VERBS).has(RERANKER_VALIDATE)).toBe(true)
  })

  test("its row subtitle no longer reads 'not implemented yet'", () => {
    const entry = byId().get(RERANKER_VALIDATE)!
    const subtitle = operatorRowSubtitle({ commandId: entry.id, availability: entry.availability })
    expect(subtitle).not.toContain("not implemented yet")
  })

  test("it surfaces in the semantic Configure panel as non-unavailable", () => {
    const item = buildOperatorDomainPanel("semantic").configure.find((v) => v.id === RERANKER_VALIDATE)
    expect(item).toBeDefined()
    expect(item!.availability).not.toBe("unavailable")
  })
})

describe("T001 — parity: no new catalog id, no version bump, real dispatch id (FR1)", () => {
  test("the reserved catalog version is unchanged at 1.3.0", () => {
    expect(RESERVED_CATALOG.version).toBe("1.3.0")
  })

  test("reranker.validate rides a REAL pre-existing catalog id — no new dispatch path", () => {
    expect(new Set(RESERVED_CATALOG.entries.map((e) => e.id)).has(RERANKER_VALIDATE)).toBe(true)
  })

  test("the catalog entry count is unchanged by this composition-only flip", () => {
    expect(listOperatorPaletteEntries()).toHaveLength(RESERVED_CATALOG.entries.length)
  })

  test("embedding.validate and the Milvus-conditional verbs are NOT added (out of scope)", () => {
    const persisting = new Set<string>(OPERATOR_PERSISTING_VERBS)
    for (const id of [
      "semantic.embedding.validate",
      "semantic.embedding.reindex",
      "semantic.embedding.cutover",
      "semantic.embedding.rollback",
      "semantic.index.reindex",
      "semantic.index.reconcile",
    ]) {
      expect(persisting.has(id)).toBe(false)
    }
  })
})
