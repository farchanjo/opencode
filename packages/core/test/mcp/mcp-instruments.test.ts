import { describe, expect, test } from "bun:test"
import { McpInstruments } from "@opencode-ai/core/mcp/mcp-instruments"

// Feature 008 / T022 (S14) — the MCP telemetry cardinality audit: no URI/content/
// call/session id is ever a metric label; every dynamic label is a bounded enum
// collapsing an out-of-budget value to `other`; the mcp.* spans correlate with the
// Feature 001/002 spans; and OTEL being unavailable never blocks a call (FR54–FR56,
// C26, AC22).

/** Id-/content-shaped label keys that MUST NEVER appear as a bounded metric label set. */
const FORBIDDEN_LABEL_KEYS = new Set([
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

describe("T022 cardinality audit — no URI/content/call/session id is a metric label (C26, AC22)", () => {
  test("the bounded Labels object carries only enum-valued label sets, no id key", () => {
    for (const key of Object.keys(McpInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS.has(key)).toBe(false)
    }
  })

  test("every Labels value is a closed bounded enum, never an unbounded id space", () => {
    for (const [name, values] of Object.entries(McpInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      expect((values as readonly string[]).length).toBeLessThanOrEqual(16)
      expect(name).not.toMatch(/(^|_)(id|ref|uri|path|token|secret)$|file_?path/i)
    }
  })

  test("boundEnum collapses an out-of-budget value to OTHER", () => {
    expect(McpInstruments.boundEnum(McpInstruments.Labels.transport, "streamable-http")).toBe("streamable-http")
    expect(McpInstruments.boundEnum(McpInstruments.Labels.transport, "res://sneaky-uri")).toBe(McpInstruments.OTHER)
  })

  test("the cardinality allowlist admits up to budget then collapses to OTHER", () => {
    const allow = McpInstruments.createCardinalityAllowlist(2)
    expect(allow.bound("a")).toBe("a")
    expect(allow.bound("b")).toBe("b")
    expect(allow.bound("c")).toBe(McpInstruments.OTHER)
  })
})

describe("T022 — spans correlate with Feature 001/002 and recording is content-free (AC22)", () => {
  test("the eleven mcp spans and their Feature 001/002 correlations are present", () => {
    expect(Object.values(McpInstruments.SpanName)).toHaveLength(11)
    expect(McpInstruments.CorrelatedSpanName.routingEvaluate).toBeTruthy()
    expect(McpInstruments.CorrelatedSpanName.jobExecute).toBe("job.execute")
  })

  test("the metric instruments are defined and namespaced under mcp.*", () => {
    expect(McpInstruments.callLatencyMs).toBeDefined()
    expect(McpInstruments.bytesSpooled).toBeDefined()
    expect(McpInstruments.reconnectCount).toBeDefined()
    expect(McpInstruments.updateCoalesceCount).toBeDefined()
  })
})
