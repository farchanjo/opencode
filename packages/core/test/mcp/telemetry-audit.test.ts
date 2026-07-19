import { describe, expect, test } from "bun:test"
import { Metric } from "effect"
import { McpInstruments } from "@opencode-ai/core/mcp/mcp-instruments"

// Feature 008 / T046 — the close-out telemetry cardinality audit: URIs, content, call
// ids and session ids never appear as metric labels; an over-budget dynamic value maps
// to `other`; the mcp.* spans correlate with the Feature 001/002 spans on TRACES, never
// as labels; and OTEL being unavailable never blocks a call (FR54, FR55, FR56, C26).

// Exact id/content label KEYS that must never appear (content_kind is a bounded enum
// of content TYPES — text/image/… — and is content-free, so it is intentionally absent).
const FORBIDDEN = new Set([
  "uri",
  "resource_uri",
  "content",
  "path",
  "file_path",
  "call_id",
  "request_id",
  "session_id",
  "correlation_id",
  "server_id",
  "secret",
  "token",
])

describe("T046 cardinality close-out — labels are content-free bounded enums", () => {
  test("no forbidden id/content key appears as a label key, and no value is a uri/path/id", () => {
    for (const [key, values] of Object.entries(McpInstruments.Labels)) {
      expect(FORBIDDEN.has(key)).toBe(false)
      for (const value of values as readonly string[]) {
        // A label value is a closed enum member, never a uri/path/id literal.
        expect(value).not.toMatch(/^https?:|^file:|\/|_id$/)
      }
    }
  })

  test("an over-budget dynamic value collapses to OTHER on every enum", () => {
    for (const values of Object.values(McpInstruments.Labels)) {
      expect(McpInstruments.boundEnum(values, "res://overflow-uri")).toBe(McpInstruments.OTHER)
    }
  })
})

describe("T046 — spans correlate on traces, not labels", () => {
  test("no correlated span name leaks into the metric label sets", () => {
    const correlated = new Set(Object.values(McpInstruments.CorrelatedSpanName) as string[])
    const allLabelValues = new Set<string>()
    for (const values of Object.values(McpInstruments.Labels)) for (const v of values as readonly string[]) allLabelValues.add(v)
    for (const span of correlated) expect(allLabelValues.has(span)).toBe(false)
    // The mcp.* span names themselves are trace identifiers, not label values either.
    for (const span of Object.values(McpInstruments.SpanName) as string[]) expect(allLabelValues.has(span)).toBe(false)
  })
})

describe("T046 — OTEL-down never blocks the hot path", () => {
  test("the labeling helpers are pure and synchronous — no I/O on the call path", () => {
    // boundEnum / the allowlist are the only per-call labeling touchpoints; they must
    // resolve synchronously so an unavailable exporter cannot stall a call.
    const allow = McpInstruments.createCardinalityAllowlist(1)
    const start = performance.now()
    expect(allow.bound("only")).toBe("only")
    expect(allow.bound("overflow")).toBe(McpInstruments.OTHER)
    expect(McpInstruments.boundEnum(McpInstruments.Labels.outcome, "success")).toBe("success")
    expect(performance.now() - start).toBeLessThan(50)
  })

  test("metric emission is a fire-and-forget Effect that never throws on the call path", () => {
    // Updating a counter yields an Effect (deferred); constructing/updating it never
    // throws even when no exporter is registered (OTEL-down).
    expect(() => Metric.update(McpInstruments.reconnectCount, 1)).not.toThrow()
    expect(() => Metric.update(McpInstruments.progressCount, 1)).not.toThrow()
    expect(McpInstruments.callLatencyMs).toBeDefined()
  })
})
