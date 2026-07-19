import { describe, expect, test } from "bun:test"
import { NativeInstruments } from "@opencode-ai/core/tool/native/native-instruments"

/**
 * Feature 010 — content-free telemetry cardinality audit (T019, S16).
 *
 * Asserts the native backend-selection and `native_unavailable` telemetry carries only
 * bounded enum labels (`tool`, `backend`, `gap_reason`, `pty_phase`) — never a file
 * content, path, patch body, command string, or session id (ADR-0001, FR24, C14, AC17)
 * — that every dynamic value collapses to `OTHER` when off-allowlist, and that the
 * native.* concept spans correlate with — never replace — the Feature 001 spans. No new
 * exporter is introduced.
 */

const FORBIDDEN_LABEL_KEYS = [
  "session_id",
  "sessionId",
  "pid",
  "master_fd",
  "path",
  "file",
  "file_path",
  "command",
  "pattern",
  "content",
  "patch",
  "id",
  "target",
]

describe("NativeInstruments.Labels — no id/content appears as a metric label (C14, AC17)", () => {
  test("every bounded label key is a category, never an unbounded identifier", () => {
    for (const key of Object.keys(NativeInstruments.Labels)) {
      expect(FORBIDDEN_LABEL_KEYS).not.toContain(key)
    }
  })

  test("the tool label is the six built-ins plus pty, nothing free-form", () => {
    expect(([...NativeInstruments.Labels.tool] as string[]).sort()).toEqual(
      ["apply_patch", "edit", "glob", "grep", "pty", "read", "write"].sort(),
    )
  })

  test("the backend label is exactly the native/typescript pair", () => {
    expect(([...NativeInstruments.Labels.backend] as string[]).sort()).toEqual(["native", "typescript"].sort())
  })

  test("the gap_reason label is the four bounded native_unavailable causes", () => {
    expect(([...NativeInstruments.Labels.gap_reason] as string[]).sort()).toEqual(
      ["abi_mismatch", "disabled", "dlopen_failed", "library_missing"].sort(),
    )
  })

  test("every label value set is a bounded, non-empty enum (Security)", () => {
    for (const values of Object.values(NativeInstruments.Labels)) {
      expect(Array.isArray(values)).toBe(true)
      expect(values.length).toBeGreaterThan(0)
      expect(values.length).toBeLessThanOrEqual(8)
    }
  })
})

describe("NativeInstruments.selectionLabels — bounds every dynamic value (ADR-0001)", () => {
  test("an in-enum selection is passed through unchanged", () => {
    expect(NativeInstruments.selectionLabels({ tool: "read", backend: "native" })).toEqual({
      tool: "read",
      backend: "native",
      gap_reason: NativeInstruments.OTHER,
    })
  })

  test("a fallback selection carries the bounded gap_reason", () => {
    expect(
      NativeInstruments.selectionLabels({ tool: "grep", backend: "typescript", gap_reason: "library_missing" }),
    ).toEqual({ tool: "grep", backend: "typescript", gap_reason: "library_missing" })
  })

  test("an off-allowlist tool/backend/gap_reason collapses to OTHER — never leaks a raw value", () => {
    const bounded = NativeInstruments.selectionLabels({
      tool: "/etc/passwd",
      backend: "sh -c rm -rf",
      gap_reason: "ses_deadbeef",
    })
    expect(bounded.tool).toBe(NativeInstruments.OTHER)
    expect(bounded.backend).toBe(NativeInstruments.OTHER)
    expect(bounded.gap_reason).toBe(NativeInstruments.OTHER)
    expect(NativeInstruments.OTHER).toBe("other")
  })

  test("the pty phase label bounds to spawn/kill/close and collapses a session id", () => {
    expect(NativeInstruments.ptyPhaseLabel("spawn")).toBe("spawn")
    expect(NativeInstruments.ptyPhaseLabel("sess_0xfeed")).toBe(NativeInstruments.OTHER)
  })

  test("a cardinality allowlist admits up to its budget then collapses to other", () => {
    const allowlist = NativeInstruments.createCardinalityAllowlist(1)
    expect(allowlist.bound("first")).toBe("first")
    expect(allowlist.bound("second")).toBe(NativeInstruments.OTHER)
  })
})

describe("NativeInstruments.SpanName — correlates with Feature 001 spans (C14)", () => {
  test("the native.* concept spans are namespaced under native.*", () => {
    for (const span of Object.values(NativeInstruments.SpanName)) {
      expect(span.startsWith("native.")).toBe(true)
    }
  })

  test("the correlated span references the Feature 001 tool.execute span, never replacing it", () => {
    const correlated = Object.values(NativeInstruments.CorrelatedSpanName)
    expect(correlated).toContain("tool.execute")
    for (const span of correlated) expect(span.startsWith("native.")).toBe(false)
  })
})
