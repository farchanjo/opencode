import { describe, expect, test } from "bun:test"
import { SpoolInstruments } from "@opencode-ai/core/outputspool/spool-instruments"
import { Reconcile } from "@opencode-ai/core/outputspool/reconcile"
import { Paging } from "@opencode-ai/core/outputspool/paging"

// Feature 005 / T045 (S27) — the telemetry cardinality audit (Observability,
// FR5, C9, C22, AC18). No id-shaped value (content, path, OutputRef,
// session_id, process_id, user_id) is ever a metric label; every dynamic label
// is a bounded enum that collapses an out-of-budget value to `other`; the
// `reasoning` channel is never exported to OTEL; the output.* spans correlate
// with the Feature 001 spans; and OTEL being down never blocks seal/read.

/** Id-shaped label keys that MUST NEVER appear as a bounded metric label set. */
const FORBIDDEN_LABEL_KEYS = new Set([
  "content",
  "path",
  "file_path",
  "output_ref",
  "outputRef",
  "session_id",
  "process_id",
  "user_id",
  "correlation_id",
  "secret",
])

describe("T045 cardinality audit — no id is a metric label (C22, AC18)", () => {
  test("the bounded Labels object carries only enum-valued label sets, no id key", () => {
    for (const key of Object.keys(SpoolInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS.has(key)).toBe(false)
    }
  })

  test("every Labels value is a closed bounded enum, never an unbounded id space", () => {
    for (const [name, values] of Object.entries(SpoolInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      // A bounded label set stays small (cardinality budget); an id space would not.
      expect((values as readonly string[]).length).toBeLessThanOrEqual(16)
      expect(name).not.toMatch(/id$|ref$|path/i)
    }
  })

  test("an id-shaped dynamic value collapses to OTHER for every label enum (over-budget → other)", () => {
    const idLike = ["or_9f3a1", "ses_abc", "proc_42", "/spool/x/data", "usr_007"]
    for (const values of Object.values(SpoolInstruments.Labels)) {
      for (const id of idLike) {
        expect(SpoolInstruments.boundEnum(values, id)).toBe(SpoolInstruments.OTHER)
      }
    }
  })
})

describe("T045 cardinality audit — reasoning is never exported to OTEL (C9, AC22)", () => {
  test("no exportable channel set contains reasoning", () => {
    expect((SpoolInstruments.EMITTABLE_CHANNELS as readonly string[])).not.toContain("reasoning")
    expect((SpoolInstruments.Labels.channel as readonly string[])).not.toContain("reasoning")
    expect(SpoolInstruments.isChannelExportable("reasoning")).toBe(false)
  })

  test("a reasoning label value collapses to OTHER, never a distinct series", () => {
    expect(SpoolInstruments.boundEnum(SpoolInstruments.Labels.channel, "reasoning")).toBe(SpoolInstruments.OTHER)
  })
})

describe("T045 cardinality audit — output.* spans correlate with Feature 001 (Observability)", () => {
  test("all five output.* concept spans are present", () => {
    expect([...Object.values(SpoolInstruments.SpanName)].sort()).toEqual(
      ["output.append", "output.cleanup", "output.read", "output.reconcile", "output.seal"],
    )
  })

  test("each output.* span correlates with a Feature 001 execution span", () => {
    const c = SpoolInstruments.CorrelatedSpanName
    expect(c.sessionExecution).toBe("session.execution")
    for (const span of [c.taskExecute, c.llmRequest, c.toolExecute, c.fallback]) {
      expect(typeof span).toBe("string")
      expect(span.length).toBeGreaterThan(0)
    }
  })
})

describe("T045 cardinality audit — OTEL down never blocks seal/read (AC18)", () => {
  test("the seal-recovery decision is a pure domain function with no telemetry dependency", () => {
    // No exporter, no metric registry, no OTLP sink is initialized in this test —
    // yet the settlement decision computes, proving seal is telemetry-independent.
    expect(
      Reconcile.decide({
        committed_bytes: 10,
        fs_extent: 10,
        seal_record_present: true,
        abort_record_present: false,
        seal_requested: true,
        scan_complete: true,
      }),
    ).toBe("sealed")
  })

  test("the paged read computes with no telemetry dependency", () => {
    const page = Paging.computePage({
      offset: 0,
      limit: 4,
      page_cap: 1024,
      committed_bytes: 4,
      sealed: true,
      window: new TextEncoder().encode("abcd"),
    })
    expect(page.bytes.length).toBe(4)
    expect(page.eof).toBe(true)
  })
})
