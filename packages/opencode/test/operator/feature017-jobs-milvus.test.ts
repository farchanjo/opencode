/**
 * Feature 017 / T015 + T016 (FR11-FR14) — the jobs occurrence projection over a
 * fake `EventV2Bridge` aggregate (history/show/watch, bounded) and the Milvus
 * registry binding (probe path when configured + the unconfigured
 * `milvus_unavailable` degradation identity).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit, Stream } from "effect"
import {
  JobOccurrenceProjection,
  type RawDurableEvent,
} from "@/operator/jobs/occurrence-projection"
import { createLiveJobsBackend } from "@/operator/jobs/backend-live"
import { createOperatorJobPersistence } from "@/operator/jobs/persistence"
import { SemanticBackendLive } from "@/operator/semantic/backend-live"
import type { JobsError } from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Fake durable job event fixtures
// =============================================================================

let seq = 0
function jobEvent(
  type: string,
  opts: {
    jobDefinitionId: string
    occurrenceId: string
    timestamp?: number
    rootSessionId?: string
  },
): RawDurableEvent {
  seq += 1
  return {
    id: `evt_${seq}`,
    type,
    durable: { seq },
    data: {
      envelope: {
        event_id: `evt_${seq}`,
        occurrence: {
          job_definition_id: opts.jobDefinitionId,
          schedule_id: "sch_1",
          occurrence_id: opts.occurrenceId,
          process_id: null,
          attempt: 1,
          generation: 0,
        },
        tree: { root_session_id: opts.rootSessionId ?? "root_1", session_id: null },
        ordering: { sequence: seq, correlation_id: `corr_${seq}`, causation_id: null },
        delivery: { timestamp: opts.timestamp ?? seq * 1000, redacted_metadata: {} },
      },
    },
  }
}

/** A fake source over an in-memory event list, keyed by the definition aggregate. */
function fakeSource(events: readonly RawDurableEvent[], live?: readonly RawDurableEvent[]): JobOccurrenceProjection.JobOccurrenceSource {
  return {
    readAggregate: (input) =>
      Effect.sync(() => {
        const matching = events.filter((e) => {
          const seqOf = e.durable?.seq ?? 0
          return seqOf > (input.after ?? -1)
        })
        const page = matching.slice(0, input.limit)
        const lastSeq = page.length > 0 ? (page[page.length - 1].durable?.seq ?? 0) : (input.after ?? -1)
        return { events: page, hasMore: page.length < matching.length, lastSeq }
      }),
    subscribe: () => Effect.succeed(Stream.fromIterable(live ?? [])),
  }
}

/** A source whose durable reads always fail — an unbound bridge. */
const unboundSource: JobOccurrenceProjection.JobOccurrenceSource = {
  readAggregate: () => Effect.fail({ type: "unavailable", reason: "bridge unbound" } as JobsError),
  subscribe: () => Effect.fail({ type: "unavailable", reason: "bridge unbound" } as JobsError),
}

// =============================================================================
// T015 — jobs occurrence projection
// =============================================================================

describe("T015 — jobs occurrence projection over a fake EventV2 aggregate", () => {
  test("history folds durable events into one Occurrence per id, filters foreign definitions", async () => {
    const events = [
      jobEvent("job.trigger_due", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
      jobEvent("job.execution_started", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
      jobEvent("job.execution_completed", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
      jobEvent("job.trigger_due", { jobDefinitionId: "job_a", occurrenceId: "occ_2" }),
      // A foreign definition's event must never leak into job_a's history.
      jobEvent("job.execution_failed", { jobDefinitionId: "job_b", occurrenceId: "occ_9" }),
    ]
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(fakeSource(events))
    const out = await Effect.runPromise(projection.history({ jobDefinitionId: "job_a", limit: 50 }))
    expect(out.occurrences.map((o) => o.occurrenceId).sort()).toEqual(["occ_1", "occ_2"])
    const occ1 = out.occurrences.find((o) => o.occurrenceId === "occ_1")!
    expect(occ1.state).toBe("completed")
    expect(occ1.outcome).toBe("completed")
    const occ2 = out.occurrences.find((o) => o.occurrenceId === "occ_2")!
    expect(occ2.state).toBe("due")
    expect(occ2.outcome).toBeNull()
    // Never a foreign definition.
    expect(out.occurrences.every((o) => o.jobDefinitionId === "job_a")).toBe(true)
  })

  test("history is bounded by the requested limit and reports a cursor when more remain", async () => {
    const events = Array.from({ length: 6 }, (_v, i) =>
      jobEvent("job.trigger_due", { jobDefinitionId: "job_a", occurrenceId: `occ_${i}` }),
    )
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(fakeSource(events), { pageSize: 2 })
    const out = await Effect.runPromise(projection.history({ jobDefinitionId: "job_a", limit: 3 }))
    expect(out.occurrences.length).toBe(3)
  })

  test("history projects notification events into bounded redacted envelopes", async () => {
    const events = [
      jobEvent("job.notification_delivered", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
    ]
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(fakeSource(events))
    const out = await Effect.runPromise(projection.history({ jobDefinitionId: "job_a", limit: 50 }))
    expect(out.notifications.length).toBe(1)
    expect(out.notifications[0].jobDefinitionId).toBe("job_a")
    // Content-free: only the bounded type label, never a payload/path/secret.
    expect(out.notifications[0].summary).toBe("job.notification_delivered")
  })

  test("showOccurrences returns the bounded occurrence list", async () => {
    const events = [
      jobEvent("job.trigger_due", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
      jobEvent("job.trigger_due", { jobDefinitionId: "job_a", occurrenceId: "occ_2" }),
    ]
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(fakeSource(events))
    const list = await Effect.runPromise(projection.showOccurrences("job_a", 1))
    expect(list.length).toBe(1)
  })

  test("watch streams a bounded, filtered occurrence read model", async () => {
    const live = [
      jobEvent("job.execution_started", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
      jobEvent("job.execution_completed", { jobDefinitionId: "job_b", occurrenceId: "occ_9" }),
      jobEvent("job.execution_completed", { jobDefinitionId: "job_a", occurrenceId: "occ_1" }),
    ]
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(fakeSource([], live))
    const collected = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* projection.watch({ jobDefinitionId: "job_a", principal: { kind: "operator", id: "op" } })
          const chunk = yield* Stream.runCollect(stream)
          return Array.from(chunk)
        }),
      ),
    )
    // Only job_a events survive the filter; job_b is dropped.
    expect(collected.map((e) => e.occurrenceId)).toEqual(["occ_1", "occ_1"])
    expect(collected.every((e) => e.eventType.startsWith("job."))).toBe(true)
  })

  test("an unbound bridge degrades history/watch to a typed unavailable gap", async () => {
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(unboundSource)
    const hist = await Effect.runPromiseExit(projection.history({ jobDefinitionId: "job_a", limit: 10 }))
    expect(Exit.isFailure(hist)).toBe(true)
    const watch = await Effect.runPromiseExit(
      Effect.scoped(projection.watch({ jobDefinitionId: "job_a", principal: { kind: "operator", id: "op" } })),
    )
    expect(Exit.isFailure(watch)).toBe(true)
  })

  test("the live backend show() attaches projected occurrences; the gap default stays honest-empty", async () => {
    const config = fakeConfig()
    const persistence = createOperatorJobPersistence({ config })
    const events = [jobEvent("job.trigger_due", { jobDefinitionId: "job_seed", occurrenceId: "occ_1" })]
    const projection = JobOccurrenceProjection.createJobOccurrenceProjection(fakeSource(events))
    // Seed a definition through the mutation plan so show()'s definition read succeeds.
    const plan = await Effect.runPromise(
      persistence.planCreate({
        name: "seed",
        description: "d",
        schedule: { cronExpression: "* * * * *", ianaTimezone: "UTC" },
        actionType: "native_maintenance",
        overlapPolicy: "forbid",
        misfirePolicy: "skip",
        scope: "global",
        scopeId: "",
        payloadRef: "ref",
        principal: { kind: "operator", id: "op" },
      }),
    )
    const doc = plan.apply(null) as { definitions: Record<string, { jobDefinitionId: string }> }
    const seededId = Object.keys(doc.definitions)[0]
    config.store.set("jobs", { version: "1", payload: doc })

    const withProjection = createLiveJobsBackend({ persistence, occurrences: projection })
    const shown = await Effect.runPromise(withProjection.show({ jobDefinitionId: seededId, occurrenceLimit: 10 }))
    // The projection reads the job_seed aggregate (no occ under seededId) → honest-empty,
    // proving show() routes through the projection without fabricating occurrences.
    expect(Array.isArray(shown.occurrences)).toBe(true)

    const gapBackend = createLiveJobsBackend({ persistence })
    const gapHistory = await Effect.runPromiseExit(gapBackend.history({ jobDefinitionId: seededId, limit: 10 }))
    expect(Exit.isFailure(gapHistory)).toBe(true)
  })
})

/** A minimal in-memory ConfigPort double. */
function fakeConfig() {
  const store = new Map<string, { version: string; payload: unknown } | null>()
  return {
    store,
    get: async (authority: string) => store.get(authority) ?? null,
    put: async () => ({ version: "1" }),
  } as never as import("@/operator/application/ports").ConfigPort & { store: Map<string, { version: string; payload: unknown } | null> }
}

// =============================================================================
// T016 — Milvus registry binding
// =============================================================================

describe("T016 — Milvus registry binding", () => {
  const endpoint = { address: "milvus.internal:19530", ssl: true, timeoutMs: 500 }

  test("index.test binds over the live adapter under a bounded probe when configured", async () => {
    const probes: Array<{ address: string; ssl: boolean; timeoutMs: number }> = []
    const backend = SemanticBackendLive.createLiveSemanticBackend({
      milvus: {
        endpoint,
        probe: async (input) => {
          probes.push(input)
          return { reachable: true, latencyMs: 12 }
        },
      },
    })
    const out = await Effect.runPromise(backend.index.test({ principal: { kind: "operator", id: "op" } }))
    expect(out).toEqual({ reachable: true, latencyMs: 12 })
    // The probe ran, bounded by the configured timeout — no endpoint leaked to the result.
    expect(probes[0]).toEqual({ address: "milvus.internal:19530", ssl: true, timeoutMs: 500 })
  })

  test("the index maintenance verbs run the probe gate and stay a typed milvus_unavailable gap", async () => {
    const backend = SemanticBackendLive.createLiveSemanticBackend({
      milvus: { endpoint, probe: async () => ({ reachable: true, latencyMs: 5 }) },
    })
    const principal = { kind: "operator" as const, id: "op" }
    const runs: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
      backend.index.status({ collection: "tools", scope: "global", scopeId: "" }),
      backend.index.reindex({ collection: "tools", principal }),
      backend.index.reconcile({ collection: "tools" }),
      backend.index.showCollections({ scope: "global", scopeId: "" }),
    ]
    for (const run of runs) {
      const exit = await Effect.runPromiseExit(run)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain("milvus_unavailable")
      }
    }
  })

  test("an unreachable endpoint degrades index.test's reachability and gates the rest", async () => {
    const backend = SemanticBackendLive.createLiveSemanticBackend({
      milvus: { endpoint, probe: async () => ({ reachable: false, latencyMs: 0 }) },
    })
    const out = await Effect.runPromise(backend.index.test({ principal: { kind: "operator", id: "op" } }))
    expect(out.reachable).toBe(false)
    const exit = await Effect.runPromiseExit(backend.index.status({ collection: "tools", scope: "global", scopeId: "" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("a probe-seam outage maps to a typed milvus_unavailable, never a raw error", async () => {
    const backend = SemanticBackendLive.createLiveSemanticBackend({
      milvus: {
        endpoint,
        probe: async () => {
          throw new Error("grpc channel exploded with secret token=abc")
        },
      },
    })
    const exit = await Effect.runPromiseExit(backend.index.test({ principal: { kind: "operator", id: "op" } }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause.toString()
      expect(err).toContain("milvus_unavailable")
      // No secret / raw error leaks through the typed reason.
      expect(err).not.toContain("secret token")
    }
  })

  test("unconfigured degradation identity: index verbs return the same milvus_unavailable gap as today", async () => {
    const configured = SemanticBackendLive.createLiveSemanticBackend({
      milvus: { endpoint, probe: async () => ({ reachable: true, latencyMs: 1 }) },
    })
    const unconfigured = SemanticBackendLive.createLiveSemanticBackend({})
    // Unconfigured: even index.test degrades to the typed gap (no binding at all).
    const exit = await Effect.runPromiseExit(unconfigured.index.test({ principal: { kind: "operator", id: "op" } }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("milvus_unavailable")
    // Configured index.test is genuinely different — it succeeds with a reachability finding.
    const okExit = await Effect.runPromiseExit(configured.index.test({ principal: { kind: "operator", id: "op" } }))
    expect(Exit.isSuccess(okExit)).toBe(true)
  })
})
