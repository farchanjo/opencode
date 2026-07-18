import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Watchdog } from "../src/lifecycle/watchdog"

const validLease = {
  lease_id: "l1",
  process_id: "p1",
  runtime_instance_id: "rt1",
  last_heartbeat_at: 1_720_000_000_000,
  expires_at: 1_720_000_015_000,
}

const validReconcile = {
  process_id: "p1",
  outcome: "reconciled",
  from_version: 3,
  auto_retry: false,
}

describe("Watchdog.WatchdogLease", () => {
  test("round-trips a valid in-memory lease (timestamps as epoch millis)", () => {
    const decoded = Schema.decodeUnknownSync(Watchdog.WatchdogLease)(validLease)
    expect(Schema.encodeSync(Watchdog.WatchdogLease)(decoded) as unknown).toEqual(validLease)
  })
})

describe("Watchdog.ZombieAssessment", () => {
  test("accepts every WatchdogOutcome and rejects an outsider", () => {
    for (const outcome of ["owner_lost", "zombie_detected", "unknown", "reconciled"] as const) {
      const decoded = Schema.decodeUnknownSync(Watchdog.ZombieAssessment)({
        process_id: "p1",
        outcome,
        reason: "lease expired",
      })
      expect(decoded.outcome).toBe(outcome)
    }
    expect(() =>
      Schema.decodeUnknownSync(Watchdog.ZombieAssessment)({ process_id: "p1", outcome: "killed", reason: "x" }),
    ).toThrow()
  })
})

describe("Watchdog.ReconcileRecord", () => {
  test("round-trips a record with auto_retry pinned false", () => {
    expect(Schema.decodeUnknownSync(Watchdog.ReconcileRecord)(validReconcile) as unknown).toEqual(validReconcile)
  })

  test("rejects auto_retry true (reconciliation never re-executes effects)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Watchdog.ReconcileRecord)({ ...validReconcile, auto_retry: true }),
    ).toThrow()
  })

  test("rejects a from_version below 1 (SchemaVersion is >= 1)", () => {
    expect(() => Schema.decodeUnknownSync(Watchdog.ReconcileRecord)({ ...validReconcile, from_version: 0 })).toThrow()
  })
})
