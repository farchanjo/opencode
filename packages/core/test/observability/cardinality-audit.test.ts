/**
 * Feature 001 / T038 — metric-label cardinality audit.
 *
 * ADR-0001 forbids unbounded / user-correlating identifiers from ever appearing
 * as metric labels: session/message/turn/decision/request ids and dynamic skill
 * ids stay in traces and logs, never in metric dimensions. This audit pins the
 * bounded label vocabulary (the `Labels` enums + the dynamic-id dimensions the
 * label bounder admits) so it can never silently grow a high-cardinality or
 * content-correlating dimension, and proves the bounder collapses out-of-budget
 * and out-of-enum values to `other`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { boundEnum, Labels, OTHER } from "@opencode-ai/core/observability/telemetry-instruments"
import { createLabelBounder } from "@opencode-ai/core/observability/otlp"

// Identifiers that must NEVER be metric labels (unbounded / user-correlating).
const FORBIDDEN_LABEL_TOKENS = [
  "session",
  "session_id",
  "message",
  "message_id",
  "turn",
  "turn_id",
  "decision",
  "decision_id",
  "request",
  "request_id",
  "skill",
  "skill_id",
  "prompt",
  "user",
  "path",
]

const instrumentsSrc = readFileSync(
  fileURLToPath(new URL("../../src/observability/telemetry-instruments.ts", import.meta.url)),
  "utf8",
)
const otlpSrc = readFileSync(fileURLToPath(new URL("../../src/observability/otlp.ts", import.meta.url)), "utf8")

describe("T038 cardinality audit — bounded enum label vocabulary", () => {
  test("no bounded enum label key is a session/message/dynamic-skill identifier", () => {
    const keys = Object.keys(Labels)
    for (const key of keys) {
      for (const token of FORBIDDEN_LABEL_TOKENS) {
        expect(key === token, `enum label "${key}" is forbidden as a metric dimension`).toBe(false)
      }
    }
    // The vocabulary is exactly the ADR-0001 bounded set.
    expect(keys.sort()).toEqual(
      ["execution_boundary", "hierarchy_role", "reasoning_effort", "routing_profile", "status", "task_class", "task_effort"].sort(),
    )
  })

  test("every enum's values are a finite bounded allowlist", () => {
    for (const [key, values] of Object.entries(Labels)) {
      expect(Array.isArray(values), `${key} must be a finite allowlist`).toBe(true)
      expect(values.length).toBeGreaterThan(0)
      expect(values.length).toBeLessThanOrEqual(8)
    }
  })
})

describe("T038 cardinality audit — dynamic-id dimensions exclude correlating ids", () => {
  test("the dynamic label dimensions are exactly provider/model/variant/agent", () => {
    // Source-of-truth scan: the DYNAMIC_LABELS tuple governs which dimensions are
    // gated by the cardinality budget. It must not admit a session/message/skill dim.
    const match = otlpSrc.match(/const DYNAMIC_LABELS\s*=\s*\[([^\]]*)\]/)
    expect(match, "DYNAMIC_LABELS tuple not found in otlp.ts").not.toBeNull()
    const dims = [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
    expect(dims.sort()).toEqual(["agent", "model", "provider", "variant"])
    for (const dim of dims) {
      for (const token of FORBIDDEN_LABEL_TOKENS) expect(dim).not.toBe(token)
    }
  })

  test("no metric instrument name embeds a correlating identifier", () => {
    // Metric names live in telemetry-instruments.ts as Metric.<kind>("name", ...).
    const names = [...instrumentsSrc.matchAll(/Metric\.\w+\("([^"]+)"/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      for (const token of ["session", "message", "turn", "user", "prompt"]) {
        expect(name.includes(token), `metric "${name}" embeds "${token}"`).toBe(false)
      }
    }
  })
})

describe("T038 cardinality audit — bounder collapses over-budget / out-of-enum values", () => {
  test("boundEnum maps a session-id-shaped value to `other` for every enum", () => {
    const fabricated = "sess_01J8Z4Q3X7"
    for (const values of Object.values(Labels)) {
      expect(boundEnum(values, fabricated)).toBe(OTHER)
    }
  })

  test("the label bounder admits enum values, bounds dynamic ids, and passes non-label keys through", () => {
    const bounder = createLabelBounder(2)
    // Enum label bounded to itself; unknown enum value → other.
    expect(bounder.bound({ task_class: "small" }).task_class).toBe("small")
    expect(bounder.bound({ status: "bogus" }).status).toBe(OTHER)
    // Dynamic ids admitted up to the budget, then collapsed.
    expect(bounder.bound({ model: "m-a" }).model).toBe("m-a")
    expect(bounder.bound({ model: "m-b" }).model).toBe("m-b")
    expect(bounder.bound({ model: "m-c" }).model).toBe(OTHER)
    // A correlating key is neither an enum nor a dynamic dimension — it is passed
    // through untouched, which is the signal to emitters that it must never be
    // supplied as a metric label (only enum + dynamic dims are sanctioned).
    const out = bounder.bound({ session_id: "sess-1" })
    expect(out.session_id).toBe("sess-1")
    expect("session_id" in Labels).toBe(false)
  })
})
