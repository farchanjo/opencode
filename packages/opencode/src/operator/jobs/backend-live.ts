/**
 * Feature 003 / T027 (S15) — live `JobsBackend` composition for the operator stack,
 * carried to the Feature 014 `OperatorMutationPlan` commit contract (FR5) and the
 * config-backed persistence seam (T010, FR9).
 *
 * Reads and mutating verbs now ride the operator-side `OperatorJobPersistence`
 * (`./persistence.ts`) over the reused Config.Service authority `jobs`:
 *
 *   - **Reachable and wired for real (T010):** `list` / `status` / `show` project the
 *     bounded, redacted `JobDefinitionSummary` from the persisted operator job records,
 *     and `planCreate` / `planUpdate` / `planEnable` / `planDisable` / `planDelete` /
 *     `planReschedule` VALIDATE at plan time and return an `OperatorMutationPlan`
 *     (authority + pure transform) so `mutateAuthority` owns the single committed CAS
 *     write — the backend never self-commits, so a rejected mutation persists nothing.
 *     Secrets stay opaque references (FR11); a Config.Service outage degrades to a
 *     typed `unavailable` (FR14).
 *
 *   - **Genuinely NOT reachable yet — typed capability gap, never fabricated data
 *     (RESIDUAL, tracked by Feature 014 T011):**
 *       * `show`'s occurrence list / `history` require the `job.*` occurrence and
 *         notification-history projection over the EventV2 durable aggregate — not
 *         wired as a committed seam from the operator `AppRuntime`; the occurrence list
 *         stays honestly empty and `history` returns `unavailable`.
 *       * `watch` requires the live observation stream over the single EventV2
 *         authority — the bounded subscription is not composed here.
 *       * `planRunNow` creates a canonical Feature 002 Task Process through the
 *         executor seam, which the operator `AppRuntime` does not expose — a typed
 *         `unavailable` gap the T011 boundary documents in ADR-0014.
 *
 * Feature 007 stays the sole command-registration authority; this override adds no
 * command ids and makes ZERO provider/model calls, tokens, or cost (FR31, AC14).
 */
export * as JobsBackendLive from "./backend-live"

import { Effect } from "effect"
import { OperatorJobPersistence } from "./persistence"
import type { JobsError, OverlapPolicy } from "@opencode-ai/protocol/jobs/commands"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { JobsBackend } from "./jobs-port"
import type { JobOccurrenceProjection } from "./occurrence-projection"

/**
 * Feature 018 / Group B (T008, T009) — the run-now enqueue seam. The operator
 * backend loads the definition (typed `not_found`/`disabled`), then defers the
 * enqueue into the `OperatorMutationPlan.effect` so `mutateAuthority` runs it EXACTLY
 * ONCE after the contract/idempotency/CAS checks (no phantom write, no replay-rerun).
 * The composition root binds this to the eager executor's `enqueueImmediate` seam.
 */
export interface RunNowEnqueueRequest {
  readonly jobDefinitionId: string
  readonly scheduleId: string
  readonly overlapPolicy: OverlapPolicy
}

/** The honest run-now outcome (`runnow.cue #RunNowResult`); never a fabricated occurrence. */
export type RunNowEnqueueResult =
  | { readonly outcome: "enqueued"; readonly occurrenceId: string }
  | { readonly outcome: "overlap_rejected"; readonly reason: string }
  | { readonly outcome: "executor_unavailable"; readonly reason: string }

export type RunNowEnqueuePort = (request: RunNowEnqueueRequest) => Promise<RunNowEnqueueResult>

export interface LiveJobsBackendDeps {
  readonly persistence: OperatorJobPersistence.OperatorJobPersistence
  /**
   * Feature 017 / T015 — the occurrence projection over the durable `EventV2Bridge`
   * seam (GAP F). When bound, `history` / `show`'s occurrence list / `watch` project
   * the real `job.*` durable events; when unset they stay the typed capability gap.
   */
  readonly occurrences?: JobOccurrenceProjection.JobOccurrenceProjection
  /**
   * Feature 018 / T008 — the eager executor's `enqueueImmediate` seam. When bound,
   * `planRunNow` converts from the typed gap to an effectful mutation plan; when
   * unset it stays the honest `unavailable` capability gap (never fabricated).
   */
  readonly runNow?: RunNowEnqueuePort
}

/** A persistence error is surfaced as a typed, honest `unavailable` — never a false read. */
const unavailable = (reason: string): JobsError => ({ type: "unavailable", reason })

/**
 * Compose the live `JobsBackend` over the injected operator persistence. Reads and
 * mutation plans are honestly backed by Config.Service; the occurrence/notification
 * history projection, the observation stream, and the Feature 002 executor seam stay
 * typed capability gaps (RESIDUAL — see module header and T011).
 */
export function createLiveJobsBackend(deps: LiveJobsBackendDeps): JobsBackend {
  const persistence = deps.persistence
  const occurrences = deps.occurrences
  const runNow = deps.runNow

  /**
   * Feature 018 / T008, T009 — convert `jobs.run-now` to an effectful mutation plan.
   * Loads the definition at PLAN time (typed `not_found`; a disabled definition is a
   * typed `invalid_argument` — never a fabricated occurrence), then defers the enqueue
   * into `effect` so `mutateAuthority` runs it exactly once after the CAS/idempotency
   * checks. `apply` is identity — run-now records no definition mutation, so a
   * rejected enqueue (overlap/disarmed) commits nothing (no phantom write, FR7).
   */
  const planRunNow = (input: { readonly jobDefinitionId: string }): Effect.Effect<OperatorMutationPlan, JobsError> =>
    Effect.gen(function* () {
      const { definition } = yield* persistence.status({ jobDefinitionId: input.jobDefinitionId })
      if (!definition.enabled) {
        return yield* Effect.fail<JobsError>({ type: "invalid_argument", field: "jobDefinitionId", reason: "definition is disabled" })
      }
      const request: RunNowEnqueueRequest = {
        jobDefinitionId: definition.jobDefinitionId,
        scheduleId: definition.schedule.scheduleId,
        overlapPolicy: definition.overlapPolicy,
      }
      const plan: OperatorMutationPlan = {
        authority: OperatorJobPersistence.AUTHORITY,
        // Identity: run-now mutates no definition record — the settled token rides
        // the `jobs` authority the effect commits through, without rewriting the doc.
        apply: (current) => current ?? { definitions: {} },
        effect: async () => {
          const outcome = await runNow!(request)
          if (outcome.outcome === "enqueued") return { ok: true, value: { occurrenceId: outcome.occurrenceId } }
          if (outcome.outcome === "overlap_rejected") return { ok: false, code: "conflict", message: outcome.reason }
          return { ok: false, code: "unavailable", message: outcome.reason }
        },
      }
      return plan
    })

  return {
    list: persistence.list,
    status: persistence.status,
    // Feature 017 / T015 — the definition read is honestly persisted; its occurrence
    // list projects the durable `job.*` events over the EventV2Bridge seam when the
    // projection is bound, else stays an honest empty list (FR11).
    show: (input) =>
      Effect.gen(function* () {
        const base = yield* persistence.show(input)
        if (occurrences === undefined) return base
        const list = yield* occurrences.showOccurrences(input.jobDefinitionId, input.occurrenceLimit)
        return { ...base, occurrences: list }
      }),
    // Feature 017 / T015 — history/watch project the durable occurrence events over
    // the same EventV2Bridge seam the lifecycle domain uses; an unbound bridge (no
    // projection) stays a typed capability gap, never fabricated (FR11, FR12).
    history: occurrences
      ? occurrences.history
      : () => Effect.fail(unavailable("occurrence/notification history projection not wired")),
    watch: occurrences
      ? occurrences.watch
      : () => Effect.fail(unavailable("live job.* observation stream not wired")),
    planCreate: persistence.planCreate,
    planUpdate: persistence.planUpdate,
    planEnable: persistence.planEnable,
    planDisable: persistence.planDisable,
    planDelete: persistence.planDelete,
    planReschedule: persistence.planReschedule,
    // Feature 018 / T008 — run-now converts to an effectful mutation plan once the
    // eager executor's `enqueueImmediate` seam is bound; an unbound executor stays
    // the honest typed gap (never a fabricated occurrence).
    planRunNow: runNow
      ? planRunNow
      : () => Effect.fail(unavailable("run-now requires the Feature 002 executor seam, not reachable from the operator runtime")),
  }
}
