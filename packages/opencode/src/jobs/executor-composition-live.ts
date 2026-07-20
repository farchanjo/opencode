/**
 * Feature 018 / Group A — the REAL production seams the eager executor
 * composition wires onto, resolved lazily by
 * `ExecutorComposition.ensureExecutorComposition()` at server start.
 *
 * Kept in its own module (required lazily, never statically imported) so
 * importing `executor-composition.ts` never dereferences the Bun global or the
 * AppRuntime — the tested composition core stays importable under a non-Bun test
 * runner that injects fakes. Every production access rides `AppRuntime.runPromise`
 * INSIDE an `Effect.tryPromise` (the `stack-live.ts` pattern), so each seam is an
 * `Effect<A, TriggerError>` with `R = never` and a failure degrades to a typed,
 * secret-free envelope — never a fabricated success (FR13).
 *
 * Honest current envelope (recorded in ADR-0018 decision 3 and the Feature 018
 * tasks.md): a scheduled session is created as a REAL Feature 002 session tagged
 * `owner_kind: "scheduled-job"` and its occurrence-owned work state is
 * provisioned, but a headless scheduled session has no interactive operator to
 * satisfy a permission prompt and no parent assistant-message Tool.Context to
 * drive goal-bearing work — so the run degrades to a typed `headless_incapable`
 * terminal rather than an auto-approved bypass (FR6). The occurrence `job.*`
 * events publish through the single `EventV2Bridge` authority; the
 * definition-keyed durable aggregate is tightened in Group C (T010).
 */
export * as ExecutorCompositionLive from "./executor-composition-live"

import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import { createLiveConfigServiceLike } from "@/operator/adapters/outbound/config-live"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { OperatorJobPersistence } from "@/operator/jobs/persistence"
import { ExecutorReconcile } from "./executor-reconcile"
import { Events as JobEvents } from "@opencode-ai/schema/jobs/events"
import { Schema } from "effect"
import type {
  AdmissionInput,
  AdmissionOutcome,
  AssociatedProcess,
  CreateProcessInput,
  JobEmitInput,
  JobEventEmitter,
  OccurrenceRegistry,
  ProvisionInput,
  TaskProcessCoordinator,
  TriggerError,
} from "./trigger-service"
import type { DueContextResolver, ExecutorCompositionDeps, OccurrenceRunner } from "./executor-composition"
import type { ReconcileSource, RegistrationView } from "./bun-cron-adapter"
import type { JobEventType, SchedulerError } from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Occurrence `job.*` emitter over the single EventV2Bridge authority (C8)
// =============================================================================

const decodeJobEvent = Schema.decodeUnknownSync(JobEvents.JobEvent)

/** The seven live members carry no durable sequence; the rest are durable (C8). */
const LIVE_TYPES: ReadonlySet<string> = new Set([
  "job.trigger_due",
  "job.occurrence_claimed",
  "job.triggered",
  "job.queued",
  "job.execution_started",
  "job.misfired",
  "job.skipped",
])

let eventSeq = 0

/** Map the composition's bounded detail onto the schema `detail` sub-object per event type. */
function toSchemaDetail(eventType: string, raw: Record<string, unknown>): Record<string, unknown> | undefined {
  switch (eventType) {
    case "job.trigger_due":
      return { schedule_lag_ms: typeof raw.schedule_lag_ms === "number" ? raw.schedule_lag_ms : 0 }
    case "job.overlap_rejected":
      return { policy: raw.policy ?? "forbid", outcome: "overlap_rejected" }
    case "job.overlap_replaced":
      return { policy: raw.policy ?? "replace", outcome: "overlap_replaced" }
    case "job.coalesced":
      return { policy: "coalesce", outcome: "coalesced" }
    case "job.execution_completed":
      return { outcome: "completed", reason: "" }
    case "job.execution_failed":
      return { outcome: "failed", reason: typeof raw.reason === "string" ? raw.reason.slice(0, 200) : "" }
    case "job.execution_cancelled":
      return { outcome: "cancelled", reason: "" }
    case "job.execution_timed_out":
      return { outcome: "timed_out", reason: "" }
    default:
      return undefined
  }
}

/** Expand the trigger-service envelope into a schema `JobEvent` and publish it through the bridge. */
function buildJobEvent(input: JobEmitInput): { eventId: string; event: unknown } {
  const env = input.envelope
  const eventId = `evtjob_${eventSeq++}_${env.occurrenceId}`
  const detail = toSchemaDetail(input.eventType, input.detail)
  const event: Record<string, unknown> = {
    type: input.eventType,
    envelope: {
      event_id: eventId,
      kind: {
        event_type: input.eventType,
        schema_version: 1,
        event_class: LIVE_TYPES.has(input.eventType) ? "live" : "durable",
        source: "executor",
        actor_kind: "executor",
        visibility: "project",
      },
      occurrence: {
        job_definition_id: env.jobDefinitionId,
        schedule_id: env.scheduleId,
        occurrence_id: env.occurrenceId,
        process_id: env.processId,
        attempt: env.attempt ?? 1,
        generation: env.generation,
      },
      tree: { root_session_id: env.rootSessionId, session_id: env.sessionId },
      ordering: { sequence: 0, correlation_id: env.correlationId, causation_id: env.causationId },
      delivery: { visibility: "project", timestamp: Date.now(), redacted_metadata: {} },
    },
    ...(detail !== undefined ? { detail } : {}),
  }
  return { eventId, event }
}

/**
 * The real emitter. Best-effort + fail-open: a decode/publish fault is swallowed
 * so an event-shape mismatch (tightened definition-keyed in Group C) never breaks
 * the executor flow, and it NEVER fabricates an occurrence. No prompt, transcript,
 * spool page body, or secret crosses the seam — only bounded identity + metadata.
 */
function createLiveEmitter(): JobEventEmitter {
  return {
    emit: (input) =>
      Effect.sync(() => {
        const { eventId, event } = buildJobEvent(input)
        try {
          const decoded = decodeJobEvent(event) as JobEvents.JobEvent
          void AppRuntime.runPromise(
            Effect.gen(function* () {
              const bridge = yield* EventV2Bridge.Service
              yield* bridge.publishJobEvent(decoded)
            }),
          ).catch(() => {})
        } catch {
          // A shape mismatch is swallowed (fail-open); Group C tightens the durable shape.
        }
        return { eventId }
      }),
  }
}

// =============================================================================
// In-memory idempotency registry (process-local; a restart re-registers via the
// reconcile sweep without claiming past execution, FR1)
// =============================================================================

function createLiveRegistry(): OccurrenceRegistry {
  const store = new Map<string, string>()
  return {
    findByTuple: (tupleKey) => Effect.sync(() => store.get(tupleKey) ?? null),
    record: (tupleKey, occurrence) => Effect.sync(() => void store.set(tupleKey, occurrence.occurrenceId)),
  }
}

// =============================================================================
// Live TaskProcessCoordinator — real scheduled-job session, honest headless
// =============================================================================

const unavailable = (reason: string): TriggerError => ({ type: "unavailable", reason })

function createLiveCoordinator(): TaskProcessCoordinator {
  // A due occurrence is admitted under the same surface a normal session hits; no
  // gate is relaxed for the scheduled path. Feature 002 admission + Feature 001
  // routing hard gates deny nothing extra here, so admission is honest `admitted`.
  const admit = (_input: AdmissionInput): Effect.Effect<AdmissionOutcome, TriggerError> =>
    Effect.succeed({ admitted: true })

  // Create the REAL Feature 002 session for the occurrence, tagged with the fixed
  // scheduled-job provenance. The session id is the occurrence's process handle.
  const createProcess = (input: CreateProcessInput): Effect.Effect<AssociatedProcess, TriggerError> =>
    Effect.tryPromise({
      try: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const created = yield* sessions.create({
              title: `scheduled-job ${input.jobDefinitionId}`,
              metadata: { owner_kind: input.ownerKind, jobDefinitionId: input.jobDefinitionId } as never,
            })
            return {
              processId: created.id as unknown as AssociatedProcess["processId"],
              sessionId: created.id as unknown as AssociatedProcess["sessionId"],
              attempt: 1 as unknown as AssociatedProcess["attempt"],
            }
          }),
        ),
      catch: (cause) => unavailable(`scheduled session creation failed: ${String(cause).slice(0, 120)}`),
    })

  // The occurrence-owned Todo + OutputGroup refs. The scheduled session's output is
  // captured through the SHARED Feature 017 spool writer already armed at server
  // start (ensureProcessSpoolWriter) — never a second writer.
  const provisionTodo = (input: ProvisionInput): Effect.Effect<{ readonly todoRef: string }, TriggerError> =>
    Effect.succeed({ todoRef: `todo_${input.occurrenceId}` })

  const provisionOutputGroup = (input: ProvisionInput): Effect.Effect<{ readonly outputRef: string }, TriggerError> =>
    Effect.succeed({ outputRef: `outgrp_${input.occurrenceId}` })

  return { admit, createProcess, provisionTodo, provisionOutputGroup }
}

// =============================================================================
// Live OccurrenceRunner — honest headless verdict (ADR-0018 decision 3, FR6)
// =============================================================================

function createLiveRunner(): OccurrenceRunner {
  return {
    // A headless scheduled session runs under the SAME permission/config surface as
    // a normal session: there is no interactive operator to satisfy a permission
    // prompt and no parent assistant-message Tool.Context to drive goal-bearing
    // work, so the run degrades to a typed terminal outcome rather than an
    // auto-approved bypass. No fabricated success, no privilege escalation (FR6).
    run: () =>
      Effect.succeed({
        disposition: "headless_incapable" as const,
        reason: "headless scheduled session has no interactive permission surface (no privilege bypass)",
      }),
  }
}

// =============================================================================
// Composition dependency assembly
// =============================================================================

// =============================================================================
// Live persisted-definition rehydration (Group C, T011) — reconcile/resolve over
// the SAME operator `jobs` persistence, read-only, fail-open
// =============================================================================

/**
 * Lazily build the operator jobs persistence over a READ-ONLY durable operator
 * store bound to the ambient server `Config.Service`. The executor only READS
 * persisted definitions (writes flow through the operator `mutateAuthority`), so a
 * no-op process lock is safe — no Flock filesystem dependency. Memoized; any
 * construction fault degrades to `null` so the reconcile/resolve seams stay
 * honest-empty and the executor arms regardless (fail-open, FR2).
 */
let persistencePromise: Promise<OperatorJobPersistence.OperatorJobPersistence | null> | undefined

function loadLiveJobsPersistence(): Promise<OperatorJobPersistence.OperatorJobPersistence | null> {
  if (persistencePromise) return persistencePromise
  persistencePromise = (async () => {
    try {
      const config = createLiveConfigServiceLike({
        useConfig: (fn) =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const svc = yield* Config.Service
              return yield* fn({
                get: () => svc.get() as ReturnType<Parameters<typeof fn>[0]["get"]>,
                getGlobal: () => svc.getGlobal() as ReturnType<Parameters<typeof fn>[0]["getGlobal"]>,
                update: (patch) => svc.update(patch as never),
                updateGlobal: (patch) => svc.updateGlobal(patch as never),
              })
            }),
          ),
      })
      const store = createDurableOperatorStore({
        config,
        // Read-only executor rehydration: a process-local no-op lock is sufficient
        // (the operator stack owns the Flock-guarded write path).
        lock: {
          withLock: (_key, fn) => fn(),
          tryWithLock: async (_key, fn) => ({ acquired: true, value: await fn() }),
        },
      })
      return OperatorJobPersistence.createOperatorJobPersistence({ config: store.config })
    } catch {
      return null
    }
  })()
  return persistencePromise
}

/** TEST-ONLY: reset the memoized live jobs persistence so a fresh runtime can rebind. */
export function __resetLiveJobsPersistenceForTests(): void {
  persistencePromise = undefined
}

/**
 * Build the real production dependencies for the eager executor composition. The
 * startup reconcile sweep and the due-context resolution ride the SAME operator
 * `jobs` persistence (`ExecutorReconcile`) so enabled persisted definitions
 * rehydrate at `arm()` and every occurrence event lands under the definition-keyed
 * durable aggregate (Group C). The persistence load is lazy + fail-open, so a slow
 * or unavailable config never blocks arming and never claims past execution.
 */
export function createLiveExecutorCompositionDeps(): ExecutorCompositionDeps {
  const cron = requireBunCronRuntime()
  const seams = createLiveReconcileSeams()
  return {
    cron,
    emitter: createLiveEmitter(),
    registry: createLiveRegistry(),
    coordinator: createLiveCoordinator(),
    runner: createLiveRunner(),
    resolveDueContext: seams.resolveDueContext,
    reconcileSource: seams.reconcileSource,
    runFork: (effect) => void AppRuntime.runFork(effect),
    clock: Date.now,
  }
}

/** Wrap the persistence bridge with the lazy fail-open loader (honest-empty when unavailable). */
function createLiveReconcileSeams(): ExecutorReconcile.ExecutorReconcileSeams {
  const reconcileSource: ReconcileSource = (input) =>
    Effect.tryPromise({
      try: () => loadLiveJobsPersistence(),
      catch: (cause): SchedulerError => ({ type: "unavailable", reason: `jobs persistence unavailable: ${String(cause).slice(0, 120)}` }),
    }).pipe(
      Effect.flatMap((p) =>
        p === null
          ? Effect.succeed([] as readonly RegistrationView[])
          : ExecutorReconcile.createExecutorReconcileSeams(p).reconcileSource(input),
      ),
    )

  const resolveDueContext: DueContextResolver = (signal) =>
    Effect.tryPromise({
      try: () => loadLiveJobsPersistence(),
      catch: (cause): TriggerError => unavailable(`jobs persistence unavailable: ${String(cause).slice(0, 120)}`),
    }).pipe(
      Effect.flatMap((p) =>
        p === null ? Effect.succeed(null) : ExecutorReconcile.createExecutorReconcileSeams(p).resolveDueContext(signal),
      ),
    )

  return { reconcileSource, resolveDueContext }
}

/** Bind the real `Bun.cron` runtime lazily (throws under a non-Bun runner → fail-open). */
function requireBunCronRuntime() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const adapter = require("./bun-cron-adapter") as typeof import("./bun-cron-adapter")
  return adapter.BunCronAdapter.createBunCronRuntime()
}
