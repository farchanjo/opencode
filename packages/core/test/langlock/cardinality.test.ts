import { describe, expect, test } from "bun:test"
import { LangLockInstruments } from "@opencode-ai/core/langlock/langlock-instruments"

// Feature 004 / T041 (S20) — telemetry cardinality audit (Observability, FR27,
// C8, AC14). Asserts session_id/execution_id/file/path NEVER appear as metric
// labels, that every dynamic label value is a bounded enum whose over-budget
// values collapse to `other`, and that the langlock.* concept spans correlate
// with — never replace — the Feature 001 spans. No new exporter is introduced.

const FORBIDDEN_LABEL_KEYS = ["session_id", "execution_id", "file", "path", "file_path", "target", "id"]

describe("LangLockInstruments.Labels — no id appears as a metric label (C8, AC14)", () => {
  test("every bounded label key is a category, never an unbounded identifier", () => {
    for (const key of Object.keys(LangLockInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS).not.toContain(key)
    }
  })

  test("the effective_tag label is the bounded eight-tag allowlist, not a free-form tag", () => {
    expect(([...LangLockInstruments.Labels.effective_tag] as string[]).sort()).toEqual(
      ["en-AU", "en-CA", "en-GB", "en-US", "es-AR", "es-ES", "es-MX", "pt-BR"].sort(),
    )
  })

  test("every label value set is a bounded, non-empty enum (Security 5)", () => {
    for (const values of Object.values(LangLockInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      expect(values.length).toBeGreaterThan(0)
      expect(values.length).toBeLessThanOrEqual(8)
    }
  })
})

describe("LangLockInstruments.boundEnum — over-budget collapses to other (ADR-0001)", () => {
  test("an in-enum value is returned as itself", () => {
    expect(LangLockInstruments.boundEnum(LangLockInstruments.Labels.scope, "project")).toBe("project")
  })

  test("an out-of-enum dynamic value collapses to the OTHER sentinel", () => {
    expect(LangLockInstruments.boundEnum(LangLockInstruments.Labels.origin, "ses_deadbeef")).toBe(
      LangLockInstruments.OTHER,
    )
    expect(LangLockInstruments.OTHER).toBe("other")
  })

  test("a cardinality allowlist admits up to its budget then collapses to other", () => {
    const allowlist = LangLockInstruments.createCardinalityAllowlist(1)
    expect(allowlist.bound("first")).toBe("first")
    expect(allowlist.bound("second")).toBe(LangLockInstruments.OTHER)
  })
})

describe("LangLockInstruments.SpanName — correlates with Feature 001 spans (Observability, C8)", () => {
  test("the five langlock.* concept spans are namespaced under langlock.*", () => {
    for (const span of Object.values(LangLockInstruments.SpanName)) {
      expect(span.startsWith("langlock.")).toBe(true)
    }
  })

  test("the correlated spans reference the Feature 001 execution/LLM/tool spans, never replacing them", () => {
    const correlated = Object.values(LangLockInstruments.CorrelatedSpanName)
    expect(correlated).toContain("session.execution")
    expect(correlated).toContain("llm.request")
    expect(correlated).toContain("tool.execute")
    for (const span of correlated) expect(span.startsWith("langlock.")).toBe(false)
  })
})
