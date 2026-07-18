/**
 * Feature 003 / T033 — trigger-service integration (AC6, AC11, AC12, AC25).
 *
 * One in-process `Bun.cron` due observation becomes a canonical Feature 002 Task
 * Process under the occurrence idempotency tuple. Duplicate delivery for one
 * tuple resolves to a single execution (AC6); admission governs the process
 * (AC12); overlap `forbid`/`replace` outcomes are evented and a mid-mutation
 * sibling is never killed (AC5, AC25). Every effect boundary is an injected seam
 * — no Bun runtime, no live executor. Mirrors `test/lifecycle` style.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createTriggerService, type TriggerInput } from "@/jobs/trigger-service"
import { fakeCoordinator, fakeEmitter, fakeRegistry, FULL_OVERLAP, IN_PROCESS_OVERLAP } from "./fixtures"
import type { CoordinatorOptions } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

function idGen(): () => string {
  let n = 0
  return () => `occ_${n++}`
}

function baseInput(over: Partial<TriggerInput> = {}): TriggerInput {
  return {
    jobDefinitionId: "job_test_1",
    scheduleId: "sch_1",
    nominalDueTime: "2026-07-18T00:00:00.000Z",
    generation: 0,
    rootSessionId: "ses_root",
    correlationId: "corr_1",
    causationId: null,
    nominalDueMs: 1_000_000,
    observedAtMs: 1_000_250,
    overlapPolicy: "forbid",
    overlapCapabilities: IN_PROCESS_OVERLAP,
    running: false,
    runningIsMutating: false,
    ...over,
  }
}

function build(coordinatorOptions: CoordinatorOptions = {}) {
  const { emitter, emitted } = fakeEmitter()
  const { registry, store } = fakeRegistry()
  const { coordinator, calls } = fakeCoordinator(coordinatorOptions)
  const service = createTriggerService({ emitter, registry, coordinator, newOccurrenceId: idGen() })
  return { service, emitted, store, calls }
}

const types = (emitted: { eventType: string }[]): string[] => emitted.map((e) => e.eventType)

describe("T033 trigger service — canonical Feature 002 process creation (AC11, AC12)", () => {
  test("a due trigger claims, admits, and associates one canonical Task Process with Todo + OutputGroup", async () => {
    const { service, emitted, calls, store } = build()
    const out = await run(service.trigger(baseInput()))

    expect(out.outcome).toBe("admitted")
    expect(out.duplicateOf).toBeNull()
    // Occurrence-owned Feature 002 Todo + Feature 005 OutputGroup provisioned before goal-bearing work.
    expect(calls.created).toEqual(["occ_0"])
    expect(calls.todos).toEqual(["occ_0"])
    expect(calls.outputs).toEqual(["occ_0"])
    // The occurrence carries the executor-owned process/attempt, never authored here.
    expect(out.occurrence.processId).toBe("proc_occ_0")
    expect(out.occurrence.attempt).toBe(1)
    // The lifecycle is evented on the single EventV2 authority via publishJobEvent.
    expect(types(emitted)).toEqual([
      "job.trigger_due",
      "job.occurrence_claimed",
      "job.admitted",
      "job.triggered",
    ])
    // trigger_due carries schedule lag measured from the nominal due instant (FR19).
    expect(emitted[0]?.detail).toMatchObject({ schedule_lag_ms: 250 })
    expect([...store.values()]).toHaveLength(1)
    expect([...store.values()][0]?.state).toBe("admitted")
  })

  test("a rejected admission stays claimed and never fabricates an admitted process (AC12)", async () => {
    const { service, emitted, calls } = build({ admission: { admitted: false, reason: "provider saturated" } })
    const out = await run(service.trigger(baseInput()))

    expect(out.outcome).toBe("claimed")
    expect(calls.created).toEqual([]) // no process, no Todo, no OutputGroup
    expect(calls.todos).toEqual([])
    expect(types(emitted)).toEqual(["job.trigger_due", "job.occurrence_claimed"])
  })
})

describe("T033 trigger service — idempotency tuple duplicate suppression (AC6)", () => {
  test("a second delivery for the same tuple coalesces to the primary and opens no second admitted path", async () => {
    const { service, emitted, calls } = build()
    const first = await run(service.trigger(baseInput()))
    const second = await run(service.trigger(baseInput()))

    expect(first.outcome).toBe("admitted")
    expect(second.outcome).toBe("coalesced")
    expect(second.duplicateOf).toBe("occ_0")
    // Only the first delivery created a process; the duplicate never admitted.
    expect(calls.created).toEqual(["occ_0"])
    expect(emitted.filter((e) => e.eventType === "job.coalesced")).toHaveLength(1)
  })

  test("a distinct tuple (different nominal due) is a fresh primary, not a duplicate", async () => {
    const { service, calls } = build()
    await run(service.trigger(baseInput()))
    const other = await run(service.trigger(baseInput({ nominalDueTime: "2026-07-18T00:05:00.000Z" })))

    expect(other.outcome).toBe("admitted")
    expect(other.duplicateOf).toBeNull()
    expect(calls.created).toEqual(["occ_0", "occ_1"])
  })
})

describe("T033 trigger service — overlap resolution (AC5, AC25)", () => {
  test("forbid + running sibling rejects the occurrence without a process", async () => {
    const { service, emitted, calls } = build()
    const out = await run(service.trigger(baseInput({ running: true })))

    expect(out.outcome).toBe("overlap_rejected")
    expect(calls.created).toEqual([])
    expect(types(emitted)).toContain("job.overlap_rejected")
  })

  test("replace + non-mutating sibling supersedes and admits a new process", async () => {
    const { service, emitted, calls } = build()
    const out = await run(
      service.trigger(baseInput({ overlapPolicy: "replace", overlapCapabilities: FULL_OVERLAP, running: true })),
    )

    expect(out.outcome).toBe("admitted")
    expect(calls.created).toEqual(["occ_0"])
    expect(types(emitted)).toContain("job.overlap_replaced")
  })

  test("replace + MID-MUTATION sibling never kills — it queues instead of a false kill (AC25)", async () => {
    const { service, emitted, calls } = build()
    const out = await run(
      service.trigger(
        baseInput({
          overlapPolicy: "replace",
          overlapCapabilities: FULL_OVERLAP,
          running: true,
          runningIsMutating: true,
        }),
      ),
    )

    // Mutation-safe: the mid-mutation sibling is deferred (queued), never replaced/killed.
    expect(out.outcome).toBe("claimed")
    expect(calls.created).toEqual([])
    expect(types(emitted)).toContain("job.queued")
    expect(types(emitted)).not.toContain("job.overlap_replaced")
  })

  test("an unenforceable overlap capability fails before any effect (capability gap, AC22)", async () => {
    const { service, calls } = build()
    const exit = await Effect.runPromiseExit(
      service.trigger(baseInput({ overlapPolicy: "queue", overlapCapabilities: IN_PROCESS_OVERLAP, running: true })),
    )
    expect(exit._tag).toBe("Failure")
    expect(calls.created).toEqual([])
  })
})
