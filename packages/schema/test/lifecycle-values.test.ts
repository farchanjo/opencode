import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Values } from "../src/lifecycle/values"

describe("Values.Sequence / Generation / DelegationDepth / FanoutCount / ItemCount", () => {
  test("accepts zero and positive integers", () => {
    expect(Schema.decodeUnknownSync(Values.Sequence)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(Values.Generation)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(Values.DelegationDepth)(2)).toBe(2)
    expect(Schema.decodeUnknownSync(Values.FanoutCount)(3)).toBe(3)
    expect(Schema.decodeUnknownSync(Values.ItemCount)(0)).toBe(0)
  })

  test("rejects negative integers", () => {
    expect(() => Schema.decodeUnknownSync(Values.Sequence)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.Generation)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.DelegationDepth)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.FanoutCount)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.ItemCount)(-1)).toThrow()
  })

  test("rejects non-integer numbers", () => {
    expect(() => Schema.decodeUnknownSync(Values.Sequence)(1.5)).toThrow()
  })
})

describe("Values.Attempt / SchemaVersion", () => {
  test("accepts a positive integer", () => {
    expect(Schema.decodeUnknownSync(Values.Attempt)(1)).toBe(1)
    expect(Schema.decodeUnknownSync(Values.SchemaVersion)(1)).toBe(1)
  })

  test("rejects zero and negative integers", () => {
    expect(() => Schema.decodeUnknownSync(Values.Attempt)(0)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.Attempt)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.SchemaVersion)(0)).toThrow()
  })
})

describe("Values.Reason / Description", () => {
  test("mirrors the CUE unconstrained string — empty string is valid", () => {
    expect(Schema.decodeUnknownSync(Values.Reason)("")).toBe("")
    expect(Schema.decodeUnknownSync(Values.Description)("")).toBe("")
  })

  test("round-trips a non-empty explanation", () => {
    expect(Schema.decodeUnknownSync(Values.Reason)("budget exceeded")).toBe("budget exceeded")
  })

  test("rejects a non-string value", () => {
    expect(() => Schema.decodeUnknownSync(Values.Reason)(42)).toThrow()
  })
})

describe("Values.ActivityLabel", () => {
  test("accepts a non-empty rendered label", () => {
    expect(Schema.decodeUnknownSync(Values.ActivityLabel)("Reading file.ts")).toBe("Reading file.ts")
  })

  test("rejects an empty label", () => {
    expect(() => Schema.decodeUnknownSync(Values.ActivityLabel)("")).toThrow()
  })
})
