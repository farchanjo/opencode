/**
 * Feature 018 / Group A (T001-T007) — the eager scheduled-jobs executor
 * composition root.
 *
 * Features 002 and 003 shipped a complete but never-composed executor: the
 * scheduler engine + Bun cron adapter (`bun-cron-adapter.ts`), the trigger
 * service with its `TaskProcessCoordinator` seam (`trigger-service.ts:122-131`),
 * and the occurrence-claim state machine all exist, but nothing outside `jobs/`
 * self-exports and tests ever started the cron loop or wired the coordinator to
 * the real execution seams. This module is the composition root: it constructs
 * the scheduler engine + `createBunCronAdapter` + trigger service +
 * `TaskProcessCoordinator`, wires the `DueDispatcher` to a fire-and-forget
 * `onDue` and the `reconcileSource` to the persisted registration rehydration,
 * and arms the whole thing **eagerly** at server start
 * (`ensureExecutorComposition`, mirroring the Feature 017
 * `SpoolProcessWriter.ensureProcessSpoolWriter()` eager seam).
 *
 * Invariants (FR1-FR7):
 *   - **Eager + independent of the operator stack.** The arming rides the server
 *     lifecycle, not a lazy first-operator-command path (the Feature 017
 *     spool-writer defect this avoids).
 *   - **Fail-open + idempotent (FR2).** Any construction/arming fault is caught so
 *     it never breaks server startup — the executor stays `disarmed` and the
 *     schedule/run-now verbs stay at their typed gap. A second call reuses the
 *     armed (or disarmed) instance, never a second cron loop.
 *   - **Bounded concurrency (FR3).** A per-schedule active-occurrence tracker feeds
 *     the trigger service's overlap evaluation, so a `forbid`/`queue`/`replace`
 *     overlap is honored and there is never an unbounded fan-out of headless
 *     sessions.
 *   - **Honest admission + no privilege bypass (FR4, FR6).** The coordinator runs
 *     the real Feature 002 admission + Feature 001 routing gates and a scheduled
 *     session runs under the SAME permission/config surface as a normal session;
 *     a capability a headless session cannot satisfy degrades to a typed terminal
 *     outcome (`OccurrenceRunner`), never a fabricated success.
 *
 * Every effect boundary is an injected seam so the composition is unit-testable
 * in-process with fakes and needs neither the Bun runtime, the AppRuntime, nor a
 * live control store. The real seams are wired lazily in
 * `executor-composition-live.ts`.
 */
export * as ExecutorComposition from "./executor-composition"

import { Effect } from "effect"
import { createTriggerService } from "./trigger-service"
import type {
  JobEventEmitter,
  JobEmitEnvelope,
  OccurrenceRegistry,
  TaskProcessCoordinator,
  TriggerError,
  TriggerInput,
  TriggerService,
} from "./trigger-service"
import { createBunCronAdapter } from "./bun-cron-adapter"
import type { BunCronAdapter, BunCronHandle, BunCronRuntime, DueSignal, ReconcileSource } from "./bun-cron-adapter"
import type { JobEventType, Occurrence, OverlapPolicy } from "@opencode-ai/protocol/jobs/commands"
import { Overlap } from "@opencode-ai/core/jobs/overlap"

// =============================================================================
// Arming state
// =============================================================================

export type ArmState = "armed" | "disarmed"

// =============================================================================
// Occurrence runner seam (T005, T006) — headless run to terminal
// =============================================================================

/**
 * The terminal disposition of a headless scheduled run. `headless_incapable` is
 * the honest outcome when a scheduled session cannot satisfy a capability a
 * normal interactive session would (e.g. an interactive permission prompt with no
 * operator present) — never a fabricated success and never an auto-approved
 * bypass (FR6, ADR-0018 decision 3).
 */
export type TerminalDisposition = "completed" | "failed" | "cancelled" | "timed_out" | "headless_incapable"

export interface OccurrenceRunInput {
  readonly occurrence: Occurrence
  readonly correlationId: string
  readonly causationId: string | null
}

export interface OccurrenceRunResult {
  readonly disposition: TerminalDisposition
  /** Bounded, secret-free reason for a non-`completed` disposition (FR13). */
  readonly reason?: string
}

/**
 * Runs an admitted occurrence headless to terminal and reports the disposition.
 * The composition emits the `job.execution_started` + terminal `job.*` events
 * around this seam; the runner itself only drives the Feature 002
 * `SessionExecution` under the SAME permission surface and captures output
 * through the SHARED Feature 017 spool writer (FR5, FR6).
 */
export interface OccurrenceRunner {
  readonly run: (input: OccurrenceRunInput) => Effect.Effect<OccurrenceRunResult, TriggerError>
}

// =============================================================================
// Due-context resolution (persisted registration → TriggerInput fields)
// =============================================================================

/**
 * The persisted registration fields the composition needs to expand one bounded
 * `DueSignal` into a full `TriggerInput`. Supplied by the persistence layer
 * through the injected `resolveDueContext`; `null` means the definition is no
 * longer enabled/persisted, so the due signal is dropped without claiming past
 * execution (FR1, input validation).
 */
export interface DueRegistrationView {
  readonly overlapPolicy: OverlapPolicy
  readonly rootSessionId: string
  /** Executor-owned fencing generation carried in the idempotency tuple; never authored here (C6). */
  readonly generation: number
  /** Which non-`forbid` overlap policies the surface can enforce (`forbid` is always enforceable). */
  readonly overlapCapabilities: Overlap.OverlapCapabilities
}

export type DueContextResolver = (signal: DueSignal) => Effect.Effect<DueRegistrationView | null, TriggerError>

// =============================================================================
// Composition dependencies + surface
// =============================================================================

export interface ExecutorCompositionDeps {
  readonly cron: BunCronRuntime
  readonly emitter: JobEventEmitter
  readonly registry: OccurrenceRegistry
  readonly coordinator: TaskProcessCoordinator
  readonly runner: OccurrenceRunner
  readonly resolveDueContext: DueContextResolver
  /** Rehydrated registration intents for the startup reconcile sweep; absent → an empty sweep. */
  readonly reconcileSource?: ReconcileSource
  /** Fire-and-forget runner for `onDue` and the startup sweep (default a synchronous drain). */
  readonly runFork?: (effect: Effect.Effect<void>) => void
  /** Monotonic millisecond clock (default `Date.now`). */
  readonly clock?: () => number
  /** Occurrence id generator; carried to the trigger service. */
  readonly newOccurrenceId?: () => string
}

export interface ExecutorComposition {
  readonly state: ArmState
  readonly adapter: BunCronAdapter | null
  readonly triggerService: TriggerService | null
  /**
   * The fire-and-forget due path: resolve the persisted context, run the trigger
   * service under the bounded overlap tracker, and — when admitted — run the
   * occurrence headless to terminal emitting the execution events. Never throws;
   * a resolution/trigger fault is absorbed (fail-open per due signal).
   */
  readonly onDue: (signal: DueSignal) => Effect.Effect<void>
  /** Run the startup reconcile sweep (rehydrate enabled definitions); fail-open. */
  readonly arm: () => Effect.Effect<void>
  /** Count of occurrences currently running headless (bounded-concurrency probe). */
  readonly activeOccurrences: () => number
  /** Bounded, secret-free reason when `disarmed`; else `null`. */
  readonly reason: string | null
  /** Stop every live cron registration. Idempotent. */
  readonly dispose: () => void
}

const scheduleKey = (signal: DueSignal): string => `${signal.jobDefinitionId}:${signal.scheduleId}`

/** Per-schedule active-occurrence tracker feeding the trigger service's overlap evaluation (FR3). */
interface ActiveTracker {
  readonly running: (key: string) => boolean
  readonly runningIsMutating: (key: string) => boolean
  readonly begin: (key: string) => void
  readonly end: (key: string) => void
  readonly size: () => number
}

function createActiveTracker(): ActiveTracker {
  const counts = new Map<string, number>()
  let total = 0
  return {
    running: (key) => (counts.get(key) ?? 0) > 0,
    // The composition never begins a mutating occurrence before overlap resolves,
    // so a headless run is treated as non-mutating for the sibling's overlap eval;
    // a mid-mutation sibling is guarded by the trigger service (C17, AC25).
    runningIsMutating: () => false,
    begin: (key) => {
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total++
    },
    end: (key) => {
      const next = (counts.get(key) ?? 1) - 1
      if (next <= 0) counts.delete(key)
      else counts.set(key, next)
      total = Math.max(0, total - 1)
    },
    size: () => total,
  }
}

/** Map a terminal disposition onto its canonical `job.*` execution event (never a new type). */
const TERMINAL_EVENT: Readonly<Record<TerminalDisposition, JobEventType>> = {
  completed: "job.execution_completed",
  failed: "job.execution_failed",
  // A headless-incapable capability is an honest failure terminal, not a fabricated success (FR6).
  headless_incapable: "job.execution_failed",
  cancelled: "job.execution_cancelled",
  timed_out: "job.execution_timed_out",
}

// =============================================================================
// Pure builder (deterministic; used directly by tests)
// =============================================================================

/**
 * Construct an armed executor composition over the injected seams. Pure and
 * synchronous — it wires the trigger service + cron adapter but does NOT run the
 * startup sweep (call `arm()` for that). The cron runtime is wrapped so every
 * live registration is tracked and `dispose()` can stop them all.
 */
export function buildExecutorComposition(deps: ExecutorCompositionDeps): ExecutorComposition {
  const clock = deps.clock ?? Date.now
  const runFork = deps.runFork ?? ((effect) => void Effect.runPromise(effect).catch(() => {}))
  const tracker = createActiveTracker()

  // Wrap the cron runtime so every scheduled handle is tracked for a clean dispose.
  const handles = new Set<BunCronHandle>()
  const trackedCron: BunCronRuntime = {
    parse: deps.cron.parse,
    remove: deps.cron.remove,
    schedule: (expression, handler) => {
      const handle = deps.cron.schedule(expression, handler)
      const tracked: BunCronHandle = {
        cron: handle.cron,
        stop: () => {
          handles.delete(tracked)
          return handle.stop()
        },
      }
      handles.add(tracked)
      return tracked
    },
  }

  const triggerService = createTriggerService({
    emitter: deps.emitter,
    registry: deps.registry,
    coordinator: deps.coordinator,
    newOccurrenceId: deps.newOccurrenceId,
  })

  const emitTerminal = (
    occurrence: Occurrence,
    correlationId: string,
    causationId: string | null,
    eventType: JobEventType,
    detail: Record<string, unknown>,
  ): Effect.Effect<void, TriggerError> => {
    const envelope: JobEmitEnvelope = {
      jobDefinitionId: occurrence.jobDefinitionId,
      scheduleId: occurrence.scheduleId,
      occurrenceId: occurrence.occurrenceId,
      processId: occurrence.processId,
      rootSessionId: (occurrence.rootSessionId ?? occurrence.jobDefinitionId) as JobEmitEnvelope["rootSessionId"],
      sessionId: occurrence.sessionId,
      attempt: occurrence.attempt,
      generation: occurrence.generation,
      correlationId,
      causationId,
    }
    return deps.emitter.emit({ envelope, eventType, detail }).pipe(Effect.asVoid)
  }

  // Run an admitted occurrence headless to terminal, emitting execution_started
  // then the terminal event. A runner fault degrades to a bounded execution_failed
  // terminal — never a leaked stack trace, never a fabricated completion (FR6, FR13).
  const runAdmitted = (
    occurrence: Occurrence,
    correlationId: string,
    causationId: string | null,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* emitTerminal(occurrence, correlationId, causationId, "job.execution_started", {})
      const result = yield* deps.runner
        .run({ occurrence, correlationId, causationId })
        .pipe(Effect.catch((error) => Effect.succeed(runnerFault(error))))
      const eventType = TERMINAL_EVENT[result.disposition]
      const detail: Record<string, unknown> = { disposition: result.disposition }
      if (result.reason !== undefined) detail.reason = result.reason
      yield* emitTerminal(occurrence, correlationId, causationId, eventType, detail)
    }).pipe(Effect.catch(() => Effect.void))

  const onDue = (signal: DueSignal): Effect.Effect<void> =>
    Effect.gen(function* () {
      const view = yield* deps.resolveDueContext(signal)
      if (view === null) return // definition no longer enabled/persisted — drop honestly
      const key = scheduleKey(signal)
      const nominalMs = signal.firedAtMs
      const input: TriggerInput = {
        jobDefinitionId: signal.jobDefinitionId,
        scheduleId: signal.scheduleId,
        nominalDueTime: new Date(nominalMs).toISOString(),
        generation: view.generation,
        rootSessionId: view.rootSessionId as TriggerInput["rootSessionId"],
        correlationId: `corr_${signal.jobDefinitionId}_${nominalMs}_${view.generation}`,
        causationId: null,
        nominalDueMs: nominalMs,
        observedAtMs: clock(),
        overlapPolicy: view.overlapPolicy,
        overlapCapabilities: view.overlapCapabilities,
        running: tracker.running(key),
        runningIsMutating: tracker.runningIsMutating(key),
      }

      const out = yield* triggerService.trigger(input)
      if (out.outcome !== "admitted") return // overlap-rejected / claimed / coalesced — bounded, honest

      // Admitted: bound the headless run under the active tracker so a concurrent
      // sibling sees `running` and the overlap policy applies (FR3).
      tracker.begin(key)
      yield* runAdmitted(out.occurrence, input.correlationId, input.causationId).pipe(
        Effect.ensuring(Effect.sync(() => tracker.end(key))),
      )
    }).pipe(Effect.catch(() => Effect.void)) // fail-open per due signal

  const adapter = createBunCronAdapter({
    cron: trackedCron,
    clock,
    reconcileSource: deps.reconcileSource,
    // The Bun cron callback hands each due signal to the fire-and-forget dispatch:
    // it returns immediately and never blocks the cron thread (FR1, AC1).
    dispatch: (signal) => runFork(onDue(signal)),
  })

  const arm = (): Effect.Effect<void> =>
    adapter
      .reconcile({ scope: "startup", jobDefinitionId: null })
      .pipe(Effect.asVoid, Effect.catch(() => Effect.void))

  return {
    state: "armed",
    adapter,
    triggerService,
    onDue,
    arm,
    activeOccurrences: () => tracker.size(),
    reason: null,
    dispose: () => {
      for (const handle of [...handles]) {
        try {
          handle.stop()
        } catch {
          // A stop fault on one registration never blocks disposing the rest.
        }
      }
      handles.clear()
    },
  }
}

/** A runner fault becomes a bounded, secret-free execution_failed terminal (FR13). */
function runnerFault(error: TriggerError): OccurrenceRunResult {
  const reason =
    error.type === "capability_unsupported"
      ? `capability_unsupported:${error.capability}`
      : error.type === "admission_rejected"
        ? "admission_rejected"
        : error.type === "unavailable"
          ? "executor_unavailable"
          : "not_implemented"
  return { disposition: "failed", reason }
}

// =============================================================================
// Eager process-singleton bootstrap (mirrors ensureProcessSpoolWriter)
// =============================================================================

let singleton: ExecutorComposition | undefined
let attempted = false

const disarmed = (reason: string): ExecutorComposition => ({
  state: "disarmed",
  adapter: null,
  triggerService: null,
  onDue: () => Effect.void,
  arm: () => Effect.void,
  activeOccurrences: () => 0,
  reason,
  dispose: () => {},
})

/** A bounded, secret-free reason for a caught arming fault (never a raw stack trace, FR13). */
function boundedReason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.length > 200 ? `${message.slice(0, 197)}...` : message
}

/**
 * Ensure the process-wide executor composition is armed EXACTLY ONCE (idempotent,
 * fail-open). Returns the shared armed composition, or a `disarmed` composition
 * when construction/arming faults — the server still starts and the schedule/
 * run-now verbs stay at their typed gap (FR1, FR2). A test passes explicit `deps`
 * to arm over fakes; production omits them and the live seams are loaded lazily.
 *
 * `arm()` (the reconcile startup sweep) is run fire-and-forget so a slow
 * persistence read never blocks `server.listen()`.
 */
export function ensureExecutorComposition(deps?: ExecutorCompositionDeps): ExecutorComposition {
  if (singleton) return singleton
  if (attempted && !deps) return disarmed("executor composition previously failed to arm")
  attempted = true
  try {
    const resolved = deps ?? loadLiveDeps()
    const composition = buildExecutorComposition(resolved)
    const runFork = resolved.runFork ?? ((effect) => void Effect.runPromise(effect).catch(() => {}))
    runFork(composition.arm())
    singleton = composition
    return composition
  } catch (cause) {
    singleton = disarmed(boundedReason(cause))
    return singleton
  }
}

/** The current armed composition without arming one; `undefined` before the first ensure. */
export function currentExecutorComposition(): ExecutorComposition | undefined {
  return singleton
}

/**
 * Lazily load the real production seams. Kept a function (not a module import) so
 * importing this module never dereferences the Bun global or the AppRuntime — the
 * composition stays importable under a non-Bun test runner that injects fakes. A
 * throw here is caught by `ensureExecutorComposition` (fail-open).
 */
function loadLiveDeps(): ExecutorCompositionDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const live = require("./executor-composition-live") as typeof import("./executor-composition-live")
  return live.ExecutorCompositionLive.createLiveExecutorCompositionDeps()
}

/** TEST-ONLY: dispose + reset the process singleton so a fresh composition can be armed. */
export function __resetExecutorCompositionForTests(): void {
  singleton?.dispose()
  singleton = undefined
  attempted = false
}
