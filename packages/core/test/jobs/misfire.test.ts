import { describe, expect, test } from "bun:test"
import { Misfire } from "@opencode-ai/core/jobs/misfire"

// Feature 003 / T031 (S18) — misfire policy matrix over
// `skip | fire_once | bounded_catch_up | coalesce`. Pure, total, zero I/O. The
// load-bearing invariant is NO infinite catch-up (FR15, C19, AC3, AC24): the
// bounded ceiling drops overflow as an explicit `misfired` outcome, never a
// silent unbounded queue.

const times = (n: number): string[] => Array.from({ length: n }, (_, i) => `2026-07-18T00:0${i}:00.000Z`)

describe("Misfire — constants are explicit overridable data (data-model Parameters)", () => {
  test("default policy is skip (AC3)", () => {
    expect(Misfire.DEFAULT_MISFIRE_POLICY).toBe("skip")
  })

  test("default catch-up ceiling is 16 and the hard ceiling is 256 (AC3, AC21, C19)", () => {
    expect(Misfire.DEFAULT_CATCH_UP_CEILING).toBe(16)
    expect(Misfire.MAX_CATCH_UP_CEILING).toBe(256)
  })
})

describe("Misfire.evaluateMisfire — empty input", () => {
  test("no elapsed instants fire nothing", () => {
    for (const policy of ["skip", "fire_once", "bounded_catch_up", "coalesce"] as const) {
      const decision = Misfire.evaluateMisfire({ policy, missedNominalTimes: [] })
      expect(decision.entries).toHaveLength(0)
      expect(decision.firedCount).toBe(0)
      expect(decision.droppedOverCeiling).toBe(0)
    }
  })
})

describe("Misfire.evaluateMisfire — skip", () => {
  test("fires none; every instant resolves to skipped", () => {
    const missed = times(4)
    const decision = Misfire.evaluateMisfire({ policy: "skip", missedNominalTimes: missed })
    expect(decision.firedCount).toBe(0)
    expect(decision.droppedOverCeiling).toBe(0)
    expect(decision.entries.every((e) => e.action === "skip" && e.outcome === "skipped")).toBe(true)
    expect(decision.entries).toHaveLength(4)
  })
})

describe("Misfire.evaluateMisfire — fire_once", () => {
  test("fires only the most recent instant; older ones are misfired (single catch-up, never a burst)", () => {
    const missed = times(3)
    const decision = Misfire.evaluateMisfire({ policy: "fire_once", missedNominalTimes: missed })
    expect(decision.firedCount).toBe(1)
    expect(decision.droppedOverCeiling).toBe(0)
    expect(decision.entries[0]!.outcome).toBe("misfired")
    expect(decision.entries[1]!.outcome).toBe("misfired")
    const last = decision.entries[2]!
    expect(last.action).toBe("fire")
    expect(last.outcome).toBe("claimed")
    expect(last.nominalDueTime).toBe(missed[2]!)
  })

  test("a single missed instant fires it", () => {
    const decision = Misfire.evaluateMisfire({ policy: "fire_once", missedNominalTimes: times(1) })
    expect(decision.firedCount).toBe(1)
    expect(decision.entries[0]!.outcome).toBe("claimed")
  })
})

describe("Misfire.evaluateMisfire — coalesce", () => {
  test("fires the most recent; older instants collapse into coalesced", () => {
    const missed = times(5)
    const decision = Misfire.evaluateMisfire({ policy: "coalesce", missedNominalTimes: missed })
    expect(decision.firedCount).toBe(1)
    expect(decision.droppedOverCeiling).toBe(0)
    expect(decision.entries.slice(0, 4).every((e) => e.action === "coalesce" && e.outcome === "coalesced")).toBe(true)
    expect(decision.entries[4]!.outcome).toBe("claimed")
  })
})

describe("Misfire.evaluateMisfire — bounded_catch_up (NO infinite catch-up, C19, AC24)", () => {
  test("fires the newest min(count, ceiling) instants; excess is dropped as misfired", () => {
    const missed = times(6)
    const decision = Misfire.evaluateMisfire({
      policy: "bounded_catch_up",
      missedNominalTimes: missed,
      catchUpCeiling: 4,
    })
    expect(decision.firedCount).toBe(4)
    expect(decision.droppedOverCeiling).toBe(2)
    // Oldest two overflow the ceiling.
    expect(decision.entries[0]!.action).toBe("drop_over_ceiling")
    expect(decision.entries[0]!.outcome).toBe("misfired")
    expect(decision.entries[1]!.outcome).toBe("misfired")
    // Newest four fire.
    for (let i = 2; i < 6; i++) {
      expect(decision.entries[i]!.action).toBe("fire")
      expect(decision.entries[i]!.outcome).toBe("claimed")
    }
  })

  test("fewer missed than the ceiling fires them all with no drops", () => {
    const decision = Misfire.evaluateMisfire({
      policy: "bounded_catch_up",
      missedNominalTimes: times(3),
      catchUpCeiling: 8,
    })
    expect(decision.firedCount).toBe(3)
    expect(decision.droppedOverCeiling).toBe(0)
  })

  test("uses DEFAULT_CATCH_UP_CEILING when no ceiling is supplied", () => {
    const missed = times(20)
    const decision = Misfire.evaluateMisfire({ policy: "bounded_catch_up", missedNominalTimes: missed })
    expect(decision.firedCount).toBe(Misfire.DEFAULT_CATCH_UP_CEILING)
    expect(decision.droppedOverCeiling).toBe(20 - Misfire.DEFAULT_CATCH_UP_CEILING)
  })

  test("clamps a ceiling above the hard maximum to MAX_CATCH_UP_CEILING (never infinite)", () => {
    const missed = times(10)
    const decision = Misfire.evaluateMisfire({
      policy: "bounded_catch_up",
      missedNominalTimes: missed,
      catchUpCeiling: 10_000,
    })
    // Ceiling clamps to 256 which still exceeds the 10 missed, so all fire, none dropped.
    expect(decision.firedCount).toBe(10)
    expect(decision.droppedOverCeiling).toBe(0)
  })

  test("a zero, negative, or non-finite ceiling fires nothing — all instants misfired (never infinite)", () => {
    for (const ceiling of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const missed = times(4)
      const decision = Misfire.evaluateMisfire({
        policy: "bounded_catch_up",
        missedNominalTimes: missed,
        catchUpCeiling: ceiling,
      })
      if (ceiling === Number.POSITIVE_INFINITY) {
        // Infinity is non-finite → clamped to zero, so nothing fires (no infinite catch-up).
        expect(decision.firedCount).toBe(0)
        expect(decision.droppedOverCeiling).toBe(4)
      } else {
        expect(decision.firedCount).toBe(0)
        expect(decision.droppedOverCeiling).toBe(4)
        expect(decision.entries.every((e) => e.outcome === "misfired")).toBe(true)
      }
    }
  })
})
