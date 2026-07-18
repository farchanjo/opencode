import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { UsageValues } from "../src/lifecycle/usage-values"

describe("UsageValues.TokenCount / ElapsedMs / DurationMs", () => {
  test("accepts zero and positive integers", () => {
    expect(Schema.decodeUnknownSync(UsageValues.TokenCount)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(UsageValues.ElapsedMs)(1500)).toBe(1500)
    expect(Schema.decodeUnknownSync(UsageValues.DurationMs)(0)).toBe(0)
  })

  test("rejects negative integers", () => {
    expect(() => Schema.decodeUnknownSync(UsageValues.TokenCount)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.ElapsedMs)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.DurationMs)(-1)).toThrow()
  })
})

describe("UsageValues.CostUsd / TokensPerSecond", () => {
  test("accepts zero and positive finite numbers", () => {
    expect(Schema.decodeUnknownSync(UsageValues.CostUsd)(0.0042)).toBe(0.0042)
    expect(Schema.decodeUnknownSync(UsageValues.TokensPerSecond)(12.5)).toBe(12.5)
  })

  test("rejects negative numbers", () => {
    expect(() => Schema.decodeUnknownSync(UsageValues.CostUsd)(-0.01)).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.TokensPerSecond)(-1)).toThrow()
  })
})

describe("UsageValues.TraceId / SpanId / OutputRef / Cursor", () => {
  test("accepts a non-empty string and round-trips through encode", () => {
    const trace = Schema.decodeUnknownSync(UsageValues.TraceId)("trace-abc")
    expect(Schema.encodeSync(UsageValues.TraceId)(trace)).toBe("trace-abc")
    expect(Schema.decodeUnknownSync(UsageValues.SpanId)("span-abc")).toBe(UsageValues.SpanId.make("span-abc"))
    expect(Schema.decodeUnknownSync(UsageValues.OutputRef)("out-ref-1")).toBe(
      UsageValues.OutputRef.make("out-ref-1"),
    )
    expect(Schema.decodeUnknownSync(UsageValues.Cursor)("cursor-1")).toBe(UsageValues.Cursor.make("cursor-1"))
  })

  test("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(UsageValues.TraceId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.SpanId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.OutputRef)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.Cursor)("")).toThrow()
  })
})

describe("UsageValues.Confidence", () => {
  test("accepts the unit interval boundaries", () => {
    expect(Schema.decodeUnknownSync(UsageValues.Confidence)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(UsageValues.Confidence)(1)).toBe(1)
    expect(Schema.decodeUnknownSync(UsageValues.Confidence)(0.5)).toBe(0.5)
  })

  test("rejects a value outside the unit interval", () => {
    expect(() => Schema.decodeUnknownSync(UsageValues.Confidence)(-0.01)).toThrow()
    expect(() => Schema.decodeUnknownSync(UsageValues.Confidence)(1.01)).toThrow()
  })
})
