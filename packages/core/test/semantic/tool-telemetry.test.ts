import { describe, expect, test } from "bun:test"
import { SemanticInstruments } from "@opencode-ai/core/semantic/semantic-instruments"

// Feature 009 / T013 (S12) — the tool-search telemetry cardinality audit (FR23,
// FR24, C16, AC15). Tool retrieval REUSES the Feature 006 content-free instruments;
// no tool id, MCP server name, session id, query text, vector, or path is ever a
// metric label; the tool spans are stable enums; and the selected TOOL rank is a
// bounded bucket, never the id.

/** Id-/content-shaped label keys that MUST NEVER appear as a bounded metric label set. */
const FORBIDDEN_LABEL_KEYS = new Set([
  "tool_id",
  "tool",
  "server",
  "server_name",
  "mcp_server",
  "query",
  "query_text",
  "vector",
  "embedding",
  "content",
  "path",
  "file_path",
  "session_id",
  "entity_id",
  "secret",
])

describe("T013 tool telemetry — no tool-id/server/session/query/vector/path label (C16, AC15)", () => {
  test("the bounded Labels object carries only enum-valued label sets, no tool-id/server key", () => {
    for (const key of Object.keys(SemanticInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS.has(key)).toBe(false)
    }
  })

  test("every Labels value is a closed bounded enum, never an unbounded id/server space", () => {
    for (const [name, values] of Object.entries(SemanticInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      expect((values as readonly string[]).length).toBeLessThanOrEqual(16)
      expect(name).not.toMatch(/id$|ref$|path|query|vector|server/i)
    }
  })

  test("the tool_mode label mirrors the schema ToolRetrievalMode ladder (full_set_passthrough floor)", () => {
    expect(SemanticInstruments.Labels.tool_mode).toEqual([
      "full_semantic",
      "lexical_only",
      "full_set_passthrough",
      "fail_closed",
    ])
    // Distinct from the agent `mode` floor (`catalog_lexical`).
    expect(SemanticInstruments.Labels.tool_mode).not.toContain("catalog_lexical")
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.tool_mode, "sneaky-tool-id")).toBe(
      SemanticInstruments.OTHER,
    )
  })

  test("the surface label is the bounded enablement KIND, never an MCP server name", () => {
    expect(SemanticInstruments.Labels.surface).toEqual(["native", "mcp", "code_mode"])
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.surface, "my-remote-server")).toBe(
      SemanticInstruments.OTHER,
    )
  })

  test("the collection label already carries the tools generation (no new label needed)", () => {
    expect(SemanticInstruments.Labels.collection).toContain("tools")
  })
})

describe("T013 tool spans + reused instruments (FR23, C16)", () => {
  test("retrieve.tools / rerank.tools are the two new spans; embed.query + fallback are reused", () => {
    expect(SemanticInstruments.ToolSpanName.retrieveTools).toBe("retrieve.tools")
    expect(SemanticInstruments.ToolSpanName.rerankTools).toBe("rerank.tools")
    // Reused verbatim from the Feature 006 span set — the shared query embedding + the fallback floor.
    expect(SemanticInstruments.ToolSpanName.embedQuery).toBe(SemanticInstruments.SpanName.embedQuery)
    expect(SemanticInstruments.ToolSpanName.fallback).toBe(SemanticInstruments.SpanName.fallback)
  })

  test("the Feature 006 SpanName set is unchanged (nine spans, no tool fork)", () => {
    expect(Object.values(SemanticInstruments.SpanName)).toHaveLength(9)
  })

  test("the tool metrics reuse the content-free instruments including the bounded selected-rank bucket", () => {
    expect(SemanticInstruments.TOOL_METRICS).toContain(SemanticInstruments.selectedRank)
    expect(SemanticInstruments.TOOL_METRICS).toContain(SemanticInstruments.retrieveLatencyMs)
    expect(SemanticInstruments.TOOL_METRICS).toContain(SemanticInstruments.cacheHit)
    expect(SemanticInstruments.TOOL_METRICS).toContain(SemanticInstruments.fallbackCount)
    for (const instrument of SemanticInstruments.TOOL_METRICS) expect(instrument).toBeDefined()
  })
})
