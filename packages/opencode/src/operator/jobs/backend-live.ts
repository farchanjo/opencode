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
import type { JobsError } from "@opencode-ai/protocol/jobs/commands"
import type { JobsBackend } from "./jobs-port"

export interface LiveJobsBackendDeps {
  readonly persistence: OperatorJobPersistence.OperatorJobPersistence
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
  return {
    list: persistence.list,
    status: persistence.status,
    show: persistence.show,
    // RESIDUAL: occurrence/notification history + observation seams not reachable
    // from the operator AppRuntime today — a typed capability gap, never fabricated.
    history: () => Effect.fail(unavailable("occurrence/notification history projection not wired")),
    watch: () => Effect.fail(unavailable("live job.* observation stream not wired")),
    planCreate: persistence.planCreate,
    planUpdate: persistence.planUpdate,
    planEnable: persistence.planEnable,
    planDisable: persistence.planDisable,
    planDelete: persistence.planDelete,
    planReschedule: persistence.planReschedule,
    // T011: run-now requires the Feature 002 executor seam, not reachable from the
    // operator AppRuntime — a typed gap, never a fabricated occurrence.
    planRunNow: () => Effect.fail(unavailable("run-now requires the Feature 002 executor seam, not reachable from the operator runtime")),
  }
}
