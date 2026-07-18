/**
 * Feature 003 / T027 (S15) — live `JobsBackend` composition for the operator stack.
 *
 * Turns the committed Feature 003 application adapters into the un-audited
 * `JobsBackend` seam that `createJobsPort` (T027) consumes, following the
 * `createLifecycleDomainWiring` precedent in `operator/lifecycle/stack-wiring.ts`.
 * It is deliberately HONEST about what the operator `AppRuntime` can reach today:
 *
 *   - **Reachable and wired for real:** the durable read surface. `list` and
 *     `status` project the bounded, redacted `JobDefinitionSummary` from the real
 *     Config.Service durable authority through the reused `JobPersistence` (T022) —
 *     definition identity, schedule, policy, enabled flag, version, and the durable
 *     `registrationState` from the persisted `ScheduleRegistration`. No field is
 *     fabricated: `nextDueAt` and `lastOutcome` are the contract's nullable
 *     "not-yet-projected" values (a next-occurrence projection needs the Bun.cron
 *     adapter's clock; a last-outcome needs the occurrence-history projection).
 *
 *   - **Genuinely NOT reachable yet — typed error, never fabricated data
 *     (RESIDUAL, mirrors the Feature 002 cancel forced-abort gap):**
 *       * `show` / `history` require the `job.*` occurrence/notification-history
 *         projection over the EventV2 durable aggregate — not wired as a committed
 *         seam from the operator `AppRuntime`.
 *       * `watch` requires the live observation stream over the single EventV2
 *         authority — the bounded subscription is not composed here.
 *       * `create` / `update` / `reschedule` require the create-input → durable
 *         `JobDefinition` assembler (an `ActionTarget` and the policy/schedule
 *         normalization the flat operator input does not carry) — an unbuilt design
 *         decision, never invented here.
 *       * `enable` / `disable` / `delete` require the domain-version CAS bump paired
 *         with the compensating external Bun registration effect — the scheduler
 *         adapter is not reachable from the operator `AppRuntime` (same boundary as
 *         Feature 002's `SessionRunCoordinator` interrupt seam).
 *       * `runNow` creates a canonical Feature 002 Task Process through the executor
 *         seam, which the operator `AppRuntime` does not expose.
 *
 * Every unwired method returns the port's typed `JobsError`
 * (`unavailable` / `not_implemented`), so a caller always sees an honest capability
 * gap and never a false success. The recorded gap lives in
 * `doc/arch/sdd/003-.../tasks.md` (close-out Residuals note).
 */
export * as JobsBackendLive from "./backend-live"

import { Effect } from "effect"
import { JobPersistence } from "@/jobs/persistence"
import type { Definition } from "@opencode-ai/schema/jobs/definition"
import type { Ids } from "@opencode-ai/schema/jobs/ids"
import type {
  ActionType,
  JobDefinitionSummary,
  JobsError,
  JobsListInput,
  JobsListOutput,
  JobsStatusInput,
  JobsStatusOutput,
  MisfirePolicy,
  OverlapPolicy,
  RegistrationState,
} from "@opencode-ai/protocol/jobs/commands"
import type { JobsBackend } from "./jobs-port"

export interface LiveJobsBackendDeps {
  readonly persistence: JobPersistence.JobPersistence
}

/** A persistence error is surfaced as a typed, honest `unavailable` — never a false read. */
const unavailable = (reason: string): JobsError => ({ type: "unavailable", reason })

/** Methods whose backing seam is not reachable from the operator AppRuntime today (RESIDUAL). */
const NOT_IMPLEMENTED: JobsError = { type: "not_implemented" }

/**
 * Project a durable `JobDefinition` (+ its optional registration state) onto the
 * bounded, redacted operator summary. Secrets/payloads/paths never enter the view
 * (FR32, C15); `nextDueAt`/`lastOutcome` stay the contract's nullable
 * not-yet-projected values, never invented.
 */
function toSummary(
  persisted: JobPersistence.PersistedDefinition,
  registrationState: RegistrationState,
): JobDefinitionSummary {
  const def: Definition.JobDefinition = persisted.definition
  return {
    jobDefinitionId: def.id,
    name: def.identity.name,
    description: def.identity.description,
    enabled: def.schedule.enabled,
    schedule: {
      scheduleId: def.schedule.schedule_id,
      cronExpression: def.schedule.schedule.expression,
      ianaTimezone: def.schedule.schedule.timezone,
    },
    actionType: def.execution.action_type as unknown as ActionType,
    overlapPolicy: def.policy.overlap as OverlapPolicy,
    misfirePolicy: def.policy.misfire as MisfirePolicy,
    registrationState,
    nextDueAt: null,
    lastOutcome: null,
    version: def.identity.version,
    updatedAt: new Date(persisted.updatedAtMs).toISOString(),
  }
}

/** Resolve the durable registration state for a definition, defaulting to `unknown`. */
const registrationStateFor = (
  persistence: JobPersistence.JobPersistence,
  persisted: JobPersistence.PersistedDefinition,
): Effect.Effect<RegistrationState, JobsError> =>
  persistence
    .loadRegistration(persisted.definition.id, persisted.definition.schedule.schedule_id)
    .pipe(
      Effect.mapError((error) => unavailable(error.type)),
      Effect.map((registration) => (registration === null ? "unknown" : (registration.registration.state as RegistrationState))),
    )

/** True when the definition is in scope for a `jobs.list` scope filter (never hides on ambiguity). */
function inListScope(def: Definition.JobDefinition, input: JobsListInput): boolean {
  if (input.scope === "global") return true
  // project scope: a project-scoped definition matches its project ref; a global
  // definition is always visible from a project. Anything else is included so a
  // definition is never silently dropped from the operator's view.
  if (def.authorization.scope === "global") return true
  if (String(def.authorization.project_ref) === input.scopeId) return true
  return def.authorization.scope !== "project"
}

/**
 * Compose the live `JobsBackend` over the injected durable persistence. Reads are
 * honestly backed by Config.Service; every currently-unreachable method returns a
 * typed `JobsError` (RESIDUAL — see module header).
 */
export function createLiveJobsBackend(deps: LiveJobsBackendDeps): JobsBackend {
  const persistence = deps.persistence

  const list = (input: JobsListInput): Effect.Effect<JobsListOutput, JobsError> =>
    Effect.gen(function* () {
      const persisted = yield* persistence.listDefinitions().pipe(Effect.mapError((error) => unavailable(error.type)))
      const summaries: JobDefinitionSummary[] = []
      for (const entry of persisted) {
        if (!inListScope(entry.definition, input)) continue
        if (input.enabledOnly === true && entry.definition.schedule.enabled !== true) continue
        const registrationState = yield* registrationStateFor(persistence, entry)
        summaries.push(toSummary(entry, registrationState))
        if (summaries.length >= input.limit) break
      }
      return { definitions: summaries, cursor: null }
    })

  const status = (input: JobsStatusInput): Effect.Effect<JobsStatusOutput, JobsError> =>
    Effect.gen(function* () {
      const persisted = yield* persistence
        .loadDefinition(input.jobDefinitionId as Ids.JobDefinitionId)
        .pipe(Effect.mapError((error) => unavailable(error.type)))
      if (persisted === null) return yield* Effect.fail<JobsError>({ type: "not_found", jobDefinitionId: input.jobDefinitionId })
      const registrationState = yield* registrationStateFor(persistence, persisted)
      return { definition: toSummary(persisted, registrationState) }
    })

  return {
    list,
    status,
    // RESIDUAL: history/observation/executor seams not reachable from the operator
    // AppRuntime today — a typed capability gap, never fabricated data.
    show: () => Effect.fail(unavailable("occurrence history projection not wired")),
    history: () => Effect.fail(unavailable("occurrence/notification history projection not wired")),
    watch: () => Effect.fail(unavailable("live job.* observation stream not wired")),
    create: () => Effect.fail(NOT_IMPLEMENTED),
    update: () => Effect.fail(NOT_IMPLEMENTED),
    enable: () => Effect.fail(unavailable("enable/register effect not reachable from the operator runtime")),
    disable: () => Effect.fail(unavailable("disable/unregister effect not reachable from the operator runtime")),
    delete: () => Effect.fail(NOT_IMPLEMENTED),
    reschedule: () => Effect.fail(NOT_IMPLEMENTED),
    runNow: () => Effect.fail(unavailable("run-now requires the Feature 002 executor seam, not reachable from the operator runtime")),
  }
}
