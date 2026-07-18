/**
 * Feature 003 / T034 — the C20 fault-injection matrix (spec Clarification C20).
 *
 * Exercises the fault rows bound to their acceptance hooks over the in-process
 * Bun.cron adapter (T021), the Config.Service persistence double (T022), the
 * trigger service (T023), and the notification service (T024):
 *   - AC1  cron trigger without a polling loop
 *   - AC22 unsupported adapter capability fails before registration
 *   - AC2/AC23 restart rehydration + partial-registration reconciliation
 *   - AC23 Config.Service outage surfaced without a false success
 *   - AC24 long-running in-process handler → misfire, never a second invocation
 *   - AC25 unregister/cancel is never a false kill of mutating work
 *   - AC12/AC21 admission saturation + notification storm stay bounded
 * No Bun runtime, database, or live scheduler — every seam is injected.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { Overlap } from "@opencode-ai/core/jobs/overlap"
import {
  createBunCronAdapter,
  type BunCronHandle,
  type BunCronRuntime,
  type DueSignal,
  type RegistrationView,
} from "@/jobs/bun-cron-adapter"
import { createJobPersistence } from "@/jobs/persistence"
import { createTriggerService } from "@/jobs/trigger-service"
import { createNotificationService } from "@/jobs/notification-service"
import type { ConfigPort } from "@/operator/application/ports"
import type { NotificationTargetPrincipal, OperatorPrincipal, Schedule } from "@opencode-ai/protocol/jobs/commands"
import { fakeCoordinator, fakeEmitter, fakePublisher, fakeRegistry, IN_PROCESS_OVERLAP, makeJobDefinition } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

const OPERATOR: OperatorPrincipal = { kind: "operator", id: "op_1" }

interface FakeCron {
  readonly runtime: BunCronRuntime
  readonly handlers: Array<{ expr: string; handler: () => unknown; stopped: boolean }>
}

/** A Bun.cron runtime double: records registered handlers, optionally throws for a chosen expression. */
function fakeCron(failFor?: (expr: string) => boolean): FakeCron {
  const handlers: FakeCron["handlers"] = []
  const runtime: BunCronRuntime = {
    schedule: (expression, handler) => {
      if (failFor?.(expression)) throw new Error("bun cron rejected the expression")
      const entry = { expr: expression, handler, stopped: false }
      handlers.push(entry)
      return { cron: expression, stop: () => void (entry.stopped = true) } satisfies BunCronHandle
    },
    parse: (_expression, relativeDate) => new Date((relativeDate ?? 0) + 300_000),
    remove: async () => {},
  }
  return { runtime, handlers }
}

const schedule = (cronExpression = "*/5 * * * *", ianaTimezone = "UTC"): Schedule => ({
  scheduleId: "sch_1",
  cronExpression,
  ianaTimezone,
})

describe("T034 fault matrix — cron trigger without polling (AC1)", () => {
  test("a due fire invokes the injected dispatch seam with a bounded DueSignal, no polling loop", async () => {
    const cron = fakeCron()
    const dispatched: DueSignal[] = []
    const adapter = createBunCronAdapter({ cron: cron.runtime, dispatch: (s) => dispatched.push(s), clock: () => 0 })

    const out = await run(
      adapter.register({ jobDefinitionId: "job_1", schedule: schedule(), misfirePolicy: "skip", overlapPolicy: "forbid", principal: OPERATOR }),
    )
    expect(out.registrationState).toBe("registered")
    expect(out.nextDueAt).not.toBeNull()
    expect(adapter.isRegistered("job_1", "sch_1")).toBe(true)

    // Simulate the Bun cron callback firing: it only builds a signal and delegates.
    cron.handlers[0]?.handler()
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({ jobDefinitionId: "job_1", scheduleId: "sch_1" })
  })

  test("cron fan-out registers N schedules and each fire dispatches exactly once (AC21)", async () => {
    const cron = fakeCron()
    const dispatched: DueSignal[] = []
    const adapter = createBunCronAdapter({ cron: cron.runtime, dispatch: (s) => dispatched.push(s), clock: () => 0 })
    for (let i = 0; i < 5; i++) {
      await run(
        adapter.register({
          jobDefinitionId: `job_${i}`,
          schedule: { scheduleId: `sch_${i}`, cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
          misfirePolicy: "skip",
          overlapPolicy: "forbid",
          principal: OPERATOR,
        }),
      )
    }
    expect(adapter.activeCount()).toBe(5)
    for (const h of cron.handlers) h.handler()
    expect(dispatched).toHaveLength(5)
  })
})

describe("T034 fault matrix — unsupported capability fails before registration (AC22)", () => {
  test("a non-UTC timezone is a typed capability gap, never a silent mis-schedule", async () => {
    const cron = fakeCron()
    const adapter = createBunCronAdapter({ cron: cron.runtime, dispatch: () => {} })
    const result = await exit(
      adapter.register({ jobDefinitionId: "job_1", schedule: schedule("*/5 * * * *", "America/Sao_Paulo"), misfirePolicy: "skip", overlapPolicy: "forbid", principal: OPERATOR }),
    )
    expect(result._tag).toBe("Failure")
    expect(cron.handlers).toHaveLength(0) // no external registration happened
  })

  test("an unenforceable overlap policy (queue in-process) fails before registration", async () => {
    const cron = fakeCron()
    const adapter = createBunCronAdapter({ cron: cron.runtime, dispatch: () => {} })
    const result = await exit(
      adapter.register({ jobDefinitionId: "job_1", schedule: schedule(), misfirePolicy: "skip", overlapPolicy: "queue", principal: OPERATOR }),
    )
    expect(result._tag).toBe("Failure")
    expect(cron.handlers).toHaveLength(0)
  })

  test("a structurally invalid cron expression fails validation, never a thrown runtime error", async () => {
    const cron = fakeCron()
    const adapter = createBunCronAdapter({ cron: cron.runtime, dispatch: () => {} })
    const result = await exit(
      adapter.register({ jobDefinitionId: "job_1", schedule: schedule("not a cron"), misfirePolicy: "skip", overlapPolicy: "forbid", principal: OPERATOR }),
    )
    expect(result._tag).toBe("Failure")
  })
})

describe("T034 fault matrix — restart rehydration + partial-registration reconciliation (AC2, AC23)", () => {
  const view = (over: Partial<RegistrationView>): RegistrationView => ({
    jobDefinitionId: "job_ok",
    scheduleId: "sch_ok",
    schedule: schedule(),
    enabled: true,
    misfirePolicy: "skip",
    overlapPolicy: "forbid",
    principal: OPERATOR,
    ...over,
  })

  test("startup reconcile re-registers enabled definitions and compensates disabled ones", async () => {
    const cron = fakeCron()
    const views = [
      view({ jobDefinitionId: "job_ok", scheduleId: "sch_ok", enabled: true }),
      view({ jobDefinitionId: "job_off", scheduleId: "sch_off", enabled: false }),
    ]
    const adapter = createBunCronAdapter({
      cron: cron.runtime,
      dispatch: () => {},
      reconcileSource: () => Effect.succeed(views),
    })
    const out = await run(adapter.reconcile({ scope: "startup", jobDefinitionId: null }))
    expect(out.registeredCount).toBe(1)
    expect(out.reconciledCount).toBe(2)
    expect(out.unknownCount).toBe(0)
  })

  test("a partial registration failure reconciles to unknown, never a false cross-system commit", async () => {
    const cron = fakeCron((expr) => expr.includes("*/7"))
    const views = [
      view({ jobDefinitionId: "job_ok", scheduleId: "sch_ok", schedule: schedule("*/5 * * * *") }),
      view({ jobDefinitionId: "job_bad", scheduleId: "sch_bad", schedule: schedule("*/7 * * * *") }),
    ]
    const adapter = createBunCronAdapter({
      cron: cron.runtime,
      dispatch: () => {},
      reconcileSource: () => Effect.succeed(views),
    })
    const out = await run(adapter.reconcile({ scope: "startup", jobDefinitionId: null }))
    expect(out.registeredCount).toBe(1)
    expect(out.unknownCount).toBe(1)
  })
})

describe("T034 fault matrix — Config.Service outage without a false success (AC23)", () => {
  test("a persistence write against an unavailable Config.Service fails typed, never a fake commit", async () => {
    const brokenConfig: ConfigPort = {
      get: async () => null,
      compareAndSet: async () => ({ ok: false, code: "unavailable", reason: "config store offline" }),
      snapshot: async () => null,
      listSnapshots: async () => [],
      pruneSnapshots: async () => 0,
      restoreSnapshot: async () => ({ ok: false, code: "unavailable", reason: "offline" }),
    }
    const persistence = createJobPersistence({ config: brokenConfig, clock: () => 0 })
    const result = await exit(persistence.saveDefinition(makeJobDefinition(), null))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("unavailable")
  })
})

describe("T034 fault matrix — no false kill on unregister (AC25)", () => {
  test("unregister stops future fires idempotently and never claims a remote kill", async () => {
    const cron = fakeCron()
    const adapter = createBunCronAdapter({ cron: cron.runtime, dispatch: () => {}, clock: () => 0 })
    await run(adapter.register({ jobDefinitionId: "job_1", schedule: schedule(), misfirePolicy: "skip", overlapPolicy: "forbid", principal: OPERATOR }))
    const first = await run(adapter.unregister({ jobDefinitionId: "job_1", scheduleId: "sch_1", principal: OPERATOR }))
    expect(first.registrationState).toBe("unregistered")
    expect(cron.handlers[0]?.stopped).toBe(true)
    // Idempotent: a second unregister on an absent key is still an honest "unregistered".
    const second = await run(adapter.unregister({ jobDefinitionId: "job_1", scheduleId: "sch_1", principal: OPERATOR }))
    expect(second.registrationState).toBe("unregistered")
    expect(adapter.activeCount()).toBe(0)
  })
})

describe("T034 fault matrix — long-running in-process handler misfire (AC24)", () => {
  test("a forbid handler still pending at the next nominal due yields an explicit misfire, never overlap", () => {
    expect(Overlap.resolveLongHandler("forbid", true)).toBe("misfired")
    // A concurrency-permitting policy defers to normal overlap evaluation instead.
    expect(Overlap.resolveLongHandler("allow", true)).toBeNull()
  })
})

describe("T034 fault matrix — admission saturation stays bounded (AC12)", () => {
  test("many triggers under a saturated admission gate stay claimed with no process fan-out", async () => {
    const { emitter } = fakeEmitter()
    const { registry } = fakeRegistry()
    const { coordinator, calls } = fakeCoordinator({ admission: { admitted: false, reason: "saturated" } })
    let n = 0
    const service = createTriggerService({ emitter, registry, coordinator, newOccurrenceId: () => `occ_${n++}` })
    for (let i = 0; i < 6; i++) {
      const out = await run(
        service.trigger({
          jobDefinitionId: "job_1",
          scheduleId: "sch_1",
          nominalDueTime: `2026-07-18T00:0${i}:00.000Z`,
          generation: 0,
          rootSessionId: "ses_root",
          correlationId: "corr_1",
          causationId: null,
          nominalDueMs: 0,
          observedAtMs: 100,
          overlapPolicy: "forbid",
          overlapCapabilities: IN_PROCESS_OVERLAP,
          running: false,
          runningIsMutating: false,
        }),
      )
      expect(out.outcome).toBe("claimed")
    }
    expect(calls.created).toHaveLength(0) // saturation never fans out into processes
  })
})

describe("T034 fault matrix — notification storm stays bounded (AC8, AC21)", () => {
  test("a bounded per-scope queue expires the oldest under a storm and never grows unbounded", async () => {
    const { publisher, published } = fakePublisher()
    let n = 0
    const service = createNotificationService({
      publisher,
      subscribe: Effect.succeed(Stream.empty),
      clock: () => 0,
      newNotificationId: () => `ntf_${n++}`,
      queueCapacity: 2,
    })
    const target: NotificationTargetPrincipal = { kind: "main-context", rootSessionId: "ses_root" }
    for (let i = 0; i < 6; i++) {
      await run(
        service.enqueue({ occurrenceId: `occ_${i}`, jobDefinitionId: "job_1", type: "occurrence_completed", target, summary: "s", outputRef: null, ttlSeconds: 60 }),
      )
    }
    const expired = published.filter((p) => p.eventType === "job.notification_expired")
    // Six enqueues into a capacity-2 queue force at least four coalesce-then-expire events.
    expect(expired.length).toBeGreaterThanOrEqual(4)
  })
})
