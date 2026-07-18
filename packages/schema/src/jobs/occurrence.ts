export * as Occurrence from "./occurrence"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { Schedule } from "./schedule"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/jobs/occurrence.cue and occurrence-parts.cue (package
// jobs.occurrence) one-to-one. JobOccurrence is one logical trigger occurrence
// that executes as a canonical Feature 002 Task Process (FR8, FR10, C6, C16). The
// idempotency identity is the tuple (job_definition_id, schedule_id,
// nominal_due_time, generation); duplicate delivery resolves to a single
// execution with an observable duplicate_of outcome (FR10, AC6).
// Sequence/attempt/generation authority belongs to the Feature 002 executor,
// never the scheduler or a projection (C6). Each executable occurrence owns
// exactly one Feature 002 Todo and its own Feature 005 OutputGroup (FR8, FR8a,
// C14, C15).

// IdempotencyKey is the (definition, schedule, nominal_due_time, generation) tuple (FR10, C6).
export const IdempotencyKey = Schema.Struct({
  job_definition_id: Ids.JobDefinitionId,
  schedule_id: Ids.ScheduleId,
  nominal_due_time: Schedule.NominalDueTime,
  generation: Values.Generation,
}).annotate({ identifier: "JobsOccurrence.IdempotencyKey" })
export type IdempotencyKey = Schema.Schema.Type<typeof IdempotencyKey>

// OccurrenceLineage carries correlation/causation and session/root/process identity (FR10, FR12).
export const OccurrenceLineage = Schema.Struct({
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
  session_id: Schema.NullOr(Ids.SessionId),
  root_session_id: Ids.RootSessionId,
  process_id: Schema.NullOr(Ids.ProcessId),
}).annotate({ identifier: "JobsOccurrence.OccurrenceLineage" })
export type OccurrenceLineage = Schema.Schema.Type<typeof OccurrenceLineage>

// OccurrenceExecution carries executor-owned attempt/generation/sequence and owned work refs (FR8, FR8a).
export const OccurrenceExecution = Schema.Struct({
  attempt: Values.Attempt,
  generation: Values.Generation,
  sequence: Values.Sequence,
  todo_ref: Schema.NullOr(Correlation.TodoRef),
  output_ref: Schema.NullOr(Correlation.OutputRef),
}).annotate({ identifier: "JobsOccurrence.OccurrenceExecution" })
export type OccurrenceExecution = Schema.Schema.Type<typeof OccurrenceExecution>

// OccurrenceStatus carries the state-machine state, reason, lag, duplicate resolution and timestamps (C6).
export const OccurrenceStatus = Schema.Struct({
  state: Enums.OccurrenceState,
  reason: TextValues.Reason,
  schedule_lag_ms: Values.ScheduleLagMs,
  duplicate_of: Schema.NullOr(Ids.OccurrenceId),
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  terminal_at: Schema.NullOr(DateTimeUtcFromMillis),
}).annotate({ identifier: "JobsOccurrence.OccurrenceStatus" })
export type OccurrenceStatus = Schema.Schema.Type<typeof OccurrenceStatus>

// JobOccurrence is the aggregate root of a trigger occurrence; id is occurrence_id (FR1, FR10).
export const JobOccurrence = Schema.Struct({
  id: Ids.OccurrenceId,
  idempotency: IdempotencyKey,
  lineage: OccurrenceLineage,
  execution: OccurrenceExecution,
  status: OccurrenceStatus,
}).annotate({ identifier: "JobsOccurrence.JobOccurrence" })
export type JobOccurrence = Schema.Schema.Type<typeof JobOccurrence>
