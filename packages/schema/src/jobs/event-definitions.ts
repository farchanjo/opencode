export * as EventDefinitions from "./event-definitions"

import type { Definition } from "../event"
import { Event } from "../event"
import { EventsDurable } from "./events-durable"
import { EventsLive } from "./events-live"
import { Ids } from "./ids"

// Feature 003 / T010 — one `EventV2.define` Definition per job.* member (FR11),
// mirroring the Feature 001/002 pattern (`dataFields(Member.fields)`, no raw
// tagged union wired to the bus; C8).
//
// Defined at the SCHEMA layer (not `packages/core/src/jobs/event-bus.ts`)
// because the twenty-three durable members must be joinable into the canonical
// `Durable` inventory in `durable-event-manifest.ts` (T018), and the schema
// package can never depend on `packages/core` (core depends on schema, never the
// reverse). `event-bus.ts` (T017) re-exports these Definitions for the domain
// engine; there is exactly one copy of the wire shape per member (C8).
//
// Durable-aggregate wiring (C8): `packages/core/src/event.ts` reads the aggregate
// id from a TOP-LEVEL key on the published `data` object named by
// `durable.aggregate` — mirroring the existing top-level aggregate field
// convention. Every durable member's schema therefore carries an explicit
// top-level `root_session_id` field in addition to the nested `envelope`/`detail`
// payload; `envelope.tree.root_session_id` stays the single source of truth and
// the publish boundary (T018) projects it onto the top-level key (no duplicated
// authority).
//
// The durable/live split follows the contract arrays
// DURABLE_JOB_EVENT_TYPES / LIVE_JOB_EVENT_TYPES in contracts/ports.ts.

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const DURABLE = { version: 1, aggregate: "root_session_id" } as const

// --- Durable members (twenty-three; C8) ---------------------------------------

export const JobDefinitionCreatedDefinition = Event.define({
  type: "job.definition_created",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobDefinitionCreatedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobDefinitionUpdatedDefinition = Event.define({
  type: "job.definition_updated",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobDefinitionUpdatedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobDefinitionEnabledDefinition = Event.define({
  type: "job.definition_enabled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobDefinitionEnabledEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobDefinitionDisabledDefinition = Event.define({
  type: "job.definition_disabled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobDefinitionDisabledEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobDefinitionDeletedDefinition = Event.define({
  type: "job.definition_deleted",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobDefinitionDeletedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobRegisteredDefinition = Event.define({
  type: "job.registered",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobRegisteredEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobUnregisteredDefinition = Event.define({
  type: "job.unregistered",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobUnregisteredEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobRescheduledDefinition = Event.define({
  type: "job.rescheduled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobRescheduledEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobOccurrenceClaimedDefinition = Event.define({
  type: "job.occurrence_claimed",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobOccurrenceClaimedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobTriggeredDefinition = Event.define({
  type: "job.triggered",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobTriggeredEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobAdmittedDefinition = Event.define({
  type: "job.admitted",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobAdmittedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobExecutionStartedDefinition = Event.define({
  type: "job.execution_started",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobExecutionStartedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobExecutionCompletedDefinition = Event.define({
  type: "job.execution_completed",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobExecutionCompletedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobExecutionFailedDefinition = Event.define({
  type: "job.execution_failed",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobExecutionFailedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobExecutionCancelledDefinition = Event.define({
  type: "job.execution_cancelled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobExecutionCancelledEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobExecutionTimedOutDefinition = Event.define({
  type: "job.execution_timed_out",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobExecutionTimedOutEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobOverlapRejectedDefinition = Event.define({
  type: "job.overlap_rejected",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobOverlapRejectedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobOverlapReplacedDefinition = Event.define({
  type: "job.overlap_replaced",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobOverlapReplacedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobNotificationEnqueuedDefinition = Event.define({
  type: "job.notification_enqueued",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobNotificationEnqueuedEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobNotificationAcknowledgedDefinition = Event.define({
  type: "job.notification_acknowledged",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsDurable.JobNotificationAcknowledgedEvent.fields),
    root_session_id: Ids.RootSessionId,
  },
})
export const JobNotificationExpiredDefinition = Event.define({
  type: "job.notification_expired",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobNotificationExpiredEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobReconciledDefinition = Event.define({
  type: "job.reconciled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobReconciledEvent.fields), root_session_id: Ids.RootSessionId },
})
export const JobUnknownDefinition = Event.define({
  type: "job.unknown",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.JobUnknownEvent.fields), root_session_id: Ids.RootSessionId },
})

/** The twenty-three durable member Definitions, in vocabulary order (C8). */
export const DurableDefinitions: ReadonlyArray<Definition> = [
  JobDefinitionCreatedDefinition,
  JobDefinitionUpdatedDefinition,
  JobDefinitionEnabledDefinition,
  JobDefinitionDisabledDefinition,
  JobDefinitionDeletedDefinition,
  JobRegisteredDefinition,
  JobUnregisteredDefinition,
  JobRescheduledDefinition,
  JobOccurrenceClaimedDefinition,
  JobTriggeredDefinition,
  JobAdmittedDefinition,
  JobExecutionStartedDefinition,
  JobExecutionCompletedDefinition,
  JobExecutionFailedDefinition,
  JobExecutionCancelledDefinition,
  JobExecutionTimedOutDefinition,
  JobOverlapRejectedDefinition,
  JobOverlapReplacedDefinition,
  JobNotificationEnqueuedDefinition,
  JobNotificationAcknowledgedDefinition,
  JobNotificationExpiredDefinition,
  JobReconciledDefinition,
  JobUnknownDefinition,
]

// --- Live members (seven; C8) -------------------------------------------------

export const JobTriggerDueDefinition = Event.define({
  type: "job.trigger_due",
  schema: dataFields(EventsLive.JobTriggerDueEvent.fields),
})
export const JobMisfiredDefinition = Event.define({
  type: "job.misfired",
  schema: dataFields(EventsLive.JobMisfiredEvent.fields),
})
export const JobSkippedDefinition = Event.define({
  type: "job.skipped",
  schema: dataFields(EventsLive.JobSkippedEvent.fields),
})
export const JobCoalescedDefinition = Event.define({
  type: "job.coalesced",
  schema: dataFields(EventsLive.JobCoalescedEvent.fields),
})
export const JobQueuedDefinition = Event.define({
  type: "job.queued",
  schema: dataFields(EventsLive.JobQueuedEvent.fields),
})
export const JobNotificationDeliveredDefinition = Event.define({
  type: "job.notification_delivered",
  schema: dataFields(EventsLive.JobNotificationDeliveredEvent.fields),
})
export const JobRetryScheduledDefinition = Event.define({
  type: "job.retry_scheduled",
  schema: dataFields(EventsLive.JobRetryScheduledEvent.fields),
})

/** The seven live member Definitions, in vocabulary order (C8). */
export const LiveDefinitions: ReadonlyArray<Definition> = [
  JobTriggerDueDefinition,
  JobMisfiredDefinition,
  JobSkippedDefinition,
  JobCoalescedDefinition,
  JobQueuedDefinition,
  JobNotificationDeliveredDefinition,
  JobRetryScheduledDefinition,
]

/** All thirty job.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = [...DurableDefinitions, ...LiveDefinitions]

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = new Map(
  Definitions.map((definition) => [definition.type, definition]),
)
