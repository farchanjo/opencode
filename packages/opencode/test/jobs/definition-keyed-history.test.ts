/**
 * Feature 018 / Group C (T010, T011) — definition-keyed occurrence-history round-trip.
 *
 * The executor emits `job.*` occurrence events whose durable aggregate is derived
 * from `tree.root_session_id`; a scheduled occurrence roots on its definition
 * (`root_session_id = jobDefinitionId`), so the Feature 017 occurrence projection —
 * which reads the durable page by `jobDefinitionId` — returns REAL executions
 * instead of an honest-empty list.
 *
 * This test wires the composition's emitter to an in-memory durable store keyed the
 * way `EventV2Bridge` keys durable job events (by `tree.root_session_id`), runs an
 * immediate occurrence, and asserts the REAL `createJobOccurrenceProjection` history
 * resolves it by definition.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { buildExecutorComposition, type ExecutorCompositionDeps, type OccurrenceRunner } from "@/jobs/executor-composition"
import type { BunCronHandle, BunCronRuntime } from "@/jobs/bun-cron-adapter"
import type { JobEmitInput, JobEventEmitter } from "@/jobs/trigger-service"
import {
  createJobOccurrenceProjection,
  type DurablePage,
  type JobOccurrenceSource,
  type RawDurableEvent,
} from "@/operator/jobs/occurrence-projection"
import { fakeCoordinator, fakeRegistry } from "./fixtures"
import { Stream } from "effect"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

function fakeCron(): BunCronRuntime {
  return {
    schedule: (expression): BunCronHandle => ({ cron: expression, stop: () => {} }),
    parse: () => new Date(Date.now() + 60_000),
    remove: () => Promise.resolve(),
  }
}

/**
 * An in-memory durable store: the emitter writes one `job.*` durable row per emit,
 * aggregated by `tree.root_session_id` (exactly how `EventV2Bridge` keys durable
 * job events). `readAggregate` returns the rows whose aggregate matches the read key.
 */
function durableStore(): { emitter: JobEventEmitter; source: JobOccurrenceSource } {
  const rows: (RawDurableEvent & { aggregate: string })[] = []
  let seq = 0

  const emitter: JobEventEmitter = {
    emit: (input: JobEmitInput) =>
      Effect.sync(() => {
        const env = input.envelope
        const eventId = `evt_job_${seq}_${env.occurrenceId}`
        const aggregate = String(env.rootSessionId)
        rows.push({
          aggregate,
          id: eventId,
          type: input.eventType,
          durable: { seq },
          data: {
            envelope: {
              event_id: eventId,
              occurrence: {
                job_definition_id: env.jobDefinitionId,
                schedule_id: env.scheduleId,
                occurrence_id: env.occurrenceId,
                process_id: env.processId,
                attempt: env.attempt ?? 1,
                generation: env.generation,
              },
              tree: { root_session_id: env.rootSessionId, session_id: env.sessionId },
              ordering: { sequence: seq, correlation_id: env.correlationId, causation_id: env.causationId },
              delivery: { timestamp: Date.now() },
            },
            // The bounded terminal detail (e.g. `reason`) rides the durable row exactly
            // as the live emitter maps it, so the projection can surface WHY (FR11).
            ...(typeof input.detail.reason === "string" ? { detail: { reason: input.detail.reason } } : {}),
          },
        })
        seq++
        return { eventId }
      }),
  }

  const source: JobOccurrenceSource = {
    readAggregate: ({ aggregateID, after, limit }) =>
      Effect.sync((): DurablePage => {
        const matching = rows.filter((r) => r.aggregate === aggregateID && r.durable!.seq > (after ?? -1))
        const page = matching.slice(0, limit)
        return {
          events: page.map(({ aggregate: _a, ...ev }) => ev),
          hasMore: matching.length > page.length,
          lastSeq: page.length > 0 ? page[page.length - 1]!.durable!.seq : after ?? -1,
        }
      }),
    subscribe: () => Effect.succeed(Stream.empty),
  }

  return { emitter, source }
}

const completedRunner: OccurrenceRunner = { run: () => Effect.succeed({ disposition: "completed" }) }

describe("T010-T011 definition-keyed occurrence history round-trip", () => {
  test("executor emits under the jobDefinitionId aggregate → jobs.history returns it", async () => {
    const { emitter, source } = durableStore()
    const { registry } = fakeRegistry()
    const { coordinator } = fakeCoordinator()
    const deps: ExecutorCompositionDeps = {
      cron: fakeCron(),
      emitter,
      registry,
      coordinator,
      runner: completedRunner,
      resolveDueContext: () => Effect.succeed(null),
      runFork: (effect) => void Effect.runPromise(effect),
      newOccurrenceId: () => "occ_hist_1",
    }
    const composition = buildExecutorComposition(deps)

    // Run an immediate occurrence rooted on the definition (definition-keyed aggregate).
    const enqueued = await composition.enqueueImmediate({
      jobDefinitionId: "job_hist_1",
      scheduleId: "sch_1",
      overlapPolicy: "forbid",
      overlapCapabilities: { allow: true, queue: false, replace: false },
      rootSessionId: "job_hist_1",
      generation: 0,
    })
    expect(enqueued.outcome).toBe("enqueued")
    await new Promise((r) => setTimeout(r, 10)) // let the headless run + terminal emit

    // The REAL Feature 017 occurrence projection reads the durable page by definition.
    const projection = createJobOccurrenceProjection(source)
    const history = await run(projection.history({ jobDefinitionId: "job_hist_1", limit: 50 }))

    expect(history.occurrences.length).toBe(1)
    const occ = history.occurrences[0]!
    expect(occ.occurrenceId).toBe("occ_hist_1")
    expect(occ.jobDefinitionId).toBe("job_hist_1")
    expect(occ.state).toBe("completed") // real terminal execution, not honest-empty

    // A different definition's aggregate holds nothing (defence in depth).
    const other = await run(projection.history({ jobDefinitionId: "job_other", limit: 50 }))
    expect(other.occurrences).toEqual([])
  })

  test("a failed occurrence surfaces its terminal reason in history (FR11)", async () => {
    const { emitter, source } = durableStore()
    const { registry } = fakeRegistry()
    const { coordinator } = fakeCoordinator()
    // A headless-incapable terminal carries `detail.reason` — history must surface WHY.
    const incapableRunner: OccurrenceRunner = {
      run: () => Effect.succeed({ disposition: "headless_incapable", reason: "no interactive permission surface" }),
    }
    const deps: ExecutorCompositionDeps = {
      cron: fakeCron(),
      emitter,
      registry,
      coordinator,
      runner: incapableRunner,
      resolveDueContext: () => Effect.succeed(null),
      runFork: (effect) => void Effect.runPromise(effect),
      newOccurrenceId: () => "occ_fail_1",
    }
    const composition = buildExecutorComposition(deps)
    await composition.enqueueImmediate({
      jobDefinitionId: "job_fail_1",
      scheduleId: "sch_1",
      overlapPolicy: "forbid",
      overlapCapabilities: { allow: true, queue: false, replace: false },
      rootSessionId: "job_fail_1",
      generation: 0,
    })
    await new Promise((r) => setTimeout(r, 10))

    const projection = createJobOccurrenceProjection(source)
    const history = await run(projection.history({ jobDefinitionId: "job_fail_1", limit: 50 }))
    expect(history.occurrences.length).toBe(1)
    const occ = history.occurrences[0]!
    expect(occ.state).toBe("failed")
    expect(occ.reason).toBe("no interactive permission surface") // the WHY is no longer swallowed
  })
})
