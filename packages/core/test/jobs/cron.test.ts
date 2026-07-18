import { describe, expect, test } from "bun:test"
import { Cron } from "@opencode-ai/core/jobs/cron"

// Feature 003 / T031 (S18) — cron parse/validate, DST normalization, and next-
// occurrence computation over a deterministic `NextOccurrencePort` stub under a
// fake clock. Framework-free, zero I/O, no Bun runtime import (FR7, C4, AC4,
// AC22). The port stub stands in for `Bun.cron.parse`; the domain only advances
// the anchor, floors by the minimum interval, and measures lag.

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * A deterministic next-occurrence port firing at a fixed interval from an epoch
 * origin, ignoring the timezone (the real adapter resolves it; the domain math
 * is under test here). Returns the first tick strictly after `afterMs`.
 */
const fixedIntervalPort = (originMs: number, stepMs: number): Cron.NextOccurrencePort => ({
  next: ({ afterMs }) => {
    const k = Math.floor((afterMs - originMs) / stepMs) + 1
    return originMs + k * stepMs
  },
})

/** A port that yields a finite list of instants then exhausts to null. */
const listPort = (instants: readonly number[]): Cron.NextOccurrencePort => ({
  next: ({ afterMs }) => instants.find((t) => t > afterMs) ?? null,
})

describe("Cron.parseCronExpression — 5-field and nickname forms (FR7, C4)", () => {
  test("exposes the six supported nicknames and a field count of 5", () => {
    expect([...Cron.CRON_NICKNAMES]).toEqual([
      "@annually",
      "@yearly",
      "@monthly",
      "@weekly",
      "@daily",
      "@hourly",
    ])
    expect(Cron.CRON_FIELD_COUNT).toBe(5)
  })

  test("parses a valid 5-field expression", () => {
    const parsed = Cron.parseCronExpression("*/5 * * * *")
    expect(parsed.kind).toBe("fields")
    if (parsed.kind === "fields") expect(parsed.fields).toHaveLength(5)
  })

  test("parses each supported nickname", () => {
    for (const nick of Cron.CRON_NICKNAMES) {
      const parsed = Cron.parseCronExpression(nick)
      expect(parsed.kind).toBe("nickname")
    }
  })

  test("rejects an unsupported nickname with a reason (typed gap before registration, AC22)", () => {
    const parsed = Cron.parseCronExpression("@fortnightly")
    expect(parsed.kind).toBe("invalid")
    if (parsed.kind === "invalid") expect(parsed.reason).toContain("unsupported cron nickname")
  })

  test("rejects the wrong field count and an empty expression", () => {
    expect(Cron.parseCronExpression("* * * *").kind).toBe("invalid")
    expect(Cron.parseCronExpression("* * * * * *").kind).toBe("invalid")
    expect(Cron.parseCronExpression("   ").kind).toBe("invalid")
  })

  test("isValidCronExpression is true for valid forms and false otherwise", () => {
    expect(Cron.isValidCronExpression("0 9 * * 1")).toBe(true)
    expect(Cron.isValidCronExpression("@daily")).toBe(true)
    expect(Cron.isValidCronExpression("nonsense")).toBe(false)
  })
})

describe("Cron.resolveDstAmbiguity — fall-back duplicate hour normalization (C4, AC4)", () => {
  const earlier = Date.UTC(2026, 10, 1, 5, 30) // 01:30 EDT
  const later = Date.UTC(2026, 10, 1, 6, 30) // 01:30 EST (the repeated wall time)

  test("earliest policy picks the earlier of the two duplicate instants", () => {
    expect(Cron.resolveDstAmbiguity([later, earlier], "earliest")).toBe(earlier)
  })

  test("latest policy picks the later of the two duplicate instants", () => {
    expect(Cron.resolveDstAmbiguity([earlier, later], "latest")).toBe(later)
  })

  test("skip policy drops an ambiguous duplicate (two candidates) as a no-fire outcome", () => {
    expect(Cron.resolveDstAmbiguity([earlier, later], "skip")).toBeNull()
  })

  test("skip policy passes through an unambiguous single candidate", () => {
    expect(Cron.resolveDstAmbiguity([earlier], "skip")).toBe(earlier)
  })

  test("an empty candidate set resolves to null (spring-forward skipped wall time)", () => {
    expect(Cron.resolveDstAmbiguity([], "earliest")).toBeNull()
  })

  test("default policy is earliest", () => {
    expect(Cron.DEFAULT_DST_AMBIGUITY_POLICY).toBe("earliest")
    expect(Cron.resolveDstAmbiguity([later, earlier])).toBe(earlier)
  })
})

describe("Cron.computeNextOccurrence — deterministic port under a fake clock (C4, AC4)", () => {
  const origin = Date.UTC(2026, 0, 1, 0, 0, 0)
  const minute = 60_000

  test("returns the first port instant strictly after the anchor with no minimum interval", () => {
    const port = fixedIntervalPort(origin, minute)
    const next = Cron.computeNextOccurrence(port, {
      expression: "* * * * *",
      timezone: "UTC",
      afterMs: origin,
      minimumIntervalMs: 0,
    })
    expect(next).toBe(origin + minute)
  })

  test("floors by the minimum interval relative to the last accepted occurrence", () => {
    // Port fires every 30s but the minimum interval is 60s: the 30s tick is too
    // close to the last accepted occurrence and is skipped for the 60s one.
    const port = fixedIntervalPort(origin, 30_000)
    const next = Cron.computeNextOccurrence(port, {
      expression: "* * * * *",
      timezone: "UTC",
      afterMs: origin,
      minimumIntervalMs: minute,
      lastNominalMs: origin,
    })
    expect(next).not.toBeNull()
    expect(next! - origin).toBeGreaterThanOrEqual(minute)
  })

  test("accepts an instant exactly at the minimum interval boundary", () => {
    const port = fixedIntervalPort(origin, minute)
    const next = Cron.computeNextOccurrence(port, {
      expression: "* * * * *",
      timezone: "UTC",
      afterMs: origin,
      minimumIntervalMs: minute,
      lastNominalMs: origin,
    })
    expect(next).toBe(origin + minute)
  })

  test("returns null when the schedule is exhausted (leap-boundary / finite list)", () => {
    const port = listPort([origin + minute])
    const first = Cron.computeNextOccurrence(port, {
      expression: "0 0 29 2 *", // Feb 29 — only exists on leap years
      timezone: "UTC",
      afterMs: origin,
      minimumIntervalMs: 0,
    })
    expect(first).toBe(origin + minute)
    const exhausted = Cron.computeNextOccurrence(port, {
      expression: "0 0 29 2 *",
      timezone: "UTC",
      afterMs: origin + minute,
      minimumIntervalMs: 0,
    })
    expect(exhausted).toBeNull()
  })

  test("leap day Feb 29 2028 is reachable through the port (leap-year calendar arithmetic)", () => {
    const leapDay = Date.UTC(2028, 1, 29, 0, 0, 0)
    const port = listPort([leapDay])
    const next = Cron.computeNextOccurrence(port, {
      expression: "0 0 29 2 *",
      timezone: "UTC",
      afterMs: Date.UTC(2026, 0, 1),
      minimumIntervalMs: 0,
    })
    expect(next).toBe(leapDay)
  })

  test("uses DEFAULT_MINIMUM_INTERVAL_MS when none is supplied", () => {
    expect(Cron.DEFAULT_MINIMUM_INTERVAL_MS).toBe(60_000)
  })

  test("a null last-nominal disables interval flooring (first occurrence after anchor)", () => {
    const port = fixedIntervalPort(origin, 30_000)
    const next = Cron.computeNextOccurrence(port, {
      expression: "* * * * *",
      timezone: "UTC",
      afterMs: origin,
      minimumIntervalMs: minute,
      lastNominalMs: null,
    })
    expect(next).toBe(origin + 30_000)
  })
})

describe("Cron.nominalDueKey — canonical string key, not a decoded DateTime (C6)", () => {
  test("produces a stable ISO-8601 UTC key for an epoch instant", () => {
    const ms = Date.UTC(2026, 6, 18, 12, 34, 56)
    expect(Cron.nominalDueKey(ms)).toBe(iso(ms))
  })

  test("the same instant always yields the same key (stable idempotency identity)", () => {
    const ms = Date.UTC(2026, 6, 18, 0, 0, 0)
    expect(Cron.nominalDueKey(ms)).toBe(Cron.nominalDueKey(ms))
  })
})

describe("Cron.scheduleLagMs — measured from the nominal due instant (FR19, AC3, AC4)", () => {
  test("a trigger observed after nominal reports positive lag", () => {
    expect(Cron.scheduleLagMs(1_000, 4_500)).toBe(3_500)
  })

  test("a trigger observed before nominal clamps to zero (benign skew, never negative)", () => {
    expect(Cron.scheduleLagMs(5_000, 4_000)).toBe(0)
  })

  test("an on-time trigger reports zero lag", () => {
    expect(Cron.scheduleLagMs(2_000, 2_000)).toBe(0)
  })
})

describe("Cron.isWithinClockSkew — benign-skew tolerance (AC4)", () => {
  test("default tolerance is 2000ms", () => {
    expect(Cron.DEFAULT_CLOCK_SKEW_TOLERANCE_MS).toBe(2_000)
  })

  test("an instant within tolerance on either side is benign skew", () => {
    expect(Cron.isWithinClockSkew(10_000, 11_000)).toBe(true)
    expect(Cron.isWithinClockSkew(10_000, 9_000)).toBe(true)
    expect(Cron.isWithinClockSkew(10_000, 12_000)).toBe(true)
  })

  test("an instant beyond tolerance is real lag, not skew", () => {
    expect(Cron.isWithinClockSkew(10_000, 13_000)).toBe(false)
    expect(Cron.isWithinClockSkew(10_000, 6_000)).toBe(false)
  })

  test("an explicit tolerance overrides the default", () => {
    expect(Cron.isWithinClockSkew(10_000, 15_000, 5_000)).toBe(true)
    expect(Cron.isWithinClockSkew(10_000, 15_001, 5_000)).toBe(false)
  })
})
