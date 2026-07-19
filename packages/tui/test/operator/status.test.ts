/**
 * Feature 015 T004 — inline StatusSection projection (FR4). Pins the pure
 * `toStatusNodes` projection (total, bounded, honest-empty, never throws) that
 * backs the plain-domain generic key/value renderer, and the `plainStatusReadId`
 * convention that every plain domain's inline status resolves to an existing
 * `<domain>.status` View verb in the reserved catalog.
 */
import { describe, expect, test } from "bun:test"
import { buildOperatorDomainPanel, OPERATOR_SETTINGS_DOMAINS } from "@opencode-ai/core/operator"
import { MAX_STATUS_NODES, plainStatusReadId, toStatusNodes } from "../../src/operator/status"

/** Domains whose inline status renders the reused rich panel instead of key/value. */
const RICH_DOMAINS = new Set(["jobs", "output", "langlock", "semantic", "mcp"])

describe("Feature 015 T004 — inline status projection (FR4)", () => {
  test("projects a record's top-level scalars to key/value rows", () => {
    expect(toStatusNodes({ enabled: true, tag: "pt-BR", version: 3 })).toEqual([
      { key: "enabled", value: "true" },
      { key: "tag", value: "pt-BR" },
      { key: "version", value: "3" },
    ])
  })

  test("nested objects/arrays render as bounded summaries, never the expanded payload", () => {
    expect(toStatusNodes({ items: [1, 2, 3], meta: { a: 1, b: 2 }, missing: null })).toEqual([
      { key: "items", value: "[3]" },
      { key: "meta", value: "{2}" },
      { key: "missing", value: "—" },
    ])
  })

  test("an absent or non-record payload yields the honest empty list (never throws)", () => {
    expect(toStatusNodes(undefined)).toEqual([])
    expect(toStatusNodes(null)).toEqual([])
    expect(toStatusNodes("scalar")).toEqual([])
    expect(toStatusNodes(42)).toEqual([])
    expect(toStatusNodes([1, 2])).toEqual([])
  })

  test("long string values are truncated with an ellipsis", () => {
    const long = "x".repeat(200)
    const [node] = toStatusNodes({ blob: long })
    expect(node.value.length).toBeLessThanOrEqual(80)
    expect(node.value.endsWith("…")).toBe(true)
  })

  test("the node count is bounded", () => {
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]))
    expect(toStatusNodes(big)).toHaveLength(MAX_STATUS_NODES)
  })
})

describe("Feature 015 T004 — plain-domain status read convention (FR4)", () => {
  test("every plain domain reads an existing <domain>.status View verb", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      if (RICH_DOMAINS.has(domain)) continue
      const viewIds = buildOperatorDomainPanel(domain).view.map((v) => v.id)
      expect(viewIds).toContain(plainStatusReadId(domain))
    }
  })
})
