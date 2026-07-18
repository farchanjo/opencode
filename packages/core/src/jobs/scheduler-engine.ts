/**
 * Feature 003 / T016 (S8) — scheduler engine (definition → registration intent).
 *
 * Framework-free, deterministic, zero I/O. Maps a durable `JobDefinition` to a
 * registration intent, computes the occurrence idempotency tuple, and measures
 * schedule lag from the nominal due instant (FR3, FR6, C5, C6). It authors NO
 * `sequence`/`attempt`/`generation` — those belong to the Feature 002 executor
 * (C6); the engine only carries the tuple. The external Bun/OS registration is
 * modeled as a plan the wave-3 adapter executes as an idempotent effect paired
 * with compensation; no transaction spans Config.Service and the scheduler (C5).
 *
 * The registration plan is a domain decision object (initial `pending` intent),
 * distinct from the persisted `ScheduleRegistration` record (which the
 * persistence layer builds with timestamps) — this module never reads a clock.
 */
export * as SchedulerEngine from "./scheduler-engine"

import type { JobDefinition } from "@opencode-ai/schema/jobs/definition"
import type { CapabilitySurface, RegistrationIntent, RegistrationState } from "@opencode-ai/schema/jobs/enums"
import type { JobDefinitionId, ScheduleId } from "@opencode-ai/schema/jobs/ids"
import type { IdempotencyKey } from "@opencode-ai/schema/jobs/occurrence"
import type { NominalDueTime } from "@opencode-ai/schema/jobs/schedule"
import type { Generation } from "@opencode-ai/schema/jobs/values"
import { Cron } from "./cron"

/**
 * A registration plan derived from a definition: the initial durable intent
 * before the external effect. `state` is always `pending` — the settled
 * `registered`/`unregistered`/`unknown`/`reconciled` states are owned by the
 * persistence + reconciliation layers, never authored here (C5).
 */
export interface RegistrationPlan {
  readonly job_definition_id: JobDefinitionId
  readonly schedule_id: ScheduleId
  readonly intent: RegistrationIntent
  readonly capability_surface: CapabilitySurface
  readonly state: Extract<RegistrationState, "pending">
}

/**
 * Map a definition to its registration plan: an enabled definition intends to
 * `register`, a disabled one intends to `unregister` (the compensating effect).
 * Pure and total; the resulting intent drives the adapter's idempotent external
 * effect (FR3, FR6, C5).
 */
export const planRegistration = (definition: JobDefinition): RegistrationPlan =>
  Object.freeze({
    job_definition_id: definition.id,
    schedule_id: definition.schedule.schedule_id,
    intent: definition.schedule.enabled ? "register" : "unregister",
    capability_surface: definition.policy.capability_surface,
    state: "pending",
  })

/**
 * Plan startup re-registration for a batch of rehydrated definitions. Every
 * definition yields a plan; enabled ones intend `register`, disabled ones
 * `unregister`, so a caller can drive the adapter idempotently and compensate
 * stale registrations without claiming past execution (FR3, C5, AC2).
 */
export const planStartupRegistrations = (
  definitions: readonly JobDefinition[],
): readonly RegistrationPlan[] => definitions.map(planRegistration)

/**
 * Build the occurrence idempotency tuple `(job_definition_id, schedule_id,
 * nominal_due_time, generation)` (FR10, C6). Duplicate delivery for one tuple
 * resolves to a single execution (see `OccurrenceStateMachine.resolveDuplicate`).
 * `generation` is executor-owned and merely carried here. Pure.
 */
export const buildIdempotencyKey = (
  jobDefinitionId: JobDefinitionId,
  scheduleId: ScheduleId,
  nominalDueTime: NominalDueTime,
  generation: Generation,
): IdempotencyKey =>
  Object.freeze({
    job_definition_id: jobDefinitionId,
    schedule_id: scheduleId,
    nominal_due_time: nominalDueTime,
    generation,
  })

/**
 * Schedule lag from the nominal due instant to the observed trigger instant,
 * clamped non-negative (FR19, AC3, AC4). Delegates to the cron domain so lag is
 * measured identically everywhere. Pure.
 */
export const measureScheduleLagMs = (nominalMs: number, observedMs: number): number =>
  Cron.scheduleLagMs(nominalMs, observedMs)
