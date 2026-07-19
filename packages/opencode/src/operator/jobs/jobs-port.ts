/**
 * Feature 003 / T027 (S15) — the typed `jobs.*` domain seam backing the Feature 007
 * operator control plane (C12, FR30–FR32), converted to the Feature 014
 * `OperatorMutationPlan` commit contract (FR5).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, the
 * reserved-name guard, AND the single committed mutation (`mutateAuthority`);
 * Feature 003 supplies ONLY this typed `JobsBackend` seam plus its bounded audit
 * events. This module registers NO command ids and makes ZERO provider/model calls,
 * tokens, or cost (FR31, AC14): reads project the bounded, redacted
 * `JobDefinitionSummary`/`Occurrence`/`NotificationEnvelope` views; every mutation
 * (`create`/`update`/`enable`/`disable`/`delete`/`reschedule`/`run-now`) VALIDATES
 * and returns an `OperatorMutationPlan` (authority + pure transform) so
 * `mutateAuthority` owns the one CAS write under the operator's version and emits the
 * Feature 007 audit correlation — the backend never self-commits. Where the durable
 * persistence / executor seam is not yet reachable, `planX` honestly degrades to the
 * typed `JobsError` (Feature 014 T010/T011 wire the real transforms), never a
 * fabricated success.
 *
 * The backend seams (`JobsBackend`) are the un-audited domain surface the
 * Feature 003 application adapters (`packages/opencode/src/jobs/**`: persistence
 * T022, trigger service T023, notification service T024, authorization T025)
 * collectively provide; the composition root injects the real implementations. This
 * module never resolves Feature 005 output content and never carries secrets/
 * payloads/paths in a view (FR32, C15). The bounded, secret-free operator access
 * audit is emitted at the command-port seam, which carries the Feature 007 principal
 * for every command (`jobs-command-port.ts`).
 */
export * as JobsOperatorPort from "./jobs-port"

import type { Effect, Scope, Stream } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  JobsCreateInput,
  JobsDeleteInput,
  JobsDisableInput,
  JobsEnableInput,
  JobsError,
  JobsHistoryInput,
  JobsHistoryOutput,
  JobsListInput,
  JobsListOutput,
  JobsRescheduleInput,
  JobsRunNowInput,
  JobsShowInput,
  JobsShowOutput,
  JobsStatusInput,
  JobsStatusOutput,
  JobsUpdateInput,
  JobsWatchEvent,
  JobsWatchInput,
} from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Audit sink (T027) — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a prompt/payload/path). */
export interface JobsAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "not_found" | "unauthorized" | "conflict"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface JobsAuditSink {
  readonly record: (event: JobsAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Backend seams — the un-audited domain surface (packages/opencode/src/jobs/**)
// =============================================================================

/**
 * The narrow domain seam the Feature 003 application adapters provide. Reads return
 * bounded redacted views; every mutation VALIDATES and returns an
 * `OperatorMutationPlan` (authority + pure transform) the dispatcher commits via
 * `mutateAuthority` — the backend never self-commits, and an unreachable seam
 * honestly degrades to a typed `JobsError`.
 */
export interface JobsBackend {
  readonly list: (input: JobsListInput) => Effect.Effect<JobsListOutput, JobsError>
  readonly status: (input: JobsStatusInput) => Effect.Effect<JobsStatusOutput, JobsError>
  readonly show: (input: JobsShowInput) => Effect.Effect<JobsShowOutput, JobsError>
  readonly history: (input: JobsHistoryInput) => Effect.Effect<JobsHistoryOutput, JobsError>
  readonly watch: (
    input: JobsWatchInput,
  ) => Effect.Effect<Stream.Stream<JobsWatchEvent, never>, JobsError, Scope.Scope>
  readonly planCreate: (input: JobsCreateInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planUpdate: (input: JobsUpdateInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planEnable: (input: JobsEnableInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planDisable: (input: JobsDisableInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planDelete: (input: JobsDeleteInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planReschedule: (input: JobsRescheduleInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planRunNow: (input: JobsRunNowInput) => Effect.Effect<OperatorMutationPlan, JobsError>
}
