import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TextValues } from "../../src/jobs/text-values"
import { Values } from "../../src/jobs/values"

// Feature 003 / T032 — packages/schema/src/jobs/values.ts and text-values.ts
// mirror doc/arch/schemas/jobs/values.cue and text-values.cue one-to-one
// (FR2, FR19, FR22, FR32, C6, Privacy). Sequence/attempt/generation are
// carried, not authored — the Feature 002 executor owns them (C6).

describe("Values ordering counters (Sequence / Attempt / Generation)", () => {
  test("Sequence accepts zero and positive integers", () => {
    expect(Schema.decodeUnknownSync(Values.Sequence)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(Values.Sequence)(5)).toBe(5)
  })

  test("Sequence rejects a negative value and a non-integer", () => {
    expect(() => Schema.decodeUnknownSync(Values.Sequence)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.Sequence)(1.5)).toThrow()
  })

  test("Attempt is 1-based; rejects zero", () => {
    expect(Schema.decodeUnknownSync(Values.Attempt)(1)).toBe(1)
    expect(() => Schema.decodeUnknownSync(Values.Attempt)(0)).toThrow()
  })

  test("Generation accepts zero (fencing generation, C6)", () => {
    expect(Schema.decodeUnknownSync(Values.Generation)(0)).toBe(0)
    expect(() => Schema.decodeUnknownSync(Values.Generation)(-1)).toThrow()
  })
})

describe("Values version counters (SchemaVersion / Version)", () => {
  test("both are 1-based and reject zero", () => {
    expect(Schema.decodeUnknownSync(Values.SchemaVersion)(1)).toBe(1)
    expect(() => Schema.decodeUnknownSync(Values.SchemaVersion)(0)).toThrow()
    expect(Schema.decodeUnknownSync(Values.Version)(1)).toBe(1)
    expect(() => Schema.decodeUnknownSync(Values.Version)(0)).toThrow()
  })
})

describe("Values budget/lag counters (DeadlineMs / TimeoutMs / RetryBudget / Priority / ScheduleLagMs)", () => {
  test("accept zero and positive integers", () => {
    for (const schema of [Values.DeadlineMs, Values.TimeoutMs, Values.RetryBudget, Values.Priority, Values.ScheduleLagMs]) {
      expect(Schema.decodeUnknownSync(schema)(0)).toBe(0)
      expect(Schema.decodeUnknownSync(schema)(900_000)).toBe(900_000)
    }
  })

  test("reject a negative value", () => {
    for (const schema of [Values.DeadlineMs, Values.TimeoutMs, Values.RetryBudget, Values.Priority, Values.ScheduleLagMs]) {
      expect(() => Schema.decodeUnknownSync(schema)(-1)).toThrow()
    }
  })
})

describe("TextValues bounded redacted text/flag ValueObjects (FR22, FR32, Privacy)", () => {
  test("JobName rejects empty; JobDescription accepts empty", () => {
    expect(() => Schema.decodeUnknownSync(TextValues.JobName)("")).toThrow()
    expect(Schema.decodeUnknownSync(TextValues.JobName)("nightly-backup")).toBe("nightly-backup")
    expect(Schema.decodeUnknownSync(TextValues.JobDescription)("")).toBe("")
  })

  test("ActionTarget rejects empty (redacted handle, never a shell literal, FR28/FR29)", () => {
    expect(() => Schema.decodeUnknownSync(TextValues.ActionTarget)("")).toThrow()
    expect(Schema.decodeUnknownSync(TextValues.ActionTarget)("action_ref_1")).toBe("action_ref_1")
  })

  test("BoundedSummary and Reason accept an empty string", () => {
    expect(Schema.decodeUnknownSync(TextValues.BoundedSummary)("")).toBe("")
    expect(Schema.decodeUnknownSync(TextValues.Reason)("")).toBe("")
  })

  test("BoundedSummary never carries full content markers beyond a plain bounded string decode", () => {
    const summary = "occurrence completed"
    expect(Schema.decodeUnknownSync(TextValues.BoundedSummary)(summary)).toBe(summary)
  })

  test("TraceId / SpanId reject empty (traces/logs only, never a metric label, C18)", () => {
    expect(() => Schema.decodeUnknownSync(TextValues.TraceId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(TextValues.SpanId)("")).toThrow()
    expect(Schema.decodeUnknownSync(TextValues.TraceId)("trace_1")).toBe("trace_1")
  })

  test("Enabled decodes a boolean", () => {
    expect(Schema.decodeUnknownSync(TextValues.Enabled)(true)).toBe(true)
    expect(Schema.decodeUnknownSync(TextValues.Enabled)(false)).toBe(false)
  })

  test("PermissionSet decodes an array of permission ids and preserves order", () => {
    const decoded = Schema.decodeUnknownSync(TextValues.PermissionSet)(["read", "edit"])
    expect(decoded).toEqual(["read", "edit"])
    expect(Schema.encodeSync(TextValues.PermissionSet)(decoded)).toEqual(["read", "edit"])
  })
})
