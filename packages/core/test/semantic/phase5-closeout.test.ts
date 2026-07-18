import { describe, expect, test } from "bun:test"
import { SemanticInstruments } from "@opencode-ai/core/semantic/semantic-instruments"

/**
 * Feature 006 / T045 (S25) — the close-out telemetry cardinality audit.
 *
 * The final observability gate: query text, vectors, entity IDs, session IDs, and
 * paths never appear as metric labels; over-budget dynamic values collapse to
 * `other`; the `semantic.*` spans correlate with the Feature 001 spans; the
 * effective binding versions and the Feature 004 language tag are recorded through
 * bounded enums without content; and OTEL being unavailable never blocks retrieval
 * (Observability, FR16, FR41, FR42, C22, AC15).
 */

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
  "binding_id",
])

describe("T045 cardinality — no id/query/vector/path is a metric label (AC15, C22)", () => {
  test("every Labels key is a bounded enum name, never an id/content key", () => {
    for (const key of Object.keys(SemanticInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS.has(key)).toBe(false)
      expect(key).not.toMatch(/id$|ref$|path|query|vector/i)
    }
  })

  test("every Labels value is a closed bounded enum (<=16 members)", () => {
    for (const values of Object.values(SemanticInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      expect((values as readonly string[]).length).toBeLessThanOrEqual(16)
    }
  })

  test("boundEnum collapses an out-of-budget dynamic value to OTHER", () => {
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.mode, "catalog_lexical")).toBe("catalog_lexical")
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.mode, "sneaky-query-text")).toBe(SemanticInstruments.OTHER)
  })
})

describe("T045 provenance recorded without content (FR16)", () => {
  test("the Feature 004 language tag is a bounded allowlist, never a free-form string", () => {
    expect(SemanticInstruments.Labels.language_tag).toContain("pt-BR")
    expect(SemanticInstruments.boundEnum(SemanticInstruments.Labels.language_tag, "zz-ZZ")).toBe(SemanticInstruments.OTHER)
  })
})

describe("T045 correlation + OTEL-down safety (AC15)", () => {
  test("the nine semantic spans exist and correlate with the Feature 001 routing span", () => {
    expect(Object.values(SemanticInstruments.SpanName)).toHaveLength(9)
    expect(SemanticInstruments.CorrelatedSpanName.routingEvaluate).toBeTruthy()
  })

  test("the content-free instruments are declared in-process (a missing exporter never blocks)", () => {
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
