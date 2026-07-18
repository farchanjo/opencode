export * as EventsLive from "./events-live"

import { Events } from "./events"

// Live-view of the job.* vocabulary — the seven live members (C8). Live members
// omit the durable annotation — no sequence, no replay; they are deltas and
// sampling/coalescing targets while terminal events stay durable (C19). The
// member Structs are authored in events.ts (the authoritative module); this
// module re-exports the live subset and provides a grouping array for the
// EventV2 bus layer, which registers each live member without a durable
// annotation (T017).
//
// The durable/live split follows the contract arrays
// DURABLE_JOB_EVENT_TYPES / LIVE_JOB_EVENT_TYPES in contracts/ports.ts (the
// authoritative machine-readable classification mirrored by
// @opencode-ai/protocol/jobs).

export const JobTriggerDueEvent = Events.JobTriggerDueEvent
export const JobMisfiredEvent = Events.JobMisfiredEvent
export const JobSkippedEvent = Events.JobSkippedEvent
export const JobCoalescedEvent = Events.JobCoalescedEvent
export const JobQueuedEvent = Events.JobQueuedEvent
export const JobNotificationDeliveredEvent = Events.JobNotificationDeliveredEvent
export const JobRetryScheduledEvent = Events.JobRetryScheduledEvent

// LiveMembers is the ordered set of all seven live member schemas. The bus layer
// maps each to its own EventV2.define Definition with no durable annotation (C8).
export const LiveMembers = [
  JobTriggerDueEvent,
  JobMisfiredEvent,
  JobSkippedEvent,
  JobCoalescedEvent,
  JobQueuedEvent,
  JobNotificationDeliveredEvent,
  JobRetryScheduledEvent,
] as const
