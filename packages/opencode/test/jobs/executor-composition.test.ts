/**
 * Feature 018 / Group A (T015) — eager executor-composition + coordinator tests.
 *
 * Exercises the composition root over injected fakes (no Bun runtime, no
 * AppRuntime, no control store):
 *   - the executor arms eagerly and idempotently, and fails open on a fault (T001, T002);
 *   - the startup reconcile sweep rehydrates enabled definitions (T003);
 *   - the cron callback hands each due signal to the fire-and-forget dispatch (T003);
 *   - the coordinator admits under the F002/F001 gates, provisions Todo + OutputGroup,
 *     and the occurrence runs headless to a terminal execution event (T004-T006);
 *   - a headless-incapable capability degrades to a typed `execution_failed`
 *     terminal — no privilege bypass, no fabricated success (T006, FR6);
 *   - bounded concurrency: a `forbid` overlap rejects a concurrent occurrence so
 *     there is no unbounded fan-out of headless sessions (T007, FR3).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  buildExecutorComposition,
  ensureExecutorComposition,
  currentExecutorComposition,
  __resetExecutorCompositionForTests,
  type DueRegistrationView,
  type ExecutorCompositionDeps,
  type OccurrenceRunner,
  type OccurrenceRunResult,
} from "@/jobs/executor-composition"
import type { BunCronHandle, BunCronRuntime, DueSignal, RegistrationView } from "@/jobs/bun-cron-adapter"
import type { Occurrence } from "@opencode-ai/protocol/jobs/commands"
import { fakeCoordinator, fakeEmitter, fakeRegistry, IN_PROCESS_OVERLAP, FULL_OVERLAP } from "./fixtures"
import type { CoordinatorOptions } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

// =============================================================================
// Fakes
// =============================================================================

/** A `Bun.cron` runtime fake: records scheduled expressions and lets a test fire the callback. */
function fakeCron() {
  const registered: { expression: string; handler: () => unknown }[] = []
  const runtime: BunCronRuntime = {
    schedule: (expression, handler): BunCronHandle => {
      registered.push({ expression, handler })
      return { cron: expression, stop: () => registered.splice(registered.findIndex((r) => r.handler === handler), 1) }
    },
    parse: () => new Date(Date.now() + 60_000),
    remove: () => Promise.resolve(),
  }
  return { runtime, registered, fireAll: () => registered.forEach((r) => r.handler()) }
}

function view(over: Partial<DueRegistrationView> = {}): DueRegistrationView {
  return {
    overlapPolicy: over.overlapPolicy ?? "forbid",
    rootSessionId: over.rootSessionId ?? "ses_root",
    generation: over.generation ?? 0,
    overlapCapabilities: over.overlapCapabilities ?? IN_PROCESS_OVERLAP,
  }
}

/** A runner recording every run and returning a fixed disposition (or awaiting a latch). */
function fakeRunner(
  result: OccurrenceRunResult = { disposition: "completed" },
  latch?: Promise<void>,
): { runner: OccurrenceRunner; ran: Occurrence[] } {
  const ran: Occurrence[] = []
  const runner: OccurrenceRunner = {
    run: (input) =>
      Effect.gen(function* () {
        ran.push(input.occurrence)
        if (latch) yield* Effect.promise(() => latch)
        return result
      }),
  }
  return { runner, ran }
}

function makeView(over: {
  id?: string
  scheduleId?: string
  enabled?: boolean
  overlap?: "allow" | "forbid" | "queue" | "replace"
} = {}): RegistrationView {
  return {
    jobDefinitionId: over.id ?? "job_test_1",
    scheduleId: over.scheduleId ?? "sch_1",
    schedule: { scheduleId: over.scheduleId ?? "sch_1", cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
    enabled: over.enabled ?? true,
    misfirePolicy: "skip",
    overlapPolicy: over.overlap ?? "forbid",
    principal: { kind: "system", id: "sys" },
  }
}

interface BuildOver {
  readonly resolveView?: DueRegistrationView | null
  readonly coordinatorOptions?: CoordinatorOptions
  readonly runner?: OccurrenceRunner
  readonly reconcileViews?: readonly RegistrationView[]
  readonly runFork?: (effect: Effect.Effect<void>) => void
  readonly newOccurrenceId?: () => string
}

function buildDeps(over: BuildOver = {}): {
  deps: ExecutorCompositionDeps
  cron: ReturnType<typeof fakeCron>
  emitted: ReturnType<typeof fakeEmitter>["emitted"]
  calls: ReturnType<typeof fakeCoordinator>["calls"]
} {
  const cron = fakeCron()
  const { emitter, emitted } = fakeEmitter()
  const { registry } = fakeRegistry()
  const { coordinator, calls } = fakeCoordinator(over.coordinatorOptions)
  const { runner } = fakeRunner()
  let n = 0
  const deps: ExecutorCompositionDeps = {
    cron: cron.runtime,
    emitter,
    registry,
    coordinator,
    runner: over.runner ?? runner,
    resolveDueContext: () => Effect.succeed(over.resolveView === undefined ? view() : over.resolveView),
    reconcileSource: over.reconcileViews ? () => Effect.succeed(over.reconcileViews!) : undefined,
    runFork: over.runFork,
    newOccurrenceId: over.newOccurrenceId ?? (() => `occ_${n++}`),
  }
  return { deps, cron, emitted, calls }
}

const types = (emitted: { eventType: string }[]): string[] => emitted.map((e) => e.eventType)

const signal = (over: Partial<DueSignal> = {}): DueSignal => ({
  jobDefinitionId: "job_test_1",
  scheduleId: "sch_1",
  cronExpression: "*/5 * * * *",
  timezone: "UTC",
  firedAtMs: 1_000_000,
  ...over,
})

// =============================================================================
// T001-T003 — arming, idempotency, fail-open, reconcile rehydration, dispatch
// =============================================================================

describe("T001-T003 eager arming + reconcile + dispatch", () => {
  afterEach(() => __resetExecutorCompositionForTests())

  test("buildExecutorComposition arms and exposes the adapter + trigger service", () => {
    const { deps } = buildDeps()
    const composition = buildExecutorComposition(deps)
    expect(composition.state).toBe("armed")
    expect(composition.adapter).not.toBeNull()
    expect(composition.triggerService).not.toBeNull()
    expect(composition.reason).toBeNull()
  })

  test("arm() runs the startup reconcile sweep and rehydrates enabled definitions (T003)", async () => {
    const { deps } = buildDeps({ reconcileViews: [makeView({ enabled: true })] })
    const composition = buildExecutorComposition(deps)
    expect(composition.adapter!.isRegistered("job_test_1", "sch_1")).toBe(false)
    await run(composition.arm())
    expect(composition.adapter!.isRegistered("job_test_1", "sch_1")).toBe(true)
  })

  test("a disabled persisted definition is not re-registered on the sweep", async () => {
    const { deps } = buildDeps({ reconcileViews: [makeView({ enabled: false })] })
    const composition = buildExecutorComposition(deps)
    await run(composition.arm())
    expect(composition.adapter!.isRegistered("job_test_1", "sch_1")).toBe(false)
  })

  test("the cron callback hands each due signal to the fire-and-forget dispatch (T003)", async () => {
    const forked: Effect.Effect<void>[] = []
    const { deps, cron } = buildDeps({
      reconcileViews: [makeView({ enabled: true })],
      runFork: (effect) => void forked.push(effect),
    })
    const composition = buildExecutorComposition(deps)
    await run(composition.arm()) // register the enabled definition's cron callback
    forked.length = 0 // ignore any arm() fork
    cron.fireAll()
    expect(forked).toHaveLength(1) // one due signal → one fire-and-forget onDue
  })

  test("ensureExecutorComposition arms once and reuses the armed instance (idempotent, T001)", async () => {
    const { deps } = buildDeps()
    // Feature 022 (ADR-0022): the accessor is async — its live deps load via a
    // dynamic import for `bun build --compile`; explicit `deps` still arm eagerly.
    const first = await ensureExecutorComposition(deps)
    const second = await ensureExecutorComposition()
    expect(first.state).toBe("armed")
    expect(second).toBe(first) // never a second cron loop
    expect(currentExecutorComposition()).toBe(first)
  })

  test("ensureExecutorComposition fails open when construction throws (T002)", async () => {
    const throwingDeps = new Proxy({} as ExecutorCompositionDeps, {
      get() {
        throw new Error("injected arming fault: bad definition")
      },
    })
    const composition = await ensureExecutorComposition(throwingDeps)
    expect(composition.state).toBe("disarmed")
    expect(composition.adapter).toBeNull()
    expect(composition.reason).toContain("injected arming fault")
    // A second call reuses the disarmed instance — never a crash, never a retry loop.
    expect(await ensureExecutorComposition()).toBe(composition)
  })
})

// =============================================================================
// T004-T006 — coordinator admit → provision → run → terminal + permission honesty
// =============================================================================

describe("T004-T006 coordinator admit → provision → run → terminal", () => {
  afterEach(() => __resetExecutorCompositionForTests())

  test("an admitted occurrence provisions Todo + OutputGroup, runs headless, emits terminal (T004-T006)", async () => {
    const { runner, ran } = fakeRunner({ disposition: "completed" })
    const { deps, emitted, calls } = buildDeps({ runner })
    const composition = buildExecutorComposition(deps)
    await run(composition.onDue(signal()))

    // Feature 002 Task Process created + occurrence-owned Todo + OutputGroup provisioned.
    expect(calls.created).toEqual(["occ_0"])
    expect(calls.todos).toEqual(["occ_0"])
    expect(calls.outputs).toEqual(["occ_0"])
    // The occurrence ran headless and reached a terminal execution event.
    expect(ran.map((o) => o.occurrenceId)).toEqual(["occ_0"])
    expect(types(emitted)).toEqual([
      "job.trigger_due",
      "job.occurrence_claimed",
      "job.admitted",
      "job.triggered",
      "job.execution_started",
      "job.execution_completed",
    ])
    expect(composition.activeOccurrences()).toBe(0) // released after terminal
  })

  test("a denied admission never provisions, never runs, never emits a terminal (FR4)", async () => {
    const { runner, ran } = fakeRunner()
    const { deps, emitted, calls } = buildDeps({
      runner,
      coordinatorOptions: { admission: { admitted: false, reason: "provider saturated" } },
    })
    const composition = buildExecutorComposition(deps)
    await run(composition.onDue(signal()))

    expect(calls.created).toEqual([])
    expect(ran).toEqual([])
    expect(types(emitted)).toEqual(["job.trigger_due", "job.occurrence_claimed"])
  })

  test("a headless-incapable capability degrades to a typed execution_failed terminal (FR6)", async () => {
    const { runner } = fakeRunner({ disposition: "headless_incapable", reason: "interactive permission prompt" })
    const { deps, emitted } = buildDeps({ runner })
    const composition = buildExecutorComposition(deps)
    await run(composition.onDue(signal()))

    const terminal = emitted.find((e) => e.eventType.startsWith("job.execution_") && e.eventType !== "job.execution_started")
    expect(terminal?.eventType).toBe("job.execution_failed") // honest failure, not a fabricated success
    expect(terminal?.detail).toMatchObject({ disposition: "headless_incapable" })
  })

  test("a runner fault degrades to a bounded execution_failed terminal, never a leaked stack (FR13)", async () => {
    const runner: OccurrenceRunner = { run: () => Effect.fail({ type: "unavailable", reason: "seam down" }) }
    const { deps, emitted } = buildDeps({ runner })
    const composition = buildExecutorComposition(deps)
    await run(composition.onDue(signal()))

    const terminal = emitted.find((e) => e.eventType === "job.execution_failed")
    expect(terminal).toBeDefined()
    expect(terminal?.detail).toMatchObject({ reason: "executor_unavailable" })
    expect(composition.activeOccurrences()).toBe(0)
  })

  test("a due signal with no persisted registration is dropped honestly (no claim)", async () => {
    const { deps, emitted, calls } = buildDeps({ resolveView: null })
    const composition = buildExecutorComposition(deps)
    await run(composition.onDue(signal()))
    expect(emitted).toEqual([])
    expect(calls.created).toEqual([])
  })
})

// =============================================================================
// T007 — bounded concurrency (overlap policy honored, no unbounded fan-out)
// =============================================================================

describe("T007 bounded concurrency over the overlap policy", () => {
  afterEach(() => __resetExecutorCompositionForTests())

  test("a forbid overlap rejects a concurrent occurrence while one runs headless (FR3)", async () => {
    let release!: () => void
    const latch = new Promise<void>((resolve) => (release = resolve))
    const { runner, ran } = fakeRunner({ disposition: "completed" }, latch)
    let n = 0
    const { deps, emitted, calls } = buildDeps({
      runner,
      resolveView: view({ overlapPolicy: "forbid" }),
      newOccurrenceId: () => `occ_${n++}`,
    })
    const composition = buildExecutorComposition(deps)

    // First occurrence admits and begins running headless (blocked on the latch).
    const first = Effect.runPromise(composition.onDue(signal()))
    await new Promise((r) => setTimeout(r, 5))
    expect(composition.activeOccurrences()).toBe(1)

    // Second concurrent due sees the sibling running → forbid → overlap_rejected, no second run.
    await run(composition.onDue(signal({ firedAtMs: 2_000_000 })))
    expect(types(emitted)).toContain("job.overlap_rejected")
    expect(ran).toHaveLength(1) // never an unbounded fan-out
    expect(calls.created).toEqual(["occ_0"]) // only the first admitted a process

    release()
    await first
    expect(composition.activeOccurrences()).toBe(0)
  })

  test("a replace overlap with a non-mutating sibling admits a fresh process (FR3)", async () => {
    const { runner } = fakeRunner()
    let n = 0
    const { deps, emitted } = buildDeps({
      runner,
      coordinatorOptions: {},
      resolveView: view({ overlapPolicy: "replace", overlapCapabilities: FULL_OVERLAP }),
      newOccurrenceId: () => `occ_${n++}`,
    })
    const composition = buildExecutorComposition(deps)
    await run(composition.onDue(signal()))
    // First run releases synchronously (no latch), so the second admits fresh.
    await run(composition.onDue(signal({ firedAtMs: 2_000_000 })))
    expect(types(emitted).filter((t) => t === "job.execution_completed")).toHaveLength(2)
  })
})

// =============================================================================
// T008-T009 — run-now enqueueImmediate through the SAME composition
// =============================================================================

describe("T008-T009 run-now enqueueImmediate", () => {
  afterEach(() => __resetExecutorCompositionForTests())

  const enqInput = (over: Partial<Parameters<ReturnType<typeof buildExecutorComposition>["enqueueImmediate"]>[0]> = {}) => ({
    jobDefinitionId: "job_test_1",
    scheduleId: "sch_1",
    overlapPolicy: "forbid" as const,
    overlapCapabilities: IN_PROCESS_OVERLAP,
    rootSessionId: "job_test_1",
    generation: 0,
    ...over,
  })

  test("enqueues one immediate occurrence, provisions + runs headless, emits terminal (T008)", async () => {
    const { runner, ran } = fakeRunner({ disposition: "completed" })
    const { deps, emitted, calls } = buildDeps({
      runner,
      runFork: (effect) => void Effect.runPromise(effect),
      newOccurrenceId: () => "occ_now",
    })
    const composition = buildExecutorComposition(deps)
    const result = await composition.enqueueImmediate(enqInput())
    expect(result.outcome).toBe("enqueued")
    if (result.outcome === "enqueued") expect(result.occurrenceId).toBe("occ_now")
    await new Promise((r) => setTimeout(r, 10))
    expect(calls.created).toEqual(["occ_now"])
    expect(ran.map((o) => o.occurrenceId)).toEqual(["occ_now"])
    expect(types(emitted)).toContain("job.execution_completed")
    expect(composition.activeOccurrences()).toBe(0)
  })

  test("every occurrence event roots on the definition (definition-keyed aggregate, T010)", async () => {
    const { deps, emitted } = buildDeps({
      runFork: (effect) => void Effect.runPromise(effect),
      newOccurrenceId: () => "occ_k",
    })
    const composition = buildExecutorComposition(deps)
    await composition.enqueueImmediate(enqInput({ rootSessionId: "job_test_1" }))
    await new Promise((r) => setTimeout(r, 10))
    // The durable aggregate is derived from tree.root_session_id, so every emitted
    // event roots on the jobDefinitionId → the projection reads by definition (Group C).
    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted.every((e) => e.envelope.rootSessionId === "job_test_1")).toBe(true)
  })

  test("a forbid overlap with an in-flight sibling → overlap_rejected, no second run (T009)", async () => {
    let release!: () => void
    const latch = new Promise<void>((resolve) => (release = resolve))
    const { runner, ran } = fakeRunner({ disposition: "completed" }, latch)
    let n = 0
    const { deps } = buildDeps({
      runner,
      runFork: (effect) => void Effect.runPromise(effect),
      newOccurrenceId: () => `occ_${n++}`,
    })
    const composition = buildExecutorComposition(deps)

    const first = await composition.enqueueImmediate(enqInput())
    expect(first.outcome).toBe("enqueued")
    expect(composition.activeOccurrences()).toBe(1) // bounded in-flight

    const second = await composition.enqueueImmediate(enqInput())
    expect(second.outcome).toBe("overlap_rejected")
    expect(ran).toHaveLength(1) // never an unbounded fan-out

    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(composition.activeOccurrences()).toBe(0)
  })

  test("a disarmed executor → executor_unavailable, never a fabricated occurrence (T009)", async () => {
    const throwingDeps = new Proxy({} as ExecutorCompositionDeps, {
      get() {
        throw new Error("injected arming fault")
      },
    })
    const composition = await ensureExecutorComposition(throwingDeps)
    expect(composition.state).toBe("disarmed")
    const result = await composition.enqueueImmediate(enqInput())
    expect(result.outcome).toBe("executor_unavailable")
  })
})
