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
 * tasks.md): a due occurrence is admitted through a REAL Feature 002
 * `AdmissionController` token-bucket gate (session scope; a denial is a typed
 * `admitted:false`, never a fabricated `admitted`). A headless scheduled session
 * has no interactive operator to satisfy a permission prompt and no parent
 * assistant-message Tool.Context to drive goal-bearing work, so the
 * headless-capability probe reports `incapable`: the coordinator does NOT persist
 * a Feature 002 session for a run it cannot drive (a per-minute cron never grows
 * dead scheduled-job sessions), the occurrence carries a synthetic, non-persisted
 * process handle, and the run degrades to a typed `headless_incapable` terminal
 * rather than an auto-approved bypass (FR6). When a headless goal-bearing driver
 * lands, the same probe flips to `capable` and `createProcess` persists the REAL
 * `owner_kind: "scheduled-job"` session before goal-bearing work. The occurrence
 * `job.*` events publish through the single `EventV2Bridge` authority; the
 * definition-keyed durable aggregate is tightened in Group C (T010).
 *
 * Boundary (FR13, ADR-0018): the in-process occurrence idempotency registry
 * (`createLiveRegistry`) is a process-local `Map` — cross-process occurrence
 * dedup is out of scope (matches the "no distributed/multi-node scheduler" note).
 */
export * as ExecutorCompositionLive from "./executor-composition-live"

import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import { AdmissionController } from "@opencode-ai/core/lifecycle/admission/admission-controller"
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

/** Injectable seam that persists a real Feature 002 scheduled-job session (production default reaches `Session.Service`). */
export interface ScheduledSessionSeam {
  readonly create: (input: {
    readonly jobDefinitionId: string
    readonly ownerKind: string
  }) => Promise<{ readonly id: string }>
}

/** The verdict of the headless-capability probe (ADR-0018 decision 3, FR6). */
export interface HeadlessCapability {
  readonly capable: boolean
  /** Bounded, secret-free reason a headless run is not capable of goal-bearing work. */
  readonly reason: string
}

/**
 * The headless goal-bearing capability probe. A headless scheduled session has no
 * interactive operator to satisfy a permission prompt and no parent
 * assistant-message `Tool.Context` to drive goal-bearing work, so goal-bearing
 * headless execution is NOT capable yet. The coordinator consults this BEFORE
 * `createProcess` so it never persists a session for a run it cannot drive
 * (session-leak fix, FR6): an incapable occurrence degrades to the typed
 * `headless_incapable` terminal with no persisted session created.
 */
export function headlessGoalBearingCapability(): HeadlessCapability {
  return {
    capable: false,
    reason: "headless scheduled session has no interactive permission surface (no privilege bypass)",
  }
}

export interface LiveCoordinatorOptions {
  /** The Feature 002 admission authority (default a fresh `AdmissionController` for the scheduled path). */
  readonly admission?: AdmissionController.AdmissionController
  /** The scheduled-job session persistence seam (default reaches `Session.Service` via `AppRuntime`). */
  readonly session?: ScheduledSessionSeam
  /** The headless goal-bearing capability probe (default `headlessGoalBearingCapability`). */
  readonly capability?: () => HeadlessCapability
}

/** The production scheduled-session seam: persist a REAL Feature 002 session tagged `owner_kind`. */
function defaultScheduledSessionSeam(): ScheduledSessionSeam {
  return {
    create: (input) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const created = yield* sessions.create({
            title: `scheduled-job ${input.jobDefinitionId}`,
            metadata: { owner_kind: input.ownerKind, jobDefinitionId: input.jobDefinitionId } as never,
          })
          return { id: created.id as string }
        }),
      ),
  }
}

/**
 * The live `TaskProcessCoordinator`. `admit` runs a REAL Feature 002
 * `AdmissionController` token-bucket gate for the occurrence's session scope — a
 * denial (`queued`/`rejected`/`partial`) is reported honestly, never a fabricated
 * `admitted` (FR4, C11). `createProcess` consults the headless-capability probe
 * BEFORE persisting: an incapable occurrence gets a synthetic, non-persisted
 * process handle (no `Session.Service.create`, so a cron loop never grows dead
 * scheduled-job sessions); a capable occurrence persists the real session before
 * goal-bearing work (session-leak fix, FR5, FR6).
 */
export function createLiveCoordinator(opts: LiveCoordinatorOptions = {}): TaskProcessCoordinator {
  const admission = opts.admission ?? AdmissionController.createAdmissionController()
  const session = opts.session ?? defaultScheduledSessionSeam()
  const capability = opts.capability ?? headlessGoalBearingCapability

  // Feature 002 admission gate: a due occurrence admits ONE unit of session-scope
  // capacity through the SAME `AdmissionController` class the lifecycle domain uses.
  // The token bucket + capacity signals decide; a denial is honest (FR4, C11).
  const admit = (input: AdmissionInput): Effect.Effect<AdmissionOutcome, TriggerError> =>
    Effect.sync((): AdmissionOutcome => {
      const decision = admission.request({ scope: "session", key: String(input.rootSessionId), requestedFanout: 1 })
      if (decision.decision === "granted") return { admitted: true }
      return { admitted: false, reason: `admission ${decision.decision}: ${decision.reason}` }
    })

  // Create/associate the occurrence's Feature 002 Task Process. The
  // headless-capability probe gates session persistence: an incapable occurrence
  // returns a synthetic handle WITHOUT `Session.Service.create` (no leaked dead
  // session); a capable one persists the real `owner_kind: "scheduled-job"` session.
  const createProcess = (input: CreateProcessInput): Effect.Effect<AssociatedProcess, TriggerError> => {
    if (!capability().capable) {
      return Effect.succeed({
        processId: `proc_${input.occurrenceId}` as unknown as AssociatedProcess["processId"],
        sessionId: `nsession_${input.occurrenceId}` as unknown as AssociatedProcess["sessionId"],
        attempt: 1 as unknown as AssociatedProcess["attempt"],
      })
    }
    return Effect.tryPromise({
      try: async (): Promise<AssociatedProcess> => {
        const created = await session.create({
          jobDefinitionId: String(input.jobDefinitionId),
          ownerKind: input.ownerKind,
        })
        return {
          processId: created.id as unknown as AssociatedProcess["processId"],
          sessionId: created.id as unknown as AssociatedProcess["sessionId"],
          attempt: 1 as unknown as AssociatedProcess["attempt"],
        }
      },
      catch: (cause) => unavailable(`scheduled session creation failed: ${String(cause).slice(0, 120)}`),
    })
  }

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

export function createLiveRunner(opts: { readonly capability?: () => HeadlessCapability } = {}): OccurrenceRunner {
  const capability = opts.capability ?? headlessGoalBearingCapability
  return {
    // A headless scheduled session runs under the SAME permission/config surface as
    // a normal session. Until a headless goal-bearing driver lands, the probe reports
    // `incapable`, so the run degrades to a typed terminal outcome rather than an
    // auto-approved bypass. No fabricated success, no privilege escalation (FR6).
    run: () =>
      Effect.sync(() => {
        const cap = capability()
        if (cap.capable) return { disposition: "completed" as const }
        return { disposition: "headless_incapable" as const, reason: cap.reason }
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
  // One admission authority + one capability probe shared by the coordinator and the
  // runner, so the session-persistence gate and the terminal verdict agree.
  const admission = AdmissionController.createAdmissionController()
  const capability = headlessGoalBearingCapability
  return {
    cron,
    emitter: createLiveEmitter(),
    registry: createLiveRegistry(),
    coordinator: createLiveCoordinator({ admission, capability }),
    runner: createLiveRunner({ capability }),
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
