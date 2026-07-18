import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Occurrence } from "../../src/jobs/occurrence"

// Feature 003 / T032 — packages/schema/src/jobs/occurrence.ts mirrors
// doc/arch/schemas/jobs/occurrence.cue and occurrence-parts.cue one-to-one
// (FR8, FR8a, FR10, FR19, C6, C14, C15, AC6). The idempotency identity is the
// tuple (job_definition_id, schedule_id, nominal_due_time, generation);
// duplicate delivery resolves to a single execution with an observable
// duplicate_of outcome. Sequence/attempt/generation belong to the Feature 002
// executor, never the scheduler or a projection (C6).

const rawOccurrence = {
  id: "occ_1",
  idempotency: {
    job_definition_id: "jdf_1",
    schedule_id: "sch_1",
    nominal_due_time: "2026-07-18T03:00:00Z",
    generation: 0,
  },
  lineage: {
    correlation_id: "corr_1",
    causation_id: null,
    session_id: null,
    root_session_id: "ses_root",
    process_id: null,
  },
  execution: {
    attempt: 1,
    generation: 0,
    sequence: 0,
    todo_ref: null,
    output_ref: null,
  },
  status: {
    state: "due",
    reason: "",
    schedule_lag_ms: 0,
    duplicate_of: null,
    created_at: 1_721_260_800_000,
    updated_at: 1_721_260_800_000,
    terminal_at: null,
  },
}

describe("Occurrence.JobOccurrence", () => {
  test("round-trips a freshly-due occurrence before admission", () => {
    const decoded = Schema.decodeUnknownSync(Occurrence.JobOccurrence)(rawOccurrence)
    expect(Schema.encodeSync(Occurrence.JobOccurrence)(decoded) as unknown).toEqual(rawOccurrence)
  })

  test("round-trips an admitted occurrence carrying process/todo/output refs", () => {
    const admitted = {
      ...rawOccurrence,
      lineage: { ...rawOccurrence.lineage, session_id: "ses_1", process_id: "prc_1" },
      execution: { ...rawOccurrence.execution, todo_ref: "todo_ref_1", output_ref: "output_ref_1" },
      status: { ...rawOccurrence.status, state: "admitted" },
    }
    const decoded = Schema.decodeUnknownSync(Occurrence.JobOccurrence)(admitted)
    expect(Schema.encodeSync(Occurrence.JobOccurrence)(decoded) as unknown).toEqual(admitted)
  })

  test("round-trips a terminal occurrence with a terminal_at timestamp", () => {
    const terminal = {
      ...rawOccurrence,
      status: {
        ...rawOccurrence.status,
        state: "completed",
        terminal_at: 1_721_260_900_000,
      },
    }
    const decoded = Schema.decodeUnknownSync(Occurrence.JobOccurrence)(terminal)
    expect(Schema.encodeSync(Occurrence.JobOccurrence)(decoded) as unknown).toEqual(terminal)
  })

  test("round-trips a resolved duplicate occurrence with an observable duplicate_of outcome (AC6)", () => {
    const duplicate = {
      ...rawOccurrence,
      status: { ...rawOccurrence.status, state: "coalesced", duplicate_of: "occ_original" },
    }
    const decoded = Schema.decodeUnknownSync(Occurrence.JobOccurrence)(duplicate)
    expect(Schema.encodeSync(Occurrence.JobOccurrence)(decoded) as unknown).toEqual(duplicate)
  })

  test("rejects an out-of-vocabulary occurrence state", () => {
    expect(() =>
      Schema.decodeUnknownSync(Occurrence.JobOccurrence)({
        ...rawOccurrence,
        status: { ...rawOccurrence.status, state: "paused" },
      }),
    ).toThrow()
  })

  test("rejects an attempt below one — executor-owned, always at least 1 (C6)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Occurrence.JobOccurrence)({
        ...rawOccurrence,
        execution: { ...rawOccurrence.execution, attempt: 0 },
      }),
    ).toThrow()
  })

  test("rejects a negative schedule_lag_ms", () => {
    expect(() =>
      Schema.decodeUnknownSync(Occurrence.JobOccurrence)({
        ...rawOccurrence,
        status: { ...rawOccurrence.status, schedule_lag_ms: -1 },
      }),
    ).toThrow()
  })
})

describe("Occurrence.IdempotencyKey — (job_definition_id, schedule_id, nominal_due_time, generation) tuple (FR10, C6)", () => {
  const key = {
    job_definition_id: "jdf_1",
    schedule_id: "sch_1",
    nominal_due_time: "2026-07-18T03:00:00Z",
    generation: 0,
  }

  test("round-trips the four-part tuple exactly", () => {
    const decoded = Schema.decodeUnknownSync(Occurrence.IdempotencyKey)(key)
    expect(Schema.encodeSync(Occurrence.IdempotencyKey)(decoded)).toEqual(key)
  })

  test("two decodes of the identical tuple are structurally equal — stable identity for duplicate resolution", () => {
    const first = Schema.decodeUnknownSync(Occurrence.IdempotencyKey)(key)
    const second = Schema.decodeUnknownSync(Occurrence.IdempotencyKey)({ ...key })
    expect(first).toEqual(second)
  })

  test("a differing generation produces a distinct tuple — the fencing generation is load-bearing (C6)", () => {
    const first = Schema.decodeUnknownSync(Occurrence.IdempotencyKey)(key)
    const second = Schema.decodeUnknownSync(Occurrence.IdempotencyKey)({ ...key, generation: 1 })
    expect(first).not.toEqual(second)
  })

  test("nominal_due_time stays a plain string key through decode — never coerced to a DateTime (FR19, C6)", () => {
    const decoded = Schema.decodeUnknownSync(Occurrence.IdempotencyKey)(key)
    expect(typeof decoded.nominal_due_time).toBe("string")
  })

  test("rejects a negative generation", () => {
    expect(() => Schema.decodeUnknownSync(Occurrence.IdempotencyKey)({ ...key, generation: -1 })).toThrow()
  })
})
