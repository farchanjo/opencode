export * as Envelope from "./envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { EventTypes } from "./event-types"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/jobs/envelope.cue and envelope-parts.cue (package
// jobs.envelope) one-to-one. The JobEnvelope is a ValueObject: the identifiable
// message is the job.* event member that carries it; the envelope holds only the
// EventV2-assigned event_id as a value (C8, FR12). Cohesive sub-objects keep
// every definition at most seven fields to stay within the calisthenics bound.
// Feature 002 per-aggregate ordering remains authoritative (FR12, C6).

// EventKind carries the event type, schema version, class, source, actor and visibility.
export const EventKind = Schema.Struct({
  event_type: EventTypes.JobEventType,
  schema_version: Values.SchemaVersion,
  event_class: Enums.EventClass,
  source: EnumsEvent.JobSource,
  actor_kind: EnumsEvent.ActorKind,
  visibility: EnumsEvent.Visibility,
}).annotate({ identifier: "JobsEnvelope.EventKind" })
export type EventKind = Schema.Schema.Type<typeof EventKind>

// OccurrenceIdentity carries definition/schedule/occurrence/process identity and
// attempt/generation. process_id is null before the Task Process associates (C16).
export const OccurrenceIdentity = Schema.Struct({
  job_definition_id: Ids.JobDefinitionId,
  schedule_id: Ids.ScheduleId,
  occurrence_id: Ids.OccurrenceId,
  process_id: Schema.NullOr(Ids.ProcessId),
  attempt: Values.Attempt,
  generation: Values.Generation,
}).annotate({ identifier: "JobsEnvelope.OccurrenceIdentity" })
export type OccurrenceIdentity = Schema.Schema.Type<typeof OccurrenceIdentity>

// TreeIdentity carries root-session and session identity.
export const TreeIdentity = Schema.Struct({
  root_session_id: Ids.RootSessionId,
  session_id: Schema.NullOr(Ids.SessionId),
}).annotate({ identifier: "JobsEnvelope.TreeIdentity" })
export type TreeIdentity = Schema.Schema.Type<typeof TreeIdentity>

// Ordering carries per-aggregate sequence, correlation and causation; sequence is
// per aggregate only, no global order is implied (FR10, FR12, C6).
export const Ordering = Schema.Struct({
  sequence: Values.Sequence,
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
}).annotate({ identifier: "JobsEnvelope.Ordering" })
export type Ordering = Schema.Schema.Type<typeof Ordering>

// Delivery carries visibility, timestamp and bounded redacted metadata. The
// metadata map holds no prompts, results, tool payloads, paths, or secrets (FR32).
export const Delivery = Schema.Struct({
  visibility: EnumsEvent.Visibility,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "JobsEnvelope.Delivery" })
export type Delivery = Schema.Schema.Type<typeof Delivery>

// JobEnvelope is the common context bundle carried on every job.* event (FR12).
export const JobEnvelope = Schema.Struct({
  event_id: Ids.EventId,
  kind: EventKind,
  occurrence: OccurrenceIdentity,
  tree: TreeIdentity,
  ordering: Ordering,
  delivery: Delivery,
}).annotate({ identifier: "JobsEnvelope.JobEnvelope" })
export type JobEnvelope = Schema.Schema.Type<typeof JobEnvelope>
