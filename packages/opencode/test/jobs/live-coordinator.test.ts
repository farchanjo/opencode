/**
 * Feature 018 / Group A (T015) — live `TaskProcessCoordinator` tests (adversarial-fix round).
 *
 * Drives the REAL `createLiveCoordinator` / `createLiveRunner` (executor-composition-live.ts)
 * through the composition over injected fakes — a real `AdmissionController` gate, a
 * counting `ScheduledSessionSeam`, and the headless-capability probe — so the two
 * honesty invariants the adversarial review flagged are proven end to end:
 *
 *   1. `admit` runs a REAL Feature 002 admission gate: a denial (a zero-capacity
 *      session ceiling) yields a typed `admitted:false`, so the occurrence never
 *      provisions, never creates a session, and never emits a terminal (no phantom).
 *   2. an admitted-but-headless-incapable occurrence persists NO session — the
 *      capability probe gates `createProcess` BEFORE `Session.Service.create`, so a
 *      per-minute cron never grows dead scheduled-job sessions. When the probe flips
 *      to `capable`, the real session IS persisted before goal-bearing work.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AdmissionController } from "@opencode-ai/core/lifecycle/admission/admission-controller"
import {
  buildExecutorComposition,
  __resetExecutorCompositionForTests,
  type DueRegistrationView,
  type ExecutorCompositionDeps,
} from "@/jobs/executor-composition"
import {
  createLiveCoordinator,
  createLiveRunner,
  type HeadlessCapability,
  type ScheduledSessionSeam,
} from "@/jobs/executor-composition-live"
import type { BunCronHandle, BunCronRuntime, DueSignal } from "@/jobs/bun-cron-adapter"
import { fakeEmitter, fakeRegistry, IN_PROCESS_OVERLAP } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

function fakeCron(): BunCronRuntime {
  return {
    schedule: (expression): BunCronHandle => ({ cron: expression, stop: () => {} }),
    parse: () => new Date(Date.now() + 60_000),
    remove: () => Promise.resolve(),
  }
}

/** A counting scheduled-session seam so a test can assert how many sessions were persisted. */
function countingSession(): { seam: ScheduledSessionSeam; created: string[] } {
  const created: string[] = []
  const seam: ScheduledSessionSeam = {
    create: async (input) => {
      created.push(input.jobDefinitionId)
      return { id: `ses_${created.length}` }
    },
  }
  return { seam, created }
}

const CAPABLE: () => HeadlessCapability = () => ({ capable: true, reason: "" })

const signal = (over: Partial<DueSignal> = {}): DueSignal => ({
  jobDefinitionId: "job_live_1",
  scheduleId: "sch_1",
  cronExpression: "*/5 * * * *",
  timezone: "UTC",
  firedAtMs: 1_000_000,
  ...over,
})

const view: DueRegistrationView = {
  overlapPolicy: "forbid",
  rootSessionId: "job_live_1",
  generation: 0,
  overlapCapabilities: IN_PROCESS_OVERLAP,
}

interface Wire {
  readonly session: ReturnType<typeof countingSession>
  readonly emitted: ReturnType<typeof fakeEmitter>["emitted"]
  readonly composition: ReturnType<typeof buildExecutorComposition>
}

function wire(opts: {
  admission?: AdmissionController.AdmissionController
  capability?: () => HeadlessCapability
} = {}): Wire {
  const session = countingSession()
  const { emitter, emitted } = fakeEmitter()
  const { registry } = fakeRegistry()
  const coordinator = createLiveCoordinator({
    admission: opts.admission,
    session: session.seam,
    capability: opts.capability,
  })
  const runner = createLiveRunner({ capability: opts.capability })
  const deps: ExecutorCompositionDeps = {
    cron: fakeCron(),
    emitter,
    registry,
    coordinator,
    runner,
    resolveDueContext: () => Effect.succeed(view),
    runFork: (effect) => void Effect.runPromise(effect),
    newOccurrenceId: () => "occ_live",
  }
  return { session, emitted, composition: buildExecutorComposition(deps) }
}

const types = (emitted: { eventType: string }[]): string[] => emitted.map((e) => e.eventType)

describe("live coordinator — real admission gate (finding #1)", () => {
  afterEach(() => __resetExecutorCompositionForTests())

  test("a denied admission (zero session ceiling) creates no session and emits no terminal", async () => {
    // A REAL AdmissionController with a zero session ceiling → every request is rejected.
    const denyAll = AdmissionController.createAdmissionController({ ceilings: { session: 0 } })
    const { session, emitted, composition } = wire({ admission: denyAll })

    await run(composition.onDue(signal()))

    // Honest denial: no session persisted, no process, no admitted/triggered/terminal.
    expect(session.created).toEqual([])
    expect(types(emitted)).toEqual(["job.trigger_due", "job.occurrence_claimed"])
    expect(composition.activeOccurrences()).toBe(0)
  })

  test("admit reports the typed denial reason, never a fabricated `admitted`", async () => {
    const denyAll = AdmissionController.createAdmissionController({ ceilings: { session: 0 } })
    const coordinator = createLiveCoordinator({ admission: denyAll })
    const outcome = await run(
      coordinator.admit({
        jobDefinitionId: "job_live_1" as never,
        occurrenceId: "occ_live" as never,
        rootSessionId: "job_live_1" as never,
      }),
    )
    expect(outcome.admitted).toBe(false)
    if (!outcome.admitted) expect(outcome.reason).toContain("admission rejected")
  })

  test("a granted admission proceeds (default ceiling admits the first occurrence)", async () => {
    const outcome = await run(
      createLiveCoordinator().admit({
        jobDefinitionId: "job_live_1" as never,
        occurrenceId: "occ_live" as never,
        rootSessionId: "job_live_1" as never,
      }),
    )
    expect(outcome.admitted).toBe(true)
  })
})

describe("live coordinator — no session leak on headless-incapable (finding #2)", () => {
  afterEach(() => __resetExecutorCompositionForTests())

  test("an admitted-but-incapable occurrence persists NO session and fails headless_incapable", async () => {
    // Default admission grants; default capability is incapable (no goal-bearing driver).
    const { session, emitted, composition } = wire()

    await run(composition.onDue(signal()))

    // The session-leak fix: no persisted session for a run that cannot do goal-bearing work.
    expect(session.created).toEqual([])
    const terminal = emitted.find((e) => e.eventType === "job.execution_failed")
    expect(terminal).toBeDefined()
    expect(terminal?.detail).toMatchObject({ disposition: "headless_incapable" })
    expect(composition.activeOccurrences()).toBe(0)
  })

  test("run-now: an incapable occurrence enqueues but persists NO session", async () => {
    const { session, composition } = wire()
    const result = await composition.enqueueImmediate({
      jobDefinitionId: "job_live_1",
      scheduleId: "sch_1",
      overlapPolicy: "forbid",
      overlapCapabilities: IN_PROCESS_OVERLAP,
      rootSessionId: "job_live_1",
      generation: 0,
    })
    expect(result.outcome).toBe("enqueued")
    await new Promise((r) => setTimeout(r, 10))
    expect(session.created).toEqual([]) // no dead scheduled-job session persisted
  })

  test("a capable occurrence DOES persist the real session before goal-bearing work", async () => {
    // The gate actually gates: when the probe reports capable, createProcess persists.
    const { session, emitted, composition } = wire({ capability: CAPABLE })

    await run(composition.onDue(signal()))

    expect(session.created).toEqual(["job_live_1"]) // exactly one real session persisted
    expect(types(emitted)).toContain("job.execution_completed")
  })
})
