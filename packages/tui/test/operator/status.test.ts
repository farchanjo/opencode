/**
 * Feature 015 T004 — inline StatusSection projection (FR4). Pins the pure
 * `toStatusNodes` projection (total, bounded, honest-empty, never throws) that
 * backs the plain-domain generic key/value renderer, and the `plainStatusReadId`
 * convention that every plain domain's inline status resolves to an existing
 * `<domain>.status` View verb in the reserved catalog.
 */
import { describe, expect, test } from "bun:test"
import { buildOperatorDomainPanel, OPERATOR_SETTINGS_DOMAINS } from "@opencode-ai/core/operator"
import {
  MAX_STATUS_NODES,
  plainStatusReadId,
  statusEmptySummary,
  toStatusGroups,
  toStatusNodes,
} from "../../src/operator/status"

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

describe("Feature 016 T003/T010 — compact status: populated full, empty collapsed (FR2)", () => {
  test("classifies each group as populated or empty by its value", () => {
    const groups = toStatusGroups({
      servers: [{ id: "a" }],
      resources: [],
      experimental: {},
      calls: null,
      enabled: false,
      count: 0,
    })
    const byKey = new Map(groups.map((g) => [g.key, g.state]))
    // a non-empty array/record is populated; a scalar (even false/0) is populated.
    expect(byKey.get("servers")).toBe("populated")
    expect(byKey.get("enabled")).toBe("populated")
    expect(byKey.get("count")).toBe("populated")
    // an empty array/record/null is the "no <thing>" case → empty.
    expect(byKey.get("resources")).toBe("empty")
    expect(byKey.get("experimental")).toBe("empty")
    expect(byKey.get("calls")).toBe("empty")
  })

  test("the empty summary names ONLY the empty groups on one line (FR2)", () => {
    const groups = toStatusGroups({ servers: [{ id: "a" }], resources: [], experimental: {}, calls: null })
    // populated groups render in full; the empty ones collapse into one line.
    expect(groups.filter((g) => g.state === "populated").map((g) => g.key)).toEqual(["servers"])
    expect(statusEmptySummary(groups)).toBe("resources · experimental · calls: empty")
  })

  test("an all-empty status collapses into a single summary line", () => {
    const groups = toStatusGroups({ servers: [], resources: [], experimental: {}, calls: null })
    expect(groups.every((g) => g.state === "empty")).toBe(true)
    expect(statusEmptySummary(groups)).toBe("servers · resources · experimental · calls: empty")
  })

  test("when every group is populated no summary line renders (undefined)", () => {
    const groups = toStatusGroups({ enabled: true, tag: "pt-BR" })
    expect(groups.every((g) => g.state === "populated")).toBe(true)
    expect(statusEmptySummary(groups)).toBeUndefined()
  })

  test("an absent/non-record payload yields the honest empty list and no summary (never throws)", () => {
    expect(toStatusGroups(undefined)).toEqual([])
    expect(toStatusGroups("scalar")).toEqual([])
    expect(statusEmptySummary(toStatusGroups(undefined))).toBeUndefined()
  })

  test("the group projection is bounded like the node projection", () => {
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]))
    expect(toStatusGroups(big)).toHaveLength(MAX_STATUS_NODES)
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
