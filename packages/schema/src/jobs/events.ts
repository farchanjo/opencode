export * as Events from "./events"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Envelope } from "./envelope"
import { EnumsNotification } from "./enums-notification"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/jobs/events.cue, events-definition.cue,
// events-occurrence.cue, events-execution.cue and events-notification.cue
// (package jobs.events) one-to-one — the closed 30-member JobEvent tagged union
// plus the cohesive detail sub-objects distinct members carry (FR11, FR12).
// Definition-mutation, registration, misfire, overlap, execution-terminal,
// retry, notification and reconciliation stay distinct semantic events and are
// never collapsed into a generic status update (FR11).
//
// AUTHORITATIVE MODULE: every detail sub-object, all 30 member Structs, and the
// JobEvent union are defined here. events-durable.ts and events-live.ts
// re-export the durable/live member subsets (with grouping arrays for the bus
// layer, T017). Defining members in the split files while the union stays here
// would force an ESM circular initialization — the union needs the members and
// the members need these details — so the details and members share this one
// module and the split files are cycle-free re-export views (mirrors the Feature
// 002 lifecycle/events.ts pattern).
//
// Mirroring Feature 001/002, each member is registered as its own EventV2.define
// Definition on the EventV2Bridge (dataFields(Member.fields)); no raw tagged
// union is wired to the bus (C8). Durable members carry the EventV2
// durable {version, aggregate: "root_session_id"} annotation; live members omit
// it (C8, see event-definitions.ts).

// --- events.cue: detail sub-objects -------------------------------------------

// DefinitionDetail carries the definition CAS version and scope for a mutation event (FR2, C12).
export const DefinitionDetail = Schema.Struct({
  version: Values.Version,
  scope: Enums.Scope,
}).annotate({ identifier: "JobsEvent.DefinitionDetail" })
export type DefinitionDetail = Schema.Schema.Type<typeof DefinitionDetail>

// RegistrationDetail carries registration state, intent and capability surface (FR6, C5).
export const RegistrationDetail = Schema.Struct({
  state: Enums.RegistrationState,
  intent: Enums.RegistrationIntent,
  capability_surface: Enums.CapabilitySurface,
}).annotate({ identifier: "JobsEvent.RegistrationDetail" })
export type RegistrationDetail = Schema.Schema.Type<typeof RegistrationDetail>

// TriggerDetail carries schedule lag measured from nominal due time (FR19, AC3, AC4).
export const TriggerDetail = Schema.Struct({
  schedule_lag_ms: Values.ScheduleLagMs,
}).annotate({ identifier: "JobsEvent.TriggerDetail" })
export type TriggerDetail = Schema.Schema.Type<typeof TriggerDetail>

// MisfireDetail carries the applied misfire policy and its resulting outcome (FR15, C19).
export const MisfireDetail = Schema.Struct({
  policy: Enums.MisfirePolicy,
  outcome: Enums.OccurrenceState,
}).annotate({ identifier: "JobsEvent.MisfireDetail" })
export type MisfireDetail = Schema.Schema.Type<typeof MisfireDetail>

// OverlapDetail carries the applied overlap policy and its resulting outcome (FR16, C3).
export const OverlapDetail = Schema.Struct({
  policy: Enums.OverlapPolicy,
  outcome: Enums.OccurrenceState,
}).annotate({ identifier: "JobsEvent.OverlapDetail" })
export type OverlapDetail = Schema.Schema.Type<typeof OverlapDetail>

// ExecutionDetail carries the terminal occurrence outcome and a bounded reason (FR11, C6).
export const ExecutionDetail = Schema.Struct({
  outcome: Enums.OccurrenceState,
  reason: TextValues.Reason,
}).annotate({ identifier: "JobsEvent.ExecutionDetail" })
export type ExecutionDetail = Schema.Schema.Type<typeof ExecutionDetail>

// RetryDetail carries the retry budget and a bounded reason; no blind mutation retry (FR14, C11).
export const RetryDetail = Schema.Struct({
  retry_budget: Values.RetryBudget,
  reason: TextValues.Reason,
}).annotate({ identifier: "JobsEvent.RetryDetail" })
export type RetryDetail = Schema.Schema.Type<typeof RetryDetail>

// NotificationDetail carries the notification delivery and ack state (FR22, C9).
export const NotificationDetail = Schema.Struct({
  delivery_state: EnumsNotification.DeliveryState,
  ack_state: EnumsNotification.AckState,
}).annotate({ identifier: "JobsEvent.NotificationDetail" })
export type NotificationDetail = Schema.Schema.Type<typeof NotificationDetail>

// ReconcileDetail carries the reconciliation outcome and prior schema version (FR14, C5).
export const ReconcileDetail = Schema.Struct({
  outcome: Enums.ReconcileOutcome,
  from_version: Values.SchemaVersion,
}).annotate({ identifier: "JobsEvent.ReconcileDetail" })
export type ReconcileDetail = Schema.Schema.Type<typeof ReconcileDetail>

// --- events-definition.cue: durable definition-mutation and registration members

// definition_created — a durable Job Definition was created under CAS (FR2, C12).
export const JobDefinitionCreatedEvent = Schema.Struct({
  type: Schema.Literal("job.definition_created"),
  envelope: Envelope.JobEnvelope,
  detail: DefinitionDetail,
}).annotate({ identifier: "JobsEvent.JobDefinitionCreatedEvent" })
export type JobDefinitionCreatedEvent = Schema.Schema.Type<typeof JobDefinitionCreatedEvent>

// definition_updated — a definition was updated under version/CAS (FR6).
export const JobDefinitionUpdatedEvent = Schema.Struct({
  type: Schema.Literal("job.definition_updated"),
  envelope: Envelope.JobEnvelope,
  detail: DefinitionDetail,
}).annotate({ identifier: "JobsEvent.JobDefinitionUpdatedEvent" })
export type JobDefinitionUpdatedEvent = Schema.Schema.Type<typeof JobDefinitionUpdatedEvent>

// definition_enabled — a definition was enabled and eligible for registration (FR6).
export const JobDefinitionEnabledEvent = Schema.Struct({
  type: Schema.Literal("job.definition_enabled"),
  envelope: Envelope.JobEnvelope,
  detail: DefinitionDetail,
}).annotate({ identifier: "JobsEvent.JobDefinitionEnabledEvent" })
export type JobDefinitionEnabledEvent = Schema.Schema.Type<typeof JobDefinitionEnabledEvent>

// definition_disabled — a definition was disabled without a silent kill (FR16, C17).
export const JobDefinitionDisabledEvent = Schema.Struct({
  type: Schema.Literal("job.definition_disabled"),
  envelope: Envelope.JobEnvelope,
  detail: DefinitionDetail,
}).annotate({ identifier: "JobsEvent.JobDefinitionDisabledEvent" })
export type JobDefinitionDisabledEvent = Schema.Schema.Type<typeof JobDefinitionDisabledEvent>

// definition_deleted — a definition was deleted with compensating unregister (FR6, C17).
export const JobDefinitionDeletedEvent = Schema.Struct({
  type: Schema.Literal("job.definition_deleted"),
  envelope: Envelope.JobEnvelope,
  detail: DefinitionDetail,
}).annotate({ identifier: "JobsEvent.JobDefinitionDeletedEvent" })
export type JobDefinitionDeletedEvent = Schema.Schema.Type<typeof JobDefinitionDeletedEvent>

// registered — the external Bun/OS registration effect settled registered (FR6, C5).
export const JobRegisteredEvent = Schema.Struct({
  type: Schema.Literal("job.registered"),
  envelope: Envelope.JobEnvelope,
  detail: RegistrationDetail,
}).annotate({ identifier: "JobsEvent.JobRegisteredEvent" })
export type JobRegisteredEvent = Schema.Schema.Type<typeof JobRegisteredEvent>

// unregistered — the registration was removed via compensation (FR6, C5).
export const JobUnregisteredEvent = Schema.Struct({
  type: Schema.Literal("job.unregistered"),
  envelope: Envelope.JobEnvelope,
  detail: RegistrationDetail,
}).annotate({ identifier: "JobsEvent.JobUnregisteredEvent" })
export type JobUnregisteredEvent = Schema.Schema.Type<typeof JobUnregisteredEvent>

// rescheduled — the schedule changed and re-registration intent was recorded (FR6).
export const JobRescheduledEvent = Schema.Struct({
  type: Schema.Literal("job.rescheduled"),
  envelope: Envelope.JobEnvelope,
  detail: RegistrationDetail,
}).annotate({ identifier: "JobsEvent.JobRescheduledEvent" })
export type JobRescheduledEvent = Schema.Schema.Type<typeof JobRescheduledEvent>

// --- events-occurrence.cue: occurrence-lifecycle members ----------------------

// trigger_due — the in-process Bun.cron callback fired; no polling (FR8, AC1).
export const JobTriggerDueEvent = Schema.Struct({
  type: Schema.Literal("job.trigger_due"),
  envelope: Envelope.JobEnvelope,
  detail: TriggerDetail,
}).annotate({ identifier: "JobsEvent.JobTriggerDueEvent" })
export type JobTriggerDueEvent = Schema.Schema.Type<typeof JobTriggerDueEvent>

// occurrence_claimed — the idempotency tuple was claimed for a single execution (FR10, C6).
export const JobOccurrenceClaimedEvent = Schema.Struct({
  type: Schema.Literal("job.occurrence_claimed"),
  envelope: Envelope.JobEnvelope,
}).annotate({ identifier: "JobsEvent.JobOccurrenceClaimedEvent" })
export type JobOccurrenceClaimedEvent = Schema.Schema.Type<typeof JobOccurrenceClaimedEvent>

// triggered — an occurrence was created before admission (FR8, C16).
export const JobTriggeredEvent = Schema.Struct({
  type: Schema.Literal("job.triggered"),
  envelope: Envelope.JobEnvelope,
}).annotate({ identifier: "JobsEvent.JobTriggeredEvent" })
export type JobTriggeredEvent = Schema.Schema.Type<typeof JobTriggeredEvent>

// misfired — a missed trigger resolved to an explicit misfire outcome (FR15, FR19, AC3).
export const JobMisfiredEvent = Schema.Struct({
  type: Schema.Literal("job.misfired"),
  envelope: Envelope.JobEnvelope,
  detail: MisfireDetail,
}).annotate({ identifier: "JobsEvent.JobMisfiredEvent" })
export type JobMisfiredEvent = Schema.Schema.Type<typeof JobMisfiredEvent>

// skipped — a missed trigger was skipped per the misfire policy (FR15, AC3).
export const JobSkippedEvent = Schema.Struct({
  type: Schema.Literal("job.skipped"),
  envelope: Envelope.JobEnvelope,
  detail: MisfireDetail,
}).annotate({ identifier: "JobsEvent.JobSkippedEvent" })
export type JobSkippedEvent = Schema.Schema.Type<typeof JobSkippedEvent>

// coalesced — missed triggers coalesced into one occurrence (FR15, C19).
export const JobCoalescedEvent = Schema.Struct({
  type: Schema.Literal("job.coalesced"),
  envelope: Envelope.JobEnvelope,
  detail: MisfireDetail,
}).annotate({ identifier: "JobsEvent.JobCoalescedEvent" })
export type JobCoalescedEvent = Schema.Schema.Type<typeof JobCoalescedEvent>

// queued — the occurrence was queued under Feature 002 admission backpressure (FR17, FR18).
export const JobQueuedEvent = Schema.Struct({
  type: Schema.Literal("job.queued"),
  envelope: Envelope.JobEnvelope,
}).annotate({ identifier: "JobsEvent.JobQueuedEvent" })
export type JobQueuedEvent = Schema.Schema.Type<typeof JobQueuedEvent>

// admitted — Feature 002 admission granted capacity for the occurrence (FR17, C16).
export const JobAdmittedEvent = Schema.Struct({
  type: Schema.Literal("job.admitted"),
  envelope: Envelope.JobEnvelope,
}).annotate({ identifier: "JobsEvent.JobAdmittedEvent" })
export type JobAdmittedEvent = Schema.Schema.Type<typeof JobAdmittedEvent>

// overlap_rejected — a new trigger was rejected under the forbid overlap policy (FR16, C3).
export const JobOverlapRejectedEvent = Schema.Struct({
  type: Schema.Literal("job.overlap_rejected"),
  envelope: Envelope.JobEnvelope,
  detail: OverlapDetail,
}).annotate({ identifier: "JobsEvent.JobOverlapRejectedEvent" })
export type JobOverlapRejectedEvent = Schema.Schema.Type<typeof JobOverlapRejectedEvent>

// overlap_replaced — a prior occurrence was replaced without a silent mutating kill (FR16, AC25).
export const JobOverlapReplacedEvent = Schema.Struct({
  type: Schema.Literal("job.overlap_replaced"),
  envelope: Envelope.JobEnvelope,
  detail: OverlapDetail,
}).annotate({ identifier: "JobsEvent.JobOverlapReplacedEvent" })
export type JobOverlapReplacedEvent = Schema.Schema.Type<typeof JobOverlapReplacedEvent>

// --- events-notification.cue: notification-lifecycle members ------------------

// notification_enqueued — a bounded, redacted notification was enqueued (FR22, C9).
export const JobNotificationEnqueuedEvent = Schema.Struct({
  type: Schema.Literal("job.notification_enqueued"),
  envelope: Envelope.JobEnvelope,
  detail: NotificationDetail,
}).annotate({ identifier: "JobsEvent.JobNotificationEnqueuedEvent" })
export type JobNotificationEnqueuedEvent = Schema.Schema.Type<typeof JobNotificationEnqueuedEvent>

// notification_delivered — the notification was delivered at a safe boundary (FR25, AC7).
export const JobNotificationDeliveredEvent = Schema.Struct({
  type: Schema.Literal("job.notification_delivered"),
  envelope: Envelope.JobEnvelope,
  detail: NotificationDetail,
}).annotate({ identifier: "JobsEvent.JobNotificationDeliveredEvent" })
export type JobNotificationDeliveredEvent = Schema.Schema.Type<typeof JobNotificationDeliveredEvent>

// notification_acknowledged — a delivered notification was acknowledged (FR22).
export const JobNotificationAcknowledgedEvent = Schema.Struct({
  type: Schema.Literal("job.notification_acknowledged"),
  envelope: Envelope.JobEnvelope,
  detail: NotificationDetail,
}).annotate({ identifier: "JobsEvent.JobNotificationAcknowledgedEvent" })
export type JobNotificationAcknowledgedEvent = Schema.Schema.Type<typeof JobNotificationAcknowledgedEvent>

// notification_expired — a notification reached TTL with no unbounded queue growth (FR25, AC8).
export const JobNotificationExpiredEvent = Schema.Struct({
  type: Schema.Literal("job.notification_expired"),
  envelope: Envelope.JobEnvelope,
  detail: NotificationDetail,
}).annotate({ identifier: "JobsEvent.JobNotificationExpiredEvent" })
export type JobNotificationExpiredEvent = Schema.Schema.Type<typeof JobNotificationExpiredEvent>

// --- events-execution.cue: execution-terminal and reconciliation members ------

// execution_started — the Feature 002 executor began the occurrence process (FR8, C16).
export const JobExecutionStartedEvent = Schema.Struct({
  type: Schema.Literal("job.execution_started"),
  envelope: Envelope.JobEnvelope,
}).annotate({ identifier: "JobsEvent.JobExecutionStartedEvent" })
export type JobExecutionStartedEvent = Schema.Schema.Type<typeof JobExecutionStartedEvent>

// execution_completed — the occurrence process completed; Feature 002 owns terminal (FR8a, C15).
export const JobExecutionCompletedEvent = Schema.Struct({
  type: Schema.Literal("job.execution_completed"),
  envelope: Envelope.JobEnvelope,
  detail: ExecutionDetail,
}).annotate({ identifier: "JobsEvent.JobExecutionCompletedEvent" })
export type JobExecutionCompletedEvent = Schema.Schema.Type<typeof JobExecutionCompletedEvent>

// execution_failed — the occurrence process failed with a bounded reason (FR11).
export const JobExecutionFailedEvent = Schema.Struct({
  type: Schema.Literal("job.execution_failed"),
  envelope: Envelope.JobEnvelope,
  detail: ExecutionDetail,
}).annotate({ identifier: "JobsEvent.JobExecutionFailedEvent" })
export type JobExecutionFailedEvent = Schema.Schema.Type<typeof JobExecutionFailedEvent>

// execution_cancelled — the occurrence was cancelled without touching the definition (FR16, AC27).
export const JobExecutionCancelledEvent = Schema.Struct({
  type: Schema.Literal("job.execution_cancelled"),
  envelope: Envelope.JobEnvelope,
  detail: ExecutionDetail,
}).annotate({ identifier: "JobsEvent.JobExecutionCancelledEvent" })
export type JobExecutionCancelledEvent = Schema.Schema.Type<typeof JobExecutionCancelledEvent>

// execution_timed_out — the occurrence exceeded its deadline/timeout (FR11, C11).
export const JobExecutionTimedOutEvent = Schema.Struct({
  type: Schema.Literal("job.execution_timed_out"),
  envelope: Envelope.JobEnvelope,
  detail: ExecutionDetail,
}).annotate({ identifier: "JobsEvent.JobExecutionTimedOutEvent" })
export type JobExecutionTimedOutEvent = Schema.Schema.Type<typeof JobExecutionTimedOutEvent>

// retry_scheduled — a retry was scheduled only under an explicit mutation-safe policy (FR14, C11).
export const JobRetryScheduledEvent = Schema.Struct({
  type: Schema.Literal("job.retry_scheduled"),
  envelope: Envelope.JobEnvelope,
  detail: RetryDetail,
}).annotate({ identifier: "JobsEvent.JobRetryScheduledEvent" })
export type JobRetryScheduledEvent = Schema.Schema.Type<typeof JobRetryScheduledEvent>

// reconciled — a versioned reconciliation settled a pending/unknown occurrence (FR14, C5).
export const JobReconciledEvent = Schema.Struct({
  type: Schema.Literal("job.reconciled"),
  envelope: Envelope.JobEnvelope,
  detail: ReconcileDetail,
}).annotate({ identifier: "JobsEvent.JobReconciledEvent" })
export type JobReconciledEvent = Schema.Schema.Type<typeof JobReconciledEvent>

// unknown — an occurrence entered the unknown state pending reconciliation (FR14, C7).
export const JobUnknownEvent = Schema.Struct({
  type: Schema.Literal("job.unknown"),
  envelope: Envelope.JobEnvelope,
}).annotate({ identifier: "JobsEvent.JobUnknownEvent" })
export type JobUnknownEvent = Schema.Schema.Type<typeof JobUnknownEvent>

// --- events.cue: the closed tagged union of every FR11 vocabulary member ------

// JobEvent is the closed 30-member tagged union discriminated on `type`.
export const JobEvent = Schema.Union([
  JobDefinitionCreatedEvent,
  JobDefinitionUpdatedEvent,
  JobDefinitionEnabledEvent,
  JobDefinitionDisabledEvent,
  JobDefinitionDeletedEvent,
  JobRegisteredEvent,
  JobUnregisteredEvent,
  JobRescheduledEvent,
  JobTriggerDueEvent,
  JobOccurrenceClaimedEvent,
  JobTriggeredEvent,
  JobMisfiredEvent,
  JobSkippedEvent,
  JobCoalescedEvent,
  JobQueuedEvent,
  JobAdmittedEvent,
  JobNotificationEnqueuedEvent,
  JobNotificationDeliveredEvent,
  JobNotificationAcknowledgedEvent,
  JobNotificationExpiredEvent,
  JobExecutionStartedEvent,
  JobExecutionCompletedEvent,
  JobExecutionFailedEvent,
  JobExecutionCancelledEvent,
  JobExecutionTimedOutEvent,
  JobRetryScheduledEvent,
  JobOverlapRejectedEvent,
  JobOverlapReplacedEvent,
  JobReconciledEvent,
  JobUnknownEvent,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "JobsEvent.JobEvent" })
export type JobEvent = Schema.Schema.Type<typeof JobEvent>
