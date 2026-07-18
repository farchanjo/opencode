/**
 * Feature 003 / T035 — jobs telemetry cardinality + content-free audit.
 *
 * ADR-0001 / C18 / AC16 forbid unbounded, user-correlating identifiers from ever
 * becoming metric labels: `job_definition_id`, `occurrence_id`, `session_id`, and
 * `process_id` stay in traces/logs and NEVER in a metric dimension. This audit
 * pins the bounded label vocabulary of the jobs instruments
 * (`jobs-instruments.ts`, T019), proves the shared cardinality bounder collapses an
 * out-of-budget dynamic value to `other` (Feature 001 `createLabelBounder` /
 * `cardinalityBudget` precedent in `otlp.ts`), and asserts the eight `job.*`
 * concept spans correlate with — never replace — the Feature 001 spans, so span
 * correlation rides on spans/events and never on a metric label.
 *
 * It complements the Feature 001 audit (`test/observability/cardinality-audit.test.ts`)
 * and the Feature 002 audit (`test/lifecycle/cardinality-audit.test.ts`) by guarding
 * the jobs instrument set.
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
} from "@opencode-ai/core/jobs/jobs-instruments"
import { createLabelBounder } from "@opencode-ai/core/observability/otlp"
import { TelemetryInstruments } from "@opencode-ai/core/observability/telemetry-instruments"

// The four identifiers the T035 acceptance calls out explicitly (AC16) plus the
// ADR-0001 forbidden family. NONE may be a jobs metric label key or be embedded in
// a jobs metric instrument name.
const FORBIDDEN_LABEL_TOKENS = [
  "job_definition_id",
  "occurrence_id",
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
  "event_id",
  "trace_id",
  "span_id",
]

const instrumentsSrc = readFileSync(
  fileURLToPath(new URL("../../src/jobs/jobs-instruments.ts", import.meta.url)),
  "utf8",
)

describe("T035 jobs cardinality audit — bounded enum label vocabulary (AC16, C18)", () => {
  test("no bounded enum label key is a job_definition_id/occurrence_id/session_id/process_id or correlating id", () => {
    for (const key of Object.keys(Labels)) {
      for (const token of FORBIDDEN_LABEL_TOKENS) {
        expect(key === token, `jobs label "${key}" is forbidden as a metric dimension`).toBe(false)
      }
    }
    // The vocabulary is exactly the T019 bounded set — a new dimension must be
    // added deliberately here, never grown silently.
    expect(Object.keys(Labels).sort()).toEqual(
      [
        "occurrence_state",
        "registration_state",
        "misfire_policy",
        "overlap_policy",
        "capability_surface",
        "reconcile_outcome",
        "job_source",
        "notification_type",
        "notification_priority",
        "delivery_state",
        "ack_state",
        "terminal_reason",
      ].sort(),
    )
  })

  test("every enum's values are a finite bounded allowlist (never open-ended)", () => {
    for (const [key, values] of Object.entries(Labels)) {
      expect(Array.isArray(values), `${key} must be a finite allowlist`).toBe(true)
      expect(values.length, `${key} must be non-empty`).toBeGreaterThan(0)
      // The widest jobs enum (occurrence_state) is fifteen; nothing may exceed it.
      expect(values.length, `${key} must stay bounded`).toBeLessThanOrEqual(15)
    }
  })
})

describe("T035 jobs cardinality audit — metric names carry no correlating id (AC16)", () => {
  test("no jobs metric instrument name embeds a correlating identifier and every one is namespaced under job.", () => {
    const names = [...instrumentsSrc.matchAll(/Metric\.\w+\("([^"]+)"/g)].map((m) => m[1])
    expect(names.length, "expected jobs Metric.<kind>(...) declarations").toBeGreaterThan(0)
    for (const name of names) {
      for (const token of FORBIDDEN_LABEL_TOKENS) {
        expect(name.includes(token), `metric "${name}" embeds forbidden token "${token}"`).toBe(false)
      }
      expect(name.startsWith("job."), `metric "${name}" must be namespaced under job.`).toBe(true)
    }
  })

  test("the four spec-named ids never appear as a label key literal in the instruments source (AC16)", () => {
    // A defensive source scan: neither the Labels object nor any comment may
    // sanction one of the four ids as a metric dimension.
    const labelBlock = instrumentsSrc.match(/export const Labels\s*=\s*\{([\s\S]*?)\n\} as const/)
    expect(labelBlock, "Labels object not found in jobs-instruments.ts").not.toBeNull()
    const labelKeys = [...labelBlock![1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1])
    for (const id of ["job_definition_id", "occurrence_id", "session_id", "process_id"]) {
      expect(labelKeys.includes(id), `"${id}" must never be a jobs metric label key`).toBe(false)
    }
  })
})

describe("T035 jobs cardinality audit — bounder collapses over-budget/out-of-enum values (AC16)", () => {
  test("boundEnum maps a fabricated job/occurrence/session/process id to `other` for every enum", () => {
    const fabricated = ["job_01J8Z4Q3X7", "occ_01HZY9", "ses_01HZY9", "proc_01HZY9ABC"]
    for (const values of Object.values(Labels)) {
      for (const id of fabricated) {
        expect(boundEnum(values, id)).toBe(OTHER)
      }
    }
  })

  test("valid enum members bound to themselves, never to `other`", () => {
    expect(boundEnum(Labels.occurrence_state, "completed")).toBe("completed")
    expect(boundEnum(Labels.registration_state, "reconciled")).toBe("reconciled")
    expect(boundEnum(Labels.overlap_policy, "forbid")).toBe("forbid")
  })

  test("createCardinalityAllowlist admits up to budget dynamic values then collapses the rest", () => {
    const allow = createCardinalityAllowlist(2)
    expect(allow.bound("job_a")).toBe("job_a")
    expect(allow.bound("job_b")).toBe("job_b")
    // A third distinct (unbounded) value can never grow the dimension.
    expect(allow.bound("job_c")).toBe(OTHER)
    // An already-admitted value keeps its identity (idempotent, no double count).
    expect(allow.bound("job_a")).toBe("job_a")
    expect(allow.size()).toBe(2)
  })

  test("the shared label bounder collapses an over-budget dynamic id to `other` (otlp.ts precedent)", () => {
    const bounder = createLabelBounder(1)
    expect(bounder.bound({ model: "m-a" }).model).toBe("m-a")
    expect(bounder.bound({ model: "m-b" }).model).toBe(OTHER)
  })
})

describe("T035 jobs spans correlate with the Feature 001 spans, never a metric label (Observability, C18)", () => {
  test("exposes exactly the eight job.* concept spans", () => {
    expect(Object.values(SpanName).sort()).toEqual(
      (["job.schedule", "job.trigger", "job.claim", "job.notify", "job.dispatch", "job.execute", "job.retry", "job.reconcile"] as SpanName[]).sort(),
    )
  })

  test("the correlated span set is the Feature 001 spans, reused not redefined", () => {
    expect(CorrelatedSpanName.taskExecute).toBe(TelemetryInstruments.SpanName.taskExecute)
    expect(CorrelatedSpanName.llmRequest).toBe(TelemetryInstruments.SpanName.llmRequest)
    expect(CorrelatedSpanName.toolExecute).toBe(TelemetryInstruments.SpanName.toolExecute)
    expect(CorrelatedSpanName.fallback).toBe(TelemetryInstruments.SpanName.fallback)
  })

  test("jobs span names do not collide with the Feature 001 span names (distinct concepts)", () => {
    const feature001 = new Set(Object.values(TelemetryInstruments.SpanName) as string[])
    for (const span of Object.values(SpanName)) {
      expect(feature001.has(span), `jobs span "${span}" must be its own concept`).toBe(false)
    }
  })

  test("no span-correlation id is ever a bounded metric label key (correlation rides on spans/events)", () => {
    for (const key of Object.keys(Labels)) {
      for (const token of ["event_id", "trace_id", "span_id", "correlation", "causation"]) {
        expect(key.includes(token), `label "${key}" leaks a span-correlation id as a metric dimension`).toBe(false)
      }
    }
  })
})
