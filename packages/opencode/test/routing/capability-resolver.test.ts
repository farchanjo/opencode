import { describe, expect, test } from "bun:test"
import type { Capability } from "@opencode-ai/schema/routing/capability"
import {
  DIMENSION_NAMES,
  describeRequirement,
  evaluateDimension,
  isLayerFresh,
  resolveAndEvaluate,
  resolveCapabilityRecord,
  toMismatch,
} from "../../src/routing/domain/capability-resolver"

const NOW = "2026-07-18T00:00:00.000Z"

function record(
  overrides: Partial<{
    source: Capability.Source
    dimensions: Partial<Capability.ToolCallDimensions>
    confidence: number
    timestamp: string
    ttl_ms: number
    scope: string
  }> = {},
): Capability.Record {
  return {
    identity: { provider: "anthropic", model: "claude-sonnet-5", variant: "default", api: "anthropic" },
    assessment: {
      source: overrides.source ?? "catalog",
      confidence: overrides.confidence ?? 1,
      dimensions: {
        tool_call_present: null,
        max_calls_per_turn: null,
        same_turn_multiple_calls: null,
        serial_runner_execution: null,
        parallel_calls: null,
        continuation_after_tool_result: null,
        multi_turn_cycles: null,
        ...overrides.dimensions,
      },
    },
    freshness: {
      timestamp: overrides.timestamp ?? NOW,
      ttl_ms: overrides.ttl_ms ?? 3_600_000,
      scope: overrides.scope ?? "anthropic/claude-sonnet-5/default",
    },
  }
}

describe("routing.domain.capability-resolver", () => {
  test("resolves all seven dimensions from canonical catalog metadata alone", () => {
    const catalog = record({
      dimensions: {
        tool_call_present: true,
        max_calls_per_turn: 4,
        same_turn_multiple_calls: true,
        serial_runner_execution: true,
        parallel_calls: false,
        continuation_after_tool_result: true,
        multi_turn_cycles: true,
      },
    })

    const resolved = resolveCapabilityRecord(catalog, [], NOW)

    for (const dimension of DIMENSION_NAMES) {
      expect(resolved.assessment.dimensions[dimension]).toBe(catalog.assessment.dimensions[dimension])
    }
    expect(resolved.assessment.source).toBe("catalog")
  })

  test("a fresh override overlay takes precedence over catalog metadata per dimension", () => {
    const catalog = record({ dimensions: { parallel_calls: false } })
    const override = record({
      source: "override",
      dimensions: { parallel_calls: true },
      confidence: 0.9,
    })

    const resolved = resolveCapabilityRecord(catalog, [override], NOW)

    expect(resolved.assessment.dimensions.parallel_calls).toBe(true)
    expect(resolved.assessment.source).toBe("override")
    expect(resolved.assessment.confidence).toBe(0.9)
  })

  test("an expired overlay is excluded and resolution falls through to catalog", () => {
    const catalog = record({ dimensions: { parallel_calls: false } })
    const expiredOverride = record({
      source: "override",
      dimensions: { parallel_calls: true },
      timestamp: "2020-01-01T00:00:00.000Z",
      ttl_ms: 1,
    })

    expect(isLayerFresh(expiredOverride, NOW)).toBe(false)

    const resolved = resolveCapabilityRecord(catalog, [expiredOverride], NOW)

    expect(resolved.assessment.dimensions.parallel_calls).toBe(false)
    expect(resolved.assessment.source).toBe("catalog")
  })

  test("precedence order determines which overlay wins when both are fresh", () => {
    const catalog = record()
    const observed = record({ source: "observed", dimensions: { tool_call_present: true } })
    const override = record({ source: "override", dimensions: { tool_call_present: false } })

    const resolved = resolveCapabilityRecord(catalog, [observed, override], NOW)

    // Default precedence: override before observed.
    expect(resolved.assessment.dimensions.tool_call_present).toBe(false)
    expect(resolved.assessment.source).toBe("override")
  })

  test("a dimension unresolved by any layer stays null (unknown), never promoted", () => {
    const catalog = record()

    const resolved = resolveCapabilityRecord(catalog, [], NOW)

    for (const dimension of DIMENSION_NAMES) {
      expect(resolved.assessment.dimensions[dimension]).toBeNull()
    }
  })

  test("evaluateDimension: requirement null/false is always met, regardless of value", () => {
    expect(evaluateDimension("parallel_calls", null, null, "deny").met).toBe(true)
    expect(evaluateDimension("parallel_calls", false, false, "deny").met).toBe(true)
  })

  test("evaluateDimension: unknown value under deny policy is unmet", () => {
    const evaluation = evaluateDimension("tool_call_present", null, true, "deny")

    expect(evaluation.met).toBe(false)
    expect(evaluation.reason).toBe("capability_unknown_deny")
  })

  test("evaluateDimension: unknown value under allow policy is met", () => {
    const evaluation = evaluateDimension("tool_call_present", null, true, "allow")

    expect(evaluation.met).toBe(true)
    expect(evaluation.reason).toBe("capability_unknown_allow")
  })

  test("evaluateDimension: numeric dimension compares by minimum threshold", () => {
    expect(evaluateDimension("max_calls_per_turn", 4, 2, "deny").met).toBe(true)
    expect(evaluateDimension("max_calls_per_turn", 1, 2, "deny").met).toBe(false)
  })

  test("evaluateDimension: boolean dimension requires an exact true value", () => {
    expect(evaluateDimension("parallel_calls", true, true, "deny").met).toBe(true)
    expect(evaluateDimension("parallel_calls", false, true, "deny").met).toBe(false)
  })

  test("describeRequirement renders a human-readable Requirement string", () => {
    expect(describeRequirement("max_calls_per_turn", 3)).toBe("max_calls_per_turn >= 3")
    expect(describeRequirement("parallel_calls", true)).toBe("parallel_calls == true")
    expect(describeRequirement("parallel_calls", null)).toBe("parallel_calls: not required")
  })

  test("toMismatch produces a schema-shaped Capability.Mismatch", () => {
    const mismatch = toMismatch("parallel_calls", true, null, "anthropic/claude-sonnet-5", "capability_unknown_deny")

    expect(mismatch).toEqual({
      dimension: "parallel_calls",
      requirement: "parallel_calls == true",
      candidate_value: null,
      reason: "capability_unknown_deny",
      scope: "anthropic/claude-sonnet-5",
      outcome: "hard_gate_reject",
    })
  })

  test("resolveAndEvaluate: a satisfied candidate produces zero mismatches", () => {
    const catalog = record({
      dimensions: {
        tool_call_present: true,
        parallel_calls: true,
        max_calls_per_turn: 8,
      },
    })

    const { record: resolved, mismatches } = resolveAndEvaluate(
      catalog,
      [],
      { tool_call_present: true, parallel_calls: true, max_calls_per_turn: 4 },
      "deny",
      NOW,
    )

    expect(mismatches).toEqual([])
    expect(resolved.assessment.dimensions.parallel_calls).toBe(true)
  })

  test("resolveAndEvaluate: unmet requirements yield one Mismatch per dimension", () => {
    const catalog = record({ dimensions: { parallel_calls: false } }) // tool_call_present left null (unknown)

    const { mismatches } = resolveAndEvaluate(
      catalog,
      [],
      { tool_call_present: true, parallel_calls: true },
      "deny",
      NOW,
    )

    expect(mismatches).toHaveLength(2)
    const byDimension = Object.fromEntries(mismatches.map((mismatch) => [mismatch.dimension, mismatch]))
    expect(byDimension.tool_call_present?.reason).toBe("capability_unknown_deny")
    expect(byDimension.parallel_calls?.reason).toBe("capability_unsupported")
  })

  test("resolveAndEvaluate: allow policy admits unknown dimensions with no mismatch", () => {
    const catalog = record() // every dimension unknown

    const { mismatches } = resolveAndEvaluate(catalog, [], { tool_call_present: true }, "allow", NOW)

    expect(mismatches).toEqual([])
  })
})
