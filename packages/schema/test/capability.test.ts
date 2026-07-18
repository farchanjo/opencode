import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Capability } from "../src/routing/capability"

const validDimensions: Capability.ToolCallDimensions = {
  tool_call_present: true,
  max_calls_per_turn: 4,
  same_turn_multiple_calls: true,
  serial_runner_execution: false,
  parallel_calls: null,
  continuation_after_tool_result: true,
  multi_turn_cycles: null,
}

const validRecord: Capability.Record = {
  identity: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    variant: "default",
    api: "anthropic",
  },
  assessment: {
    dimensions: validDimensions,
    source: "catalog",
    confidence: 0.9,
  },
  freshness: {
    timestamp: "2026-07-18T00:00:00Z",
    ttl_ms: 60_000,
    scope: "provider/model/variant",
  },
}

const validMismatch: Capability.Mismatch = {
  dimension: "parallel_calls",
  requirement: "requires parallel tool calls",
  candidate_value: false,
  reason: "candidate does not support parallel calls",
  scope: "provider/model/variant",
  outcome: "hard_gate_reject",
}

describe("Capability.ToolCallDimensions", () => {
  test("decodes a value with a mix of known and unknown (null) dimensions", () => {
    const decoded = Schema.decodeUnknownSync(Capability.ToolCallDimensions)(validDimensions)
    expect(decoded).toEqual(validDimensions)
  })

  test("decodes all-null dimensions", () => {
    const allUnknown: Capability.ToolCallDimensions = {
      tool_call_present: null,
      max_calls_per_turn: null,
      same_turn_multiple_calls: null,
      serial_runner_execution: null,
      parallel_calls: null,
      continuation_after_tool_result: null,
      multi_turn_cycles: null,
    }
    expect(Schema.decodeUnknownSync(Capability.ToolCallDimensions)(allUnknown)).toEqual(allUnknown)
  })

  test("rejects a non-boolean value for a boolean dimension", () => {
    expect(() =>
      Schema.decodeUnknownSync(Capability.ToolCallDimensions)({
        ...validDimensions,
        tool_call_present: "yes",
      }),
    ).toThrow()
  })

  test("rejects a negative max_calls_per_turn", () => {
    expect(() =>
      Schema.decodeUnknownSync(Capability.ToolCallDimensions)({
        ...validDimensions,
        max_calls_per_turn: -1,
      }),
    ).toThrow()
  })
})

describe("Capability.Source", () => {
  test("accepts every closed-union member", () => {
    for (const value of ["catalog", "override", "observed"] as const) {
      expect(Schema.decodeUnknownSync(Capability.Source)(value)).toBe(value)
    }
  })

  test("rejects a value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Capability.Source)("guessed")).toThrow()
  })
})

describe("Capability.Record", () => {
  test("round-trips a valid record through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Capability.Record)(validRecord)
    expect(decoded).toEqual(validRecord)
    expect(Schema.encodeSync(Capability.Record)(decoded)).toEqual(validRecord)
  })

  test("clamps confidence to [0, 1] and rejects out-of-range values", () => {
    expect(() =>
      Schema.decodeUnknownSync(Capability.Record)({
        ...validRecord,
        assessment: { ...validRecord.assessment, confidence: 1.5 },
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Capability.Record)({
        ...validRecord,
        assessment: { ...validRecord.assessment, confidence: -0.1 },
      }),
    ).toThrow()
  })

  test("rejects a non-positive ttl_ms", () => {
    expect(() =>
      Schema.decodeUnknownSync(Capability.Record)({
        ...validRecord,
        freshness: { ...validRecord.freshness, ttl_ms: 0 },
      }),
    ).toThrow()
  })

  test("rejects an empty provider identity field", () => {
    expect(() =>
      Schema.decodeUnknownSync(Capability.Record)({
        ...validRecord,
        identity: { ...validRecord.identity, provider: "" },
      }),
    ).toThrow()
  })
})

describe("Capability.Mismatch", () => {
  test("decodes a valid mismatch for each outcome", () => {
    for (const outcome of ["hard_gate_reject", "serialization", "fallback"] as const) {
      const value = { ...validMismatch, outcome }
      expect(Schema.decodeUnknownSync(Capability.Mismatch)(value)).toEqual(value)
    }
  })

  test("accepts each ToolCapabilityValue member as candidate_value", () => {
    for (const candidate_value of [true, false, 3, null] as const) {
      const value = { ...validMismatch, candidate_value }
      expect(Schema.decodeUnknownSync(Capability.Mismatch)(value)).toEqual(value)
    }
  })

  test("rejects a candidate_value outside the closed union", () => {
    expect(() =>
      Schema.decodeUnknownSync(Capability.Mismatch)({ ...validMismatch, candidate_value: "unknown" }),
    ).toThrow()
  })

  test("rejects an outcome outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Capability.Mismatch)({ ...validMismatch, outcome: "retry" })).toThrow()
  })
})
