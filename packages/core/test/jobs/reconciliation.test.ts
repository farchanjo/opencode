import { describe, expect, test } from "bun:test"
import { Reconciliation } from "@opencode-ai/core/jobs/reconciliation"

// Feature 003 / T031 (S18) — startup registration and occurrence reconciliation.
// Pure, total, zero I/O. `auto_retry` is pinned false on every record —
// reconciliation NEVER re-executes an ambiguous mutating effect (FR14, C11,
// AC19, AC23). It only ever confirms (`reconciled`) or reports `unknown`; it
// never invents, regresses, or upgrades a state. Mirrors
// `packages/core/test/lifecycle/reconciliation.test.ts`.

const regInput = (
  overrides: Partial<Reconciliation.RegistrationReconcileInput>,
): Reconciliation.RegistrationReconcileInput => ({
  job_definition_id: "job_1" as never,
  schedule_id: "sch_1" as never,
  enabled: true,
  prior_state: "registered" as never,
  external_present: true,
  ...overrides,
})

const occInput = (
  overrides: Partial<Reconciliation.OccurrenceReconcileInput>,
): Reconciliation.OccurrenceReconcileInput => ({
  occurrence_id: "occ_1" as never,
  from_version: 1 as never,
  durable_version: 1 as never,
  prior_state: "executing" as never,
  dispatched: true,
  ...overrides,
})

describe("Reconciliation.reconcileRegistration (FR6, C5, AC23)", () => {
  test("always pins auto_retry false — no restart re-executes an external effect", () => {
    expect(Reconciliation.reconcileRegistration(regInput({})).auto_retry).toBe(false)
  })

  test("intent and observed effect agree → reconciled", () => {
    expect(Reconciliation.reconcileRegistration(regInput({ enabled: true, external_present: true })).outcome).toBe(
      "reconciled",
    )
    expect(Reconciliation.reconcileRegistration(regInput({ enabled: false, external_present: false })).outcome).toBe(
      "reconciled",
    )
  })

  test("an enabled definition whose registration is not observed → unknown (no cross-system atomicity, AC23)", () => {
    expect(Reconciliation.reconcileRegistration(regInput({ enabled: true, external_present: false })).outcome).toBe(
      "unknown",
    )
  })

  test("a disabled definition whose compensation is unconfirmed → unknown", () => {
    expect(Reconciliation.reconcileRegistration(regInput({ enabled: false, external_present: true })).outcome).toBe(
      "unknown",
    )
  })

  test("carries the prior registration state through as from_state", () => {
    const record = Reconciliation.reconcileRegistration(regInput({ prior_state: "pending" as never }))
    expect(record.from_state).toBe("pending" as never)
  })

  test("never emits any outcome beyond reconciled/unknown", () => {
    const outcomes = new Set<string>()
    for (const enabled of [true, false]) {
      for (const external_present of [true, false]) {
        outcomes.add(Reconciliation.reconcileRegistration(regInput({ enabled, external_present })).outcome)
      }
    }
    expect(outcomes).toEqual(new Set(["reconciled", "unknown"]))
  })
})

describe("Reconciliation.reconcileRegistrationBatch", () => {
  test("reconciles every input independently, preserving order", () => {
    const records = Reconciliation.reconcileRegistrationBatch([
      regInput({ job_definition_id: "a" as never, enabled: true, external_present: true }),
      regInput({ job_definition_id: "b" as never, enabled: true, external_present: false }),
    ])
    expect(records).toHaveLength(2)
    expect(records[0]!.outcome).toBe("reconciled")
    expect(records[1]!.outcome).toBe("unknown")
    expect(records.every((r) => r.auto_retry === false)).toBe(true)
  })
})

describe("Reconciliation.reconcileOccurrence (FR14, C5, AC19)", () => {
  test("always pins auto_retry false — a crash never replays an ambiguous mutation (FR14, AC20)", () => {
    expect(Reconciliation.reconcileOccurrence(occInput({})).auto_retry).toBe(false)
  })

  test("an absorbing terminal at a matching version → reconciled (confirm, never regress)", () => {
    for (const state of ["completed", "failed", "cancelled", "timed_out", "misfired", "skipped"] as const) {
      expect(Reconciliation.reconcileOccurrence(occInput({ prior_state: state as never })).outcome).toBe("reconciled")
    }
  })

  test("a non-terminal occurrence never confirmed as dispatched → unknown (claim-to-dispatch crash)", () => {
    expect(
      Reconciliation.reconcileOccurrence(occInput({ prior_state: "claimed" as never, dispatched: false })).outcome,
    ).toBe("unknown")
  })

  test("a non-terminal occurrence with a confirmed dispatch at the same version → reconciled", () => {
    expect(
      Reconciliation.reconcileOccurrence(occInput({ prior_state: "executing" as never, dispatched: true })).outcome,
    ).toBe("reconciled")
  })

  test("any version gap → unknown regardless of state or dispatch (never guess, C5)", () => {
    expect(
      Reconciliation.reconcileOccurrence(
        occInput({ prior_state: "completed" as never, from_version: 1 as never, durable_version: 2 as never }),
      ).outcome,
    ).toBe("unknown")
    expect(
      Reconciliation.reconcileOccurrence(
        occInput({
          prior_state: "executing" as never,
          dispatched: true,
          from_version: 1 as never,
          durable_version: 3 as never,
        }),
      ).outcome,
    ).toBe("unknown")
  })

  test("stamps from_version to the durable version just observed", () => {
    const record = Reconciliation.reconcileOccurrence(
      occInput({ from_version: 5 as never, durable_version: 5 as never }),
    )
    expect(record.from_version).toBe(5 as never)
  })

  test("never emits any outcome beyond reconciled/unknown", () => {
    const outcomes = new Set<string>()
    for (const dispatched of [true, false]) {
      for (const gap of [0, 1]) {
        for (const prior_state of ["executing", "completed"] as const) {
          outcomes.add(
            Reconciliation.reconcileOccurrence(
              occInput({ dispatched, prior_state: prior_state as never, durable_version: (1 + gap) as never }),
            ).outcome,
          )
        }
      }
    }
    expect(outcomes).toEqual(new Set(["reconciled", "unknown"]))
  })
})

describe("Reconciliation.reconcileOccurrenceBatch", () => {
  test("reconciles every occurrence independently, preserving order and pinning auto_retry false", () => {
    const records = Reconciliation.reconcileOccurrenceBatch([
      occInput({ occurrence_id: "occ_a" as never, prior_state: "completed" as never }),
      occInput({ occurrence_id: "occ_b" as never, prior_state: "claimed" as never, dispatched: false }),
    ])
    expect(records).toHaveLength(2)
    expect(records[0]!.occurrence_id).toBe("occ_a" as never)
    expect(records[0]!.outcome).toBe("reconciled")
    expect(records[1]!.occurrence_id).toBe("occ_b" as never)
    expect(records[1]!.outcome).toBe("unknown")
    expect(records.every((r) => r.auto_retry === false)).toBe(true)
  })
})
