import { describe, expect, test } from "bun:test"
import { Reconciliation } from "@opencode-ai/core/lifecycle/reconciliation"

// Feature 002 / T022 — explicit versioned reconciliation against durable
// Sessions (C13, FR40, FR42): pure, total, no I/O, `auto_retry` always false.

const processId = "proc_1" as never

function input(overrides: Partial<Reconciliation.ReconciliationInput>): Reconciliation.ReconciliationInput {
  return {
    process_id: processId,
    from_version: 1 as never,
    durable_version: 1 as never,
    prior_state: "running" as never,
    owner_present: true,
    ...overrides,
  }
}

describe("Reconciliation.reconcileProcess", () => {
  test("always pins auto_retry false — no zombie or crash re-executes an effect (FR40)", () => {
    const record = Reconciliation.reconcileProcess(input({}))
    expect(record.auto_retry).toBe(false)
  })

  test("confirms an absorbing terminal row at a matching version as reconciled", () => {
    for (const state of Reconciliation.ABSORBING_STATES) {
      const record = Reconciliation.reconcileProcess(input({ prior_state: state as never, owner_present: false }))
      expect(record.outcome).toBe("reconciled")
    }
  })

  test("reports unknown for a non-terminal row with no live owner (lost registry state, C13)", () => {
    const record = Reconciliation.reconcileProcess(
      input({ prior_state: "running" as never, owner_present: false }),
    )
    expect(record.outcome).toBe("unknown")
  })

  test("confirms a non-terminal row with a live owner at a matching version as reconciled", () => {
    const record = Reconciliation.reconcileProcess(
      input({ prior_state: "queued" as never, owner_present: true }),
    )
    expect(record.outcome).toBe("reconciled")
  })

  test("reports unknown on any version gap regardless of state or owner presence", () => {
    const terminalGap = Reconciliation.reconcileProcess(
      input({ prior_state: "completed" as never, from_version: 1 as never, durable_version: 2 as never }),
    )
    expect(terminalGap.outcome).toBe("unknown")

    const activeGap = Reconciliation.reconcileProcess(
      input({
        prior_state: "running" as never,
        owner_present: true,
        from_version: 1 as never,
        durable_version: 2 as never,
      }),
    )
    expect(activeGap.outcome).toBe("unknown")
  })

  test("never invents zombie_detected or owner_lost — those stay the watchdog's own outcomes (C12)", () => {
    const outcomes = new Set<string>()
    for (const owner_present of [true, false]) {
      for (const gap of [0, 1]) {
        outcomes.add(
          Reconciliation.reconcileProcess(
            input({ owner_present, durable_version: (1 + gap) as never }),
          ).outcome,
        )
      }
    }
    expect(outcomes).toEqual(new Set(["reconciled", "unknown"]))
  })

  test("stamps from_version to the durable version just confirmed", () => {
    const record = Reconciliation.reconcileProcess(input({ durable_version: 3 as never, from_version: 3 as never }))
    expect(record.from_version).toBe(3 as never)
  })

  test("carries the process id through unchanged", () => {
    const record = Reconciliation.reconcileProcess(input({}))
    expect(record.process_id).toBe(processId)
  })
})

describe("Reconciliation.reconcileBatch", () => {
  test("reconciles every input independently, preserving order", () => {
    const inputs = [
      input({ process_id: "proc_a" as never, prior_state: "completed" as never }),
      input({ process_id: "proc_b" as never, prior_state: "running" as never, owner_present: false }),
    ]
    const records = Reconciliation.reconcileBatch(inputs)
    expect(records).toHaveLength(2)
    expect(records[0]!.process_id).toBe("proc_a" as never)
    expect(records[0]!.outcome).toBe("reconciled")
    expect(records[1]!.process_id).toBe("proc_b" as never)
    expect(records[1]!.outcome).toBe("unknown")
  })
})

describe("Reconciliation.isAbsorbing", () => {
  test("matches exactly the five absorbing terminal states", () => {
    const nonTerminal: ReadonlyArray<string> = ["created", "queued", "waiting", "running", "cancelling"]
    for (const state of Reconciliation.ABSORBING_STATES) expect(Reconciliation.isAbsorbing(state)).toBe(true)
    for (const state of nonTerminal) expect(Reconciliation.isAbsorbing(state as never)).toBe(false)
  })
})
