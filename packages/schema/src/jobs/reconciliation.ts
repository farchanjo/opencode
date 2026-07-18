export * as Reconciliation from "./reconciliation"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/jobs/reconciliation.cue (package jobs.reconciliation)
// one-to-one. Registration state plus durable intent model the boundary between
// the persistent authority and the external Bun/OS effect (FR6, C5). Persistent
// transitions are atomic within their authority; the registration is an
// idempotent external effect paired with compensation, and no transaction spans
// Config.Service and the scheduler. Reconciliation is versioned and never
// re-executes an ambiguous mutation (FR14, AC19, AC23).

// AutoRetryDisabled is pinned false: reconciliation never re-executes effects (FR14, C11).
export const AutoRetryDisabled = Schema.Literal(false)
export type AutoRetryDisabled = typeof AutoRetryDisabled.Type

// ScheduleRegistration is the durable intent plus registration state for one schedule (FR6, C5).
export const ScheduleRegistration = Schema.Struct({
  job_definition_id: Ids.JobDefinitionId,
  schedule_id: Ids.ScheduleId,
  state: Enums.RegistrationState,
  intent: Enums.RegistrationIntent,
  capability_surface: Enums.CapabilitySurface,
  updated_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "JobsReconciliation.ScheduleRegistration" })
export type ScheduleRegistration = Schema.Schema.Type<typeof ScheduleRegistration>

// OccurrenceReconcile records a versioned occurrence reconciliation with no auto-retry (FR14, AC19).
export const OccurrenceReconcile = Schema.Struct({
  occurrence_id: Ids.OccurrenceId,
  outcome: Enums.ReconcileOutcome,
  from_version: Values.SchemaVersion,
  auto_retry: AutoRetryDisabled,
}).annotate({ identifier: "JobsReconciliation.OccurrenceReconcile" })
export type OccurrenceReconcile = Schema.Schema.Type<typeof OccurrenceReconcile>

// RegistrationReconcile records a startup registration reconciliation without a cross-system commit (AC23).
export const RegistrationReconcile = Schema.Struct({
  job_definition_id: Ids.JobDefinitionId,
  schedule_id: Ids.ScheduleId,
  outcome: Enums.ReconcileOutcome,
  from_state: Enums.RegistrationState,
  auto_retry: AutoRetryDisabled,
}).annotate({ identifier: "JobsReconciliation.RegistrationReconcile" })
export type RegistrationReconcile = Schema.Schema.Type<typeof RegistrationReconcile>
