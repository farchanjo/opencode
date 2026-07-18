import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Schedule } from "../../src/jobs/schedule"

// Feature 003 / T032 — packages/schema/src/jobs/schedule.ts mirrors
// doc/arch/schemas/jobs/schedule.cue one-to-one (FR7, C4, AC22). The
// canonical stored form is an IANA timezone plus a 5-field cron expression;
// NominalDueTime is a branded string key (never a decoded DateTime) so the
// idempotency tuple keeps a stable identity (C6).

describe("Schedule.CronExpression", () => {
  test("accepts a 5-field cron expression", () => {
    const decoded = Schema.decodeUnknownSync(Schedule.CronExpression)("0 3 * * *")
    expect(Schema.encodeSync(Schedule.CronExpression)(decoded)).toBe("0 3 * * *")
  })

  test("accepts each supported nickname", () => {
    for (const nickname of ["@annually", "@yearly", "@monthly", "@weekly", "@daily", "@hourly"]) {
      expect(Schema.decodeUnknownSync(Schedule.CronExpression)(nickname)).toBe(Schedule.CronExpression.make(nickname))
    }
  })

  test("rejects a 4-field expression and an unsupported nickname", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.CronExpression)("0 3 * *")).toThrow()
    expect(() => Schema.decodeUnknownSync(Schedule.CronExpression)("@fortnightly")).toThrow()
  })
})

describe("Schedule.IanaTimezone", () => {
  test("accepts UTC and a Region/City zone", () => {
    expect(Schema.decodeUnknownSync(Schedule.IanaTimezone)("UTC")).toBe(Schedule.IanaTimezone.make("UTC"))
    expect(Schema.decodeUnknownSync(Schedule.IanaTimezone)("America/New_York")).toBe(
      Schedule.IanaTimezone.make("America/New_York"),
    )
    expect(Schema.decodeUnknownSync(Schedule.IanaTimezone)("America/Argentina/Buenos_Aires")).toBe(
      Schedule.IanaTimezone.make("America/Argentina/Buenos_Aires"),
    )
  })

  test("rejects an unsupported/malformed zone before registration (AC22)", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.IanaTimezone)("Not A Zone")).toThrow()
    expect(() => Schema.decodeUnknownSync(Schedule.IanaTimezone)("")).toThrow()
  })
})

describe("Schedule.MinimumIntervalMs", () => {
  test("accepts zero and a positive interval", () => {
    expect(Schema.decodeUnknownSync(Schedule.MinimumIntervalMs)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(Schedule.MinimumIntervalMs)(60_000)).toBe(60_000)
  })

  test("rejects a negative interval", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.MinimumIntervalMs)(-1)).toThrow()
  })
})

describe("Schedule.NominalDueTime — canonical string key, never a decoded DateTime (FR19, C6)", () => {
  test("accepts a non-empty canonical instant key and round-trips as a plain string", () => {
    const decoded = Schema.decodeUnknownSync(Schedule.NominalDueTime)("2026-07-18T03:00:00Z")
    expect(typeof decoded).toBe("string")
    expect(Schema.encodeSync(Schedule.NominalDueTime)(decoded)).toBe("2026-07-18T03:00:00Z")
  })

  test("rejects an empty key", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.NominalDueTime)("")).toThrow()
  })
})

describe("Schedule.CronSchedule", () => {
  const valid = { expression: "0 3 * * *", timezone: "UTC" }

  test("round-trips a valid cron expression + IANA timezone pair", () => {
    const decoded = Schema.decodeUnknownSync(Schedule.CronSchedule)(valid)
    expect(Schema.encodeSync(Schedule.CronSchedule)(decoded)).toEqual(valid)
  })

  test("rejects a missing timezone", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.CronSchedule)({ expression: "0 3 * * *" })).toThrow()
  })

  test("rejects an invalid cron expression even with a valid timezone", () => {
    expect(() =>
      Schema.decodeUnknownSync(Schedule.CronSchedule)({ expression: "not-a-cron", timezone: "UTC" }),
    ).toThrow()
  })
})
