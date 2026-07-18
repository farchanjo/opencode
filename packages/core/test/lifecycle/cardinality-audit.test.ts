/**
 * Feature 002 / T041 — lifecycle telemetry cardinality + content-free audit.
 *
 * ADR-0001 / C18 forbid unbounded, user-correlating identifiers from ever
 * becoming metric labels: `task_id`, `session_id`, and `process_id` stay in
 * traces/logs and NEVER in a metric dimension (FR45, AC17). This audit pins the
 * bounded label vocabulary of the lifecycle instruments (`lifecycle-instruments.ts`,
 * T023), proves the shared cardinality bounder collapses an out-of-budget dynamic
 * value to `other` (AC16), asserts the five lifecycle concept spans correlate with
 * — never replace — the Feature 001 spans, and proves the Todo-derived metrics
 * export only enums / counts / buckets, never objective/item free text (AC47).
 *
 * It complements the Feature 001 audit in `test/observability/cardinality-audit.test.ts`
 * (which guards the routing/telemetry instruments) by guarding the lifecycle set.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import {
  boundEnum,
  createCardinalityAllowlist,
  CorrelatedSpanName,
  Labels,
  OTHER,
  SpanName,
} from "@opencode-ai/core/lifecycle/lifecycle-instruments"
import { TelemetryInstruments } from "@opencode-ai/core/observability/telemetry-instruments"

// Identifiers that must NEVER be a lifecycle metric label nor be embedded in a
// metric instrument name (unbounded / user-correlating). `task_id`,
// `session_id`, and `process_id` are the three the spec calls out explicitly
// (AC17); the rest are the ADR-0001 forbidden family.
const FORBIDDEN_LABEL_TOKENS = [
  "task_id",
  "session_id",
  "process_id",
  "session",
  "message",
  "turn",
  "decision",
  "request",
  "correlation",
  "causation",
  "prompt",
  "user",
  "path",
  "lease",
  "objective",
  "item_text",
]

const instrumentsSrc = readFileSync(
  fileURLToPath(new URL("../../src/lifecycle/lifecycle-instruments.ts", import.meta.url)),
  "utf8",
)

describe("T041 lifecycle cardinality audit — bounded enum label vocabulary (AC17, C18)", () => {
  test("no bounded enum label key is a task/session/process or correlating identifier", () => {
    for (const key of Object.keys(Labels)) {
      for (const token of FORBIDDEN_LABEL_TOKENS) {
        expect(key === token, `lifecycle label "${key}" is forbidden as a metric dimension`).toBe(false)
      }
    }
    // The vocabulary is exactly the T023 bounded set — a new dimension must be
    // added deliberately here, never grown silently.
    expect(Object.keys(Labels).sort()).toEqual(
      [
        "process_state",
        "admission_scope",
        "admission_decision",
        "watchdog_outcome",
        "cancel_outcome",
        "terminal_reason",
        "hierarchy_role",
      ].sort(),
    )
  })

  test("every enum's values are a finite bounded allowlist (never open-ended)", () => {
    for (const [key, values] of Object.entries(Labels)) {
      expect(Array.isArray(values), `${key} must be a finite allowlist`).toBe(true)
      expect(values.length, `${key} must be non-empty`).toBeGreaterThan(0)
      // The widest lifecycle enum (admission_scope) is twelve; nothing may exceed it.
      expect(values.length, `${key} must stay bounded`).toBeLessThanOrEqual(12)
    }
  })

  test("hierarchy_role is reused verbatim from Feature 001 (C15) — no lifecycle-local fork", () => {
    expect(Labels.hierarchy_role).toBe(TelemetryInstruments.Labels.hierarchy_role)
  })
})

describe("T041 lifecycle cardinality audit — metric names carry no correlating id (AC17)", () => {
  test("no lifecycle metric instrument name embeds a correlating identifier", () => {
    const names = [...instrumentsSrc.matchAll(/Metric\.\w+\("([^"]+)"/g)].map((m) => m[1])
    expect(names.length, "expected lifecycle Metric.<kind>(...) declarations").toBeGreaterThan(0)
    for (const name of names) {
      for (const token of FORBIDDEN_LABEL_TOKENS) {
        expect(name.includes(token), `metric "${name}" embeds forbidden token "${token}"`).toBe(false)
      }
    }
    // Every lifecycle metric is namespaced under `lifecycle.` (C18: no new pipeline).
    for (const name of names) {
      expect(name.startsWith("lifecycle."), `metric "${name}" must be namespaced under lifecycle.`).toBe(true)
    }
  })

  test("Todo-derived metrics export only enums/counts/buckets — never objective/item free text (AC47)", () => {
    const names = [...instrumentsSrc.matchAll(/Metric\.\w+\("([^"]+)"/g)].map((m) => m[1])
    // A Todo metric may exist as a bounded count/gauge/histogram, but it must
    // never encode the objective text, an item description, or a todo id.
    for (const name of names) {
      for (const token of ["objective", "item_text", "item_id", "todo_id", "description"]) {
        expect(name.includes(token), `metric "${name}" leaks Todo free text via "${token}"`).toBe(false)
      }
    }
    // No label dimension is a free-text Todo field either.
    for (const key of Object.keys(Labels)) {
      expect(key.includes("objective")).toBe(false)
      expect(key.includes("item_text")).toBe(false)
    }
  })
})

describe("T041 lifecycle cardinality audit — bounder collapses over-budget/out-of-enum values (AC16)", () => {
  test("boundEnum maps a fabricated task/session/process id to `other` for every enum", () => {
    const fabricated = ["task_01J8Z4Q3X7", "ses_01HZY9", "proc_01HZY9ABC"]
    for (const values of Object.values(Labels)) {
      for (const id of fabricated) {
        expect(boundEnum(values, id)).toBe(OTHER)
      }
    }
  })

  test("valid enum members bound to themselves, never to `other`", () => {
    expect(boundEnum(Labels.process_state, "running")).toBe("running")
    expect(boundEnum(Labels.cancel_outcome, "unconfirmed")).toBe("unconfirmed")
    expect(boundEnum(Labels.admission_scope, "sqlite")).toBe("sqlite")
  })

  test("createCardinalityAllowlist admits up to budget dynamic values then collapses the rest", () => {
    const allow = createCardinalityAllowlist(2)
    expect(allow.bound("proc_a")).toBe("proc_a")
    expect(allow.bound("proc_b")).toBe("proc_b")
    // A third distinct (unbounded) value can never grow the dimension.
    expect(allow.bound("proc_c")).toBe(OTHER)
    // An already-admitted value keeps its identity (idempotent, no double count).
    expect(allow.bound("proc_a")).toBe("proc_a")
    expect(allow.size()).toBe(2)
  })

  test("a non-positive budget collapses every dynamic value to `other`", () => {
    const allow = createCardinalityAllowlist(0)
    expect(allow.bound("proc_a")).toBe(OTHER)
    expect(allow.bound("proc_b")).toBe(OTHER)
    expect(allow.size()).toBe(0)
  })
})

describe("T041 lifecycle spans correlate with the Feature 001 spans (FR43, C18)", () => {
  test("exposes exactly the five lifecycle concept spans", () => {
    expect(Object.values(SpanName).sort()).toEqual(
      (["admission", "queue.wait", "cancel", "handoff", "reconciliation"] as SpanName[]).sort(),
    )
  })

  test("the correlated span set is the Feature 001 spans, reused not redefined", () => {
    // Lifecycle spans correlate with — never replace — the Feature 001 concept
    // spans; the correlation targets must be the actual Feature 001 span names.
    expect(CorrelatedSpanName.taskExecute).toBe(TelemetryInstruments.SpanName.taskExecute)
    expect(CorrelatedSpanName.llmRequest).toBe(TelemetryInstruments.SpanName.llmRequest)
    expect(CorrelatedSpanName.toolExecute).toBe(TelemetryInstruments.SpanName.toolExecute)
    expect(CorrelatedSpanName.fallback).toBe(TelemetryInstruments.SpanName.fallback)
  })

  test("lifecycle span names do not collide with the Feature 001 span names (distinct concepts)", () => {
    const feature001 = new Set(Object.values(TelemetryInstruments.SpanName) as string[])
    for (const span of Object.values(SpanName)) {
      expect(feature001.has(span), `lifecycle span "${span}" must be its own concept`).toBe(false)
    }
  })
})
