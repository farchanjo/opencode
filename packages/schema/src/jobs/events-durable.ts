export * as EventsDurable from "./events-durable"

import { Events } from "./events"

// Durable-view of the job.* vocabulary — the twenty-three durable members (C8).
// Durable members carry the EventV2 durable {version, aggregate: "root_session_id"}
// annotation and replay through readAggregate; definition mutations,
// registration/claim/execution checkpoints, terminal transitions, overlap
// outcomes, notification enqueue/ack/expiry, reconciliation and unknown are never
// coalesced or dropped. The member Structs are authored in events.ts (the
// authoritative module) to avoid an ESM circular initialization; this module
// re-exports the durable subset and provides a grouping array for the EventV2 bus
// layer (T017).
//
// The durable/live split follows the contract arrays
// DURABLE_JOB_EVENT_TYPES / LIVE_JOB_EVENT_TYPES in contracts/ports.ts (the
// authoritative machine-readable classification mirrored by
// @opencode-ai/protocol/jobs), so schema and protocol agree on every member's
// class.

// Definition-mutation and registration durable members (events-definition.cue).
export const JobDefinitionCreatedEvent = Events.JobDefinitionCreatedEvent
export const JobDefinitionUpdatedEvent = Events.JobDefinitionUpdatedEvent
export const JobDefinitionEnabledEvent = Events.JobDefinitionEnabledEvent
export const JobDefinitionDisabledEvent = Events.JobDefinitionDisabledEvent
export const JobDefinitionDeletedEvent = Events.JobDefinitionDeletedEvent
export const JobRegisteredEvent = Events.JobRegisteredEvent
export const JobUnregisteredEvent = Events.JobUnregisteredEvent
export const JobRescheduledEvent = Events.JobRescheduledEvent

// Occurrence-checkpoint and overlap durable members (events-occurrence.cue).
export const JobOccurrenceClaimedEvent = Events.JobOccurrenceClaimedEvent
export const JobTriggeredEvent = Events.JobTriggeredEvent
export const JobAdmittedEvent = Events.JobAdmittedEvent
export const JobOverlapRejectedEvent = Events.JobOverlapRejectedEvent
export const JobOverlapReplacedEvent = Events.JobOverlapReplacedEvent

// Notification durable members (events-notification.cue).
export const JobNotificationEnqueuedEvent = Events.JobNotificationEnqueuedEvent
export const JobNotificationAcknowledgedEvent = Events.JobNotificationAcknowledgedEvent
export const JobNotificationExpiredEvent = Events.JobNotificationExpiredEvent

// Execution-terminal and reconciliation durable members (events-execution.cue).
export const JobExecutionStartedEvent = Events.JobExecutionStartedEvent
export const JobExecutionCompletedEvent = Events.JobExecutionCompletedEvent
export const JobExecutionFailedEvent = Events.JobExecutionFailedEvent
export const JobExecutionCancelledEvent = Events.JobExecutionCancelledEvent
export const JobExecutionTimedOutEvent = Events.JobExecutionTimedOutEvent
export const JobReconciledEvent = Events.JobReconciledEvent
export const JobUnknownEvent = Events.JobUnknownEvent

// DurableMembers is the ordered set of all twenty-three durable member schemas.
// The bus layer maps each to its own EventV2.define Definition carrying the
// durable annotation (C8).
export const DurableMembers = [
  JobDefinitionCreatedEvent,
  JobDefinitionUpdatedEvent,
  JobDefinitionEnabledEvent,
  JobDefinitionDisabledEvent,
  JobDefinitionDeletedEvent,
  JobRegisteredEvent,
  JobUnregisteredEvent,
  JobRescheduledEvent,
  JobOccurrenceClaimedEvent,
  JobTriggeredEvent,
  JobAdmittedEvent,
  JobExecutionStartedEvent,
  JobExecutionCompletedEvent,
  JobExecutionFailedEvent,
  JobExecutionCancelledEvent,
  JobExecutionTimedOutEvent,
  JobOverlapRejectedEvent,
  JobOverlapReplacedEvent,
  JobNotificationEnqueuedEvent,
  JobNotificationAcknowledgedEvent,
  JobNotificationExpiredEvent,
  JobReconciledEvent,
  JobUnknownEvent,
] as const
