export * as Notification from "./notification"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { EnumsNotification } from "./enums-notification"
import { Ids } from "./ids"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/jobs/notification.cue and notification-parts.cue
// (package jobs.notification) one-to-one. NotificationEnvelope is the bounded,
// redacted async notification carried over the single EventV2 authority and the
// Feature 002 observation seam; no second channel (FR20, FR22, C8). It is a
// ValueObject: notification_id is held as a value. It carries only a bounded
// summary and an opaque Feature 005 OutputRef, never full content, spool paths or
// unbounded payloads (FR22, C15, AC29). Cross-session/project leakage is rejected
// before delivery (FR21, C10, AC9).

// NotificationRouting carries event/occurrence/definition ids and the authorized target scope (FR21, FR22).
export const NotificationRouting = Schema.Struct({
  event_id: Ids.EventId,
  occurrence_id: Ids.OccurrenceId,
  job_definition_id: Ids.JobDefinitionId,
  target_root_session_id: Ids.RootSessionId,
  target_session_id: Schema.NullOr(Ids.SessionId),
}).annotate({ identifier: "JobsNotification.NotificationRouting" })
export type NotificationRouting = Schema.Schema.Type<typeof NotificationRouting>

// NotificationDescriptor carries source, type, priority and the default delivery action (FR22, FR24, C9).
export const NotificationDescriptor = Schema.Struct({
  source: EnumsNotification.NotificationSource,
  type: EnumsNotification.NotificationType,
  priority: EnumsNotification.NotificationPriority,
  action: EnumsNotification.DeliveryAction,
}).annotate({ identifier: "JobsNotification.NotificationDescriptor" })
export type NotificationDescriptor = Schema.Schema.Type<typeof NotificationDescriptor>

// NotificationTiming carries created/expiry timestamps and correlation/causation (FR22).
export const NotificationTiming = Schema.Struct({
  created_at: DateTimeUtcFromMillis,
  expiry_at: DateTimeUtcFromMillis,
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
}).annotate({ identifier: "JobsNotification.NotificationTiming" })
export type NotificationTiming = Schema.Schema.Type<typeof NotificationTiming>

// NotificationContent carries a bounded summary, redacted payload ref and opaque OutputRef only (FR22, C15).
export const NotificationContent = Schema.Struct({
  summary: TextValues.BoundedSummary,
  payload_ref: Schema.NullOr(Correlation.PayloadRef),
  output_ref: Schema.NullOr(Correlation.OutputRef),
}).annotate({ identifier: "JobsNotification.NotificationContent" })
export type NotificationContent = Schema.Schema.Type<typeof NotificationContent>

// NotificationState carries delivery/ack state, the safe-boundary flag and delivery/ack timestamps (FR25, C9).
export const NotificationState = Schema.Struct({
  delivery_state: EnumsNotification.DeliveryState,
  ack_state: EnumsNotification.AckState,
  safe_boundary: EnumsNotification.SafeBoundary,
  delivered_at: Schema.NullOr(DateTimeUtcFromMillis),
  acknowledged_at: Schema.NullOr(DateTimeUtcFromMillis),
}).annotate({ identifier: "JobsNotification.NotificationState" })
export type NotificationState = Schema.Schema.Type<typeof NotificationState>

// NotificationEnvelope is the bounded async notification for the main context (FR22, C15).
export const NotificationEnvelope = Schema.Struct({
  notification_id: Ids.NotificationId,
  routing: NotificationRouting,
  descriptor: NotificationDescriptor,
  timing: NotificationTiming,
  content: NotificationContent,
  state: NotificationState,
}).annotate({ identifier: "JobsNotification.NotificationEnvelope" })
export type NotificationEnvelope = Schema.Schema.Type<typeof NotificationEnvelope>
