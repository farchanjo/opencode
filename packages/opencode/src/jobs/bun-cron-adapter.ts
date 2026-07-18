/**
 * Feature 003 / T021 (S9) — the in-process `Bun.cron` scheduler adapter.
 *
 * The application-layer implementation of the Feature 003 `SchedulerPort`
 * (`@opencode-ai/protocol/jobs`, T012) over the confirmed Bun `1.3.14`
 * in-process `Bun.cron(schedule, handler)` capability (ADR-0004, C1). It sits
 * BESIDE the framework-free scheduling domain (`packages/core/src/jobs/**`) the
 * way `eventv2-adapter.ts` sits beside the lifecycle domain: the pure
 * next-occurrence / misfire / overlap logic stays in core, and this adapter only
 * binds the Bun runtime seam, never re-implementing that logic (plan "Dependency
 * rule").
 *
 * Faithful to the ADR-0004 runtime decision and the T021 acceptance text:
 *   - **In-process form only (C1, C2).** V1 registers `Bun.cron(schedule,
 *     handler)`; the OS-level `Bun.cron(path, schedule, title)` form is a
 *     declared capability surface that this adapter NEVER registers — a request
 *     for it surfaces a typed capability gap, not an invented API (FR5, AC22).
 *   - **No business logic in the callback, no polling loop (FR9, C1, AC1).** The
 *     in-process callback only builds a bounded `DueSignal` and hands it to the
 *     injected `dispatch` seam (wired at the composition root to the trigger
 *     service's fire-and-forget run). It claims nothing and executes nothing
 *     itself; the whole misfire/overlap/admission decision is the trigger
 *     service's (T023).
 *   - **Next occurrence over `Bun.cron.parse` behind the domain port (C4).**
 *     `createNextOccurrencePort` is the single wrapper over `Bun.cron.parse`; the
 *     domain `Cron.computeNextOccurrence` layers minimum-interval flooring on top
 *     of it. `Bun.cron.parse` resolves in UTC only, so a non-UTC timezone is a
 *     declared capability gap rejected before registration, never silently
 *     mis-scheduled (AC22).
 *   - **Capability declaration + gating (FR5, AC22).** Capabilities are declared
 *     SEPARATELY for the in-process and OS-level surfaces. A definition requesting
 *     an overlap or timezone capability the in-process surface cannot enforce
 *     fails validation with a typed `capability_unsupported` error BEFORE any
 *     external registration.
 *   - **Idempotent external effect + compensation (FR6, C5).** Registration is an
 *     idempotent effect (re-registering a key stops the prior handle first);
 *     unregister is idempotent and never claims a confirmed remote kill of
 *     in-flight mutating work (FR16, C17, AC25). No transaction spans
 *     Config.Service and Bun — durability is the persistence layer's authority
 *     (T022), never a live `Bun.cron` registration (FR3).
 *
 * Every runtime seam (the `Bun.cron` binding, the clock, the dispatch sink, the
 * reconcile source, the tick handler) is injected, so the adapter is
 * unit-testable in-process with a fake cron runtime and needs neither the Bun
 * runtime nor a live scheduler.
 */
export * as BunCronAdapter from "./bun-cron-adapter"

import { Effect } from "effect"
import { Cron } from "@opencode-ai/core/jobs/cron"
import type { SchedulerPort } from "@opencode-ai/protocol/jobs/ports"
import type {
  JobDefinitionId,
  MisfirePolicy,
  OperatorPrincipal,
  OverlapPolicy,
  Schedule,
  ScheduleId,
  SchedulerError,
  SchedulerReconcileInput,
  SchedulerReconcileOutput,
  SchedulerRegisterInput,
  SchedulerRegisterOutput,
  SchedulerTickInput,
  SchedulerTickOutput,
  SchedulerUnregisterInput,
  SchedulerUnregisterOutput,
} from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Bun.cron runtime seam (the ONLY point that touches the Bun runtime, C1)
// =============================================================================

/**
 * A handle to one in-process `Bun.cron` registration — the narrow slice of Bun's
 * `CronJob` this adapter uses. `stop()` cancels the registration so the callback
 * never fires again (the compensating effect for unregister, FR6).
 */
export interface BunCronHandle {
  readonly cron: string
  readonly stop: () => unknown
}

/**
 * The injected `Bun.cron` runtime seam. `schedule` is the in-process
 * `Bun.cron(schedule, handler)` overload; `parse` is `Bun.cron.parse` (UTC next
 * instant); `remove` is the OS-level `Bun.cron.remove(title)` — declared for
 * surface completeness but NEVER invoked in V1 (the OS-level form is deferred,
 * C2). A test fake implements this without the Bun runtime.
 */
export interface BunCronRuntime {
  readonly schedule: (expression: string, handler: () => unknown) => BunCronHandle
  readonly parse: (expression: string, relativeDate?: number) => Date | null
  readonly remove: (title: string) => Promise<void>
}

/**
 * Bind the real `Bun.cron` runtime lazily. Kept a factory (not a module-level
 * constant) so importing this module never dereferences the `Bun` global — the
 * adapter stays importable under a non-Bun test runner that injects a fake.
 */
export const createBunCronRuntime = (): BunCronRuntime => ({
  schedule: (expression, handler) => Bun.cron(expression, handler) as unknown as BunCronHandle,
  parse: (expression, relativeDate) => Bun.cron.parse(expression, relativeDate),
  remove: (title) => Bun.cron.remove(title),
})

// =============================================================================
// Capability declaration (FR5, C1, AC22) — separate in-process / OS-level
// =============================================================================

/** Which non-`forbid` overlap policies a surface can enforce (mirrors `Overlap.OverlapCapabilities`). */
export interface OverlapCapabilities {
  readonly allow: boolean
  readonly queue: boolean
  readonly replace: boolean
}

/** The capability profile of one scheduling surface (in-process or OS-level). */
export interface SurfaceCapabilities {
  /** Whether this adapter can register the surface at all in V1. */
  readonly supported: boolean
  /** Whether a registration survives process exit (the durable authority is Config.Service, never this, FR3). */
  readonly durable: boolean
  /** Overlap policies enforceable on this surface; `forbid` is always enforceable and never gated. */
  readonly overlap: OverlapCapabilities
  /** Whether this surface can honor an arbitrary IANA timezone (Bun.cron.parse is UTC-only, C4). */
  readonly timezone: "utc_only" | "iana"
}

/** The declared capabilities of both surfaces (plan "in-process vs OS-level"). */
export interface AdapterCapabilities {
  readonly in_process: SurfaceCapabilities
  readonly os_level: SurfaceCapabilities
}

/**
 * The V1 default capability declaration. In-process is supported and non-durable
 * (Bun in-process registrations do not survive exit, ADR-0004 Context); `forbid`
 * and `allow` overlap are enforceable in-process (the handler's returned Promise
 * gates no-overlap; `allow` simply does not await), while `queue`/`replace`
 * require an occurrence-layer the adapter does not run, so they are gated off.
 * `Bun.cron.parse` is UTC-only. The OS-level surface is declared UNSUPPORTED —
 * every field false — so any request for it is a typed capability gap (C2, AC22).
 */
export const DEFAULT_ADAPTER_CAPABILITIES: AdapterCapabilities = Object.freeze({
  in_process: Object.freeze({
    supported: true,
    durable: false,
    overlap: Object.freeze({ allow: true, queue: false, replace: false }),
    timezone: "utc_only",
  }),
  os_level: Object.freeze({
    supported: false,
    durable: false,
    overlap: Object.freeze({ allow: false, queue: false, replace: false }),
    timezone: "utc_only",
  }),
})

// =============================================================================
// Injected application seams
// =============================================================================

/**
 * The bounded signal the in-process callback hands to the trigger service when a
 * due time fires. It carries NO business decision — only enough identity for the
 * trigger service (T023) to compute the idempotency tuple and claim the
 * occurrence. `firedAtMs` is the observed trigger instant; the nominal due
 * instant and any misfire/overlap decision are the trigger service's, never the
 * callback's (FR9, C1, C6).
 */
export interface DueSignal {
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  readonly cronExpression: string
  readonly timezone: string
  readonly firedAtMs: number
}

/**
 * The fire-and-forget dispatch seam. The composition root wires it to the
 * trigger service's `AppRuntime.runFork(triggerService.onDue(signal))` — the
 * callback returns immediately and never blocks the Bun cron thread, and no
 * business logic runs inline (FR9, AC1).
 */
export type DueDispatcher = (signal: DueSignal) => void

/**
 * One rehydrated registration intent the reconcile sweep re-applies. Supplied by
 * the persistence layer (T022) through the injected `reconcileSource`; the
 * adapter re-registers enabled definitions and compensates disabled ones without
 * claiming past execution (FR3, C5, AC2, AC23).
 */
export interface RegistrationView {
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  readonly schedule: Schedule
  readonly enabled: boolean
  readonly misfirePolicy: MisfirePolicy
  readonly overlapPolicy: OverlapPolicy
  readonly principal: OperatorPrincipal
}

/** Lists the registration intents to reconcile for a `startup` sweep or one `definition`. */
export type ReconcileSource = (
  input: SchedulerReconcileInput,
) => Effect.Effect<readonly RegistrationView[], SchedulerError>

/**
 * The occurrence-claim seam invoked by `tick`. Claiming an occurrence under its
 * idempotency tuple and evaluating misfire/overlap is trigger-service domain
 * (T023, C3, C6) — the adapter never authors that decision, it only delegates.
 * Absent, `tick` is an honest `not_implemented`.
 */
export type TickHandler = (input: SchedulerTickInput) => Effect.Effect<SchedulerTickOutput, SchedulerError>

export interface BunCronAdapterDeps {
  readonly cron: BunCronRuntime
  readonly dispatch: DueDispatcher
  /** Monotonic millisecond clock for next-occurrence anchoring (default `Date.now`). */
  readonly clock?: () => number
  /** Declared surface capabilities (default `DEFAULT_ADAPTER_CAPABILITIES`). */
  readonly capabilities?: AdapterCapabilities
  /** Whether the in-process surface can honor a timezone (default: UTC only, AC22). */
  readonly supportsTimezone?: (timezone: string) => boolean
  /** Rehydrated registration intents for `reconcile`; absent → an empty sweep. */
  readonly reconcileSource?: ReconcileSource
  /** Occurrence-claim delegate for `tick`; absent → `not_implemented`. */
  readonly tickHandler?: TickHandler
}

// =============================================================================
// Next-occurrence port over Bun.cron.parse (C4)
// =============================================================================

/**
 * The single wrapper over `Bun.cron.parse`, exposed as the domain
 * `Cron.NextOccurrencePort`. `Bun.cron.parse` returns the next matching UTC
 * `Date` (or `null` when none exists within its search horizon); the domain
 * `Cron.computeNextOccurrence` layers minimum-interval flooring on top. The
 * timezone is carried for parity with the port contract but `Bun.cron.parse`
 * resolves in UTC only (a non-UTC zone is gated at registration, C4, AC22).
 */
export const createNextOccurrencePort = (cron: BunCronRuntime): Cron.NextOccurrencePort => ({
  next: (query) => {
    const parsed = cron.parse(query.expression, query.afterMs)
    if (parsed === null) return null
    const ms = parsed.getTime()
    return Number.isFinite(ms) ? ms : null
  },
})

// =============================================================================
// The adapter surface
// =============================================================================

/** The `SchedulerPort` plus the adapter-owned inspection seams the composition root/tests use. */
export interface BunCronAdapter extends SchedulerPort {
  readonly capabilities: AdapterCapabilities
  readonly nextOccurrencePort: Cron.NextOccurrencePort
  /** Count of live in-process registrations. */
  readonly activeCount: () => number
  /** Whether a `(jobDefinitionId, scheduleId)` schedule is currently registered. */
  readonly isRegistered: (jobDefinitionId: JobDefinitionId, scheduleId: ScheduleId) => boolean
}

const registryKey = (jobDefinitionId: JobDefinitionId, scheduleId: ScheduleId): string =>
  `${jobDefinitionId}:${scheduleId}`

/** True when the requested overlap policy is enforceable on the in-process surface (`forbid` always is). */
const overlapSupported = (policy: OverlapPolicy, capabilities: OverlapCapabilities): boolean => {
  switch (policy) {
    case "forbid":
      return true
    case "allow":
      return capabilities.allow
    case "queue":
      return capabilities.queue
    case "replace":
      return capabilities.replace
  }
}

export function createBunCronAdapter(deps: BunCronAdapterDeps): BunCronAdapter {
  const clock = deps.clock ?? Date.now
  const capabilities = deps.capabilities ?? DEFAULT_ADAPTER_CAPABILITIES
  const supportsTimezone = deps.supportsTimezone ?? ((tz: string) => tz === "UTC")
  const nextOccurrencePort = createNextOccurrencePort(deps.cron)

  /** Live in-process registrations, keyed by `(jobDefinitionId, scheduleId)`. */
  const registry = new Map<string, BunCronHandle>()

  const computeNextDueAt = (schedule: Schedule): string | null => {
    const ms = Cron.computeNextOccurrence(nextOccurrencePort, {
      expression: schedule.cronExpression,
      timezone: schedule.ianaTimezone,
      afterMs: clock(),
    })
    return ms === null ? null : Cron.nominalDueKey(ms)
  }

  const register = (input: SchedulerRegisterInput): Effect.Effect<SchedulerRegisterOutput, SchedulerError> =>
    Effect.gen(function* () {
      const surface = capabilities.in_process
      if (!surface.supported) {
        return yield* Effect.fail<SchedulerError>({ type: "capability_unsupported", capability: "in_process" })
      }

      // Structural cron validation BEFORE any external effect (AC22): an invalid
      // expression is a typed validation gap, never a thrown Bun runtime error.
      const parse = Cron.parseCronExpression(input.schedule.cronExpression)
      if (parse.kind === "invalid") {
        return yield* Effect.fail<SchedulerError>({ type: "invalid_schedule", reason: parse.reason })
      }

      // Timezone gating: Bun.cron.parse is UTC-only, so an unenforceable zone is
      // rejected before registration rather than silently mis-scheduled (C4, AC22).
      if (!supportsTimezone(input.schedule.ianaTimezone)) {
        return yield* Effect.fail<SchedulerError>({
          type: "capability_unsupported",
          capability: `timezone:${input.schedule.ianaTimezone}`,
        })
      }

      // Overlap gating: a non-`forbid` policy the in-process surface cannot
      // enforce fails validation before registration (FR5, C3, AC22).
      if (!overlapSupported(input.overlapPolicy, surface.overlap)) {
        return yield* Effect.fail<SchedulerError>({
          type: "capability_unsupported",
          capability: `overlap:${input.overlapPolicy}`,
        })
      }

      const key = registryKey(input.jobDefinitionId, input.schedule.scheduleId)

      // Idempotent external effect: re-registering a key stops the prior handle
      // first so no duplicate callback survives (FR6). Bun.cron may throw on a
      // late-rejected expression; surface it as `unavailable`, never a leak.
      const handle = yield* Effect.try({
        try: () => {
          const existing = registry.get(key)
          if (existing !== undefined) existing.stop()
          const jobDefinitionId = input.jobDefinitionId
          const scheduleId = input.schedule.scheduleId
          const cronExpression = input.schedule.cronExpression
          const timezone = input.schedule.ianaTimezone
          // The callback carries NO business logic: it only builds a bounded
          // signal and hands it to the injected dispatch seam (FR9, AC1).
          return deps.cron.schedule(cronExpression, () => {
            deps.dispatch({ jobDefinitionId, scheduleId, cronExpression, timezone, firedAtMs: clock() })
          })
        },
        catch: (cause): SchedulerError => ({ type: "unavailable", reason: String(cause) }),
      })

      registry.set(key, handle)
      return { registrationState: "registered", nextDueAt: computeNextDueAt(input.schedule), capabilityGap: null }
    })

  const unregister = (
    input: SchedulerUnregisterInput,
  ): Effect.Effect<SchedulerUnregisterOutput, SchedulerError> =>
    Effect.sync(() => {
      const key = registryKey(input.jobDefinitionId, input.scheduleId)
      const handle = registry.get(key)
      // Idempotent + mutation-safe: stopping the in-process callback only stops
      // future fires. It NEVER kills an in-flight handler/process and is never
      // reported as a confirmed remote kill of mutating work (FR16, C17, AC25).
      if (handle !== undefined) {
        handle.stop()
        registry.delete(key)
      }
      return { registrationState: "unregistered" }
    })

  const reconcile = (
    input: SchedulerReconcileInput,
  ): Effect.Effect<SchedulerReconcileOutput, SchedulerError> =>
    Effect.gen(function* () {
      const source = deps.reconcileSource
      if (source === undefined) {
        // No rehydration source wired: an honest empty sweep, never a false replay.
        return { reconciledCount: 0, unknownCount: 0, registeredCount: 0 }
      }

      const views = yield* source(input)
      let reconciledCount = 0
      let unknownCount = 0
      let registeredCount = 0

      for (const view of views) {
        // Each registration is an independent idempotent effect; a single failure
        // is reported as `unknown`, never aborting the whole sweep or claiming a
        // cross-system atomic commit (C5, AC23).
        if (view.enabled) {
          const outcome = yield* register({
            jobDefinitionId: view.jobDefinitionId,
            schedule: view.schedule,
            misfirePolicy: view.misfirePolicy,
            overlapPolicy: view.overlapPolicy,
            principal: view.principal,
          }).pipe(Effect.result)
          if (outcome._tag === "Success") {
            registeredCount++
            reconciledCount++
          } else {
            unknownCount++
          }
        } else {
          yield* unregister({
            jobDefinitionId: view.jobDefinitionId,
            scheduleId: view.scheduleId,
            principal: view.principal,
          })
          reconciledCount++
        }
      }

      return { reconciledCount, unknownCount, registeredCount }
    })

  const tick = (input: SchedulerTickInput): Effect.Effect<SchedulerTickOutput, SchedulerError> => {
    const handler = deps.tickHandler
    if (handler === undefined) return Effect.fail<SchedulerError>({ type: "not_implemented" })
    return handler(input)
  }

  return {
    register,
    unregister,
    reconcile,
    tick,
    capabilities,
    nextOccurrencePort,
    activeCount: () => registry.size,
    isRegistered: (jobDefinitionId, scheduleId) => registry.has(registryKey(jobDefinitionId, scheduleId)),
  }
}
