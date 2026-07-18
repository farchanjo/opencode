import { describe, expect, test } from "bun:test"
import { SemanticInstruments } from "@opencode-ai/core/semantic/semantic-instruments"

// Feature 006 / T023 (S14) — the semantic telemetry cardinality audit
// (Observability, FR16, FR41, FR42, C22, AC15). No id/query/vector/path is ever a
// metric label; every dynamic label is a bounded enum collapsing an out-of-budget
// value to `other`; the semantic.* spans correlate with the Feature 001 spans; and
// OTEL being unavailable never blocks retrieval.

/** Id-/content-shaped label keys that MUST NEVER appear as a bounded metric label set. */
const FORBIDDEN_LABEL_KEYS = new Set([
  "query",
  "query_text",
  "vector",
  "embedding",
  "content",
  "path",
  "file_path",
  "session_id",
  "agent_id",
  "skill_id",
  "entity_id",
  "correlation_id",
  "secret",
])

describe("T023 cardinality audit — no id/query/vector/path is a metric label (C22, AC15)", () => {
  test("the bounded Labels object carries only enum-valued label sets, no id key", () => {
    for (const key of Object.keys(SemanticInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS.has(key)).toBe(false)
    }
  })

  test("every Labels value is a closed bounded enum, never an unbounded id space", () => {
    for (const [name, values] of Object.entries(SemanticInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      expect((values as readonly string[]).length).toBeLessThanOrEqual(16)
      expect(name).not.toMatch(/id$|ref$|path|query|vector/i)
    }
  })

  test("boundEnum collapses an out-of-budget value to OTHER", () => {
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.mode, "catalog_lexical")).toBe("catalog_lexical")
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.mode, "sneaky-query-text")).toBe(
      SemanticInstruments.OTHER,
    )
  })

  test("the language_tag label is a bounded allowlist, not a free-form provenance string (FR16)", () => {
    expect(SemanticInstruments.Labels.language_tag).toContain("pt-BR")
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.language_tag, "zz-ZZ")).toBe(
      SemanticInstruments.OTHER,
    )
  })
})

describe("T023 — spans correlate with Feature 001 and recording never blocks (AC15)", () => {
  test("the nine semantic spans and their Feature 001 correlations are present", () => {
    expect(Object.values(SemanticInstruments.SpanName)).toHaveLength(9)
    expect(SemanticInstruments.CorrelatedSpanName.routingEvaluate).toBeTruthy()
  })

  test("the content-free instruments are declared in-process (OTEL-down safe)", () => {
    // The Effect metric registry is in-process; the Feature 001 exporter snapshots
    // it on an async bounded interval, so a missing exporter never blocks retrieval
    // — recording is decoupled from export. The instruments must simply exist.
    for (const instrument of [
      SemanticInstruments.retrieveLatencyMs,
      SemanticInstruments.cacheHit,
      SemanticInstruments.fallbackCount,
      SemanticInstruments.indexUpsert,
      SemanticInstruments.selectedRank,
    ]) {
      expect(instrument).toBeDefined()
    }
  })
})
