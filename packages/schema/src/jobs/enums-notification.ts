export * as EnumsNotification from "./enums-notification"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/enums-notification.cue (package jobs.enums) for
// the bounded, authorized async channel enums (FR20, FR22, FR24, C8, C9). The
// default action is operator-only; wake/queue/child are explicit, authorized,
// bounded and audited — never the default (C9).

// NotificationType classifies the occurrence signal a notification carries (FR22).
export const NotificationType = Schema.Literals([
  "occurrence_settled",
  "occurrence_failed",
  "occurrence_cancelled",
  "occurrence_timed_out",
  "misfire",
  "reconciled",
  "operator_advisory",
]).annotate({ identifier: "JobsEnums.NotificationType" })
export type NotificationType = typeof NotificationType.Type

// NotificationPriority is a bounded priority bucket; no high-cardinality label (C18).
export const NotificationPriority = Schema.Literals(["low", "normal", "high", "urgent"]).annotate({
  identifier: "JobsEnums.NotificationPriority",
})
export type NotificationPriority = typeof NotificationPriority.Type

// NotificationSource names the emitter of a notification (FR22).
export const NotificationSource = Schema.Literals(["scheduler", "executor", "reconciler", "operator"]).annotate({
  identifier: "JobsEnums.NotificationSource",
})
export type NotificationSource = typeof NotificationSource.Type

// DeliveryState is the notification delivery lifecycle at a safe boundary (FR25, C9).
export const DeliveryState = Schema.Literals(["enqueued", "queued", "coalesced", "delivered", "expired"]).annotate({
  identifier: "JobsEnums.DeliveryState",
})
export type DeliveryState = typeof DeliveryState.Type

// AckState records acknowledgement or TTL expiry of a delivered notification (FR22).
export const AckState = Schema.Literals(["unacknowledged", "acknowledged", "expired"]).annotate({
  identifier: "JobsEnums.AckState",
})
export type AckState = typeof AckState.Type

// DeliveryAction distinguishes operator-only from explicit wake/queue/child actions (FR24, C9).
export const DeliveryAction = Schema.Literals([
  "operator_only",
  "manager_wake",
  "input_queue",
  "child_session",
]).annotate({ identifier: "JobsEnums.DeliveryAction" })
export type DeliveryAction = typeof DeliveryAction.Type

// SafeBoundary flags whether delivery occurred at a safe active-turn boundary (FR25, AC7).
export const SafeBoundary = Schema.Literals(["safe", "unsafe"]).annotate({
  identifier: "JobsEnums.SafeBoundary",
})
export type SafeBoundary = typeof SafeBoundary.Type
