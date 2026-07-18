import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Reconciliation } from "../../src/jobs/reconciliation"

// Feature 003 / T032 — packages/schema/src/jobs/reconciliation.ts mirrors
// doc/arch/schemas/jobs/reconciliation.cue one-to-one (FR6, FR14, C5, C11,
// AC19, AC23). auto_retry is pinned false: reconciliation never re-executes
// an ambiguous mutating effect and no cross-system atomic commit is claimed.

describe("Reconciliation.AutoRetryDisabled — pinned false (FR14, C11)", () => {
  test("decodes false", () => {
    expect(Schema.decodeUnknownSync(Reconciliation.AutoRetryDisabled)(false)).toBe(false)
  })

  test("rejects true — reconciliation never re-executes an ambiguous mutating effect", () => {
    expect(() => Schema.decodeUnknownSync(Reconciliation.AutoRetryDisabled)(true)).toThrow()
  })
})

describe("Reconciliation.ScheduleRegistration — durable intent plus registration state (FR6, C5)", () => {
  const raw = {
    job_definition_id: "jdf_1",
    schedule_id: "sch_1",
    state: "pending",
    intent: "register",
    capability_surface: "in_process",
    updated_at: 1_721_260_800_000,
  }

  test("round-trips a pending registration", () => {
    const decoded = Schema.decodeUnknownSync(Reconciliation.ScheduleRegistration)(raw)
    expect(Schema.encodeSync(Reconciliation.ScheduleRegistration)(decoded) as unknown).toEqual(raw)
  })

  test("round-trips every registration state member", () => {
    for (const state of ["pending", "registered", "unregistered", "unknown", "reconciled"]) {
      const value = { ...raw, state }
      const decoded = Schema.decodeUnknownSync(Reconciliation.ScheduleRegistration)(value)
      expect(Schema.encodeSync(Reconciliation.ScheduleRegistration)(decoded) as unknown).toEqual(value)
    }
  })

  test("rejects an out-of-vocabulary intent", () => {
    expect(() =>
      Schema.decodeUnknownSync(Reconciliation.ScheduleRegistration)({ ...raw, intent: "reregister" }),
    ).toThrow()
  })
})

describe("Reconciliation.OccurrenceReconcile — versioned, no auto-retry (FR14, AC19)", () => {
  const raw = { occurrence_id: "occ_1", outcome: "reconciled", from_version: 3, auto_retry: false } as const

  test("round-trips a reconciled outcome", () => {
    const decoded = Schema.decodeUnknownSync(Reconciliation.OccurrenceReconcile)(raw)
    expect(Schema.encodeSync(Reconciliation.OccurrenceReconcile)(decoded)).toEqual(raw)
  })

  test("rejects auto_retry: true — no blind mutation retry after reconciliation", () => {
    expect(() =>
      Schema.decodeUnknownSync(Reconciliation.OccurrenceReconcile)({ ...raw, auto_retry: true }),
    ).toThrow()
  })

  test("rejects a from_version below one", () => {
    expect(() =>
      Schema.decodeUnknownSync(Reconciliation.OccurrenceReconcile)({ ...raw, from_version: 0 }),
    ).toThrow()
  })
})

describe("Reconciliation.RegistrationReconcile — no cross-system atomic commit is claimed (AC23)", () => {
  const raw = {
    job_definition_id: "jdf_1",
    schedule_id: "sch_1",
    outcome: "unknown",
    from_state: "registered",
    auto_retry: false,
  } as const

  test("round-trips an unknown-outcome reconciliation record", () => {
    const decoded = Schema.decodeUnknownSync(Reconciliation.RegistrationReconcile)(raw)
    expect(Schema.encodeSync(Reconciliation.RegistrationReconcile)(decoded)).toEqual(raw)
  })

  test("rejects auto_retry: true", () => {
    expect(() =>
      Schema.decodeUnknownSync(Reconciliation.RegistrationReconcile)({ ...raw, auto_retry: true }),
    ).toThrow()
  })
})
