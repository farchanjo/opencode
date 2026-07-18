// Pure text-first projections for a Job Definition's occurrence and
// notification history (Feature 003 / T030, FR30, C12). No I/O, no solid-js —
// mirrors packages/tui/src/routes/session/process-panel/card.ts's
// text-derivation style.
//
// Source of truth for both row shapes: the committed
// `@opencode-ai/protocol/jobs/commands` `Occurrence`/`NotificationEnvelope` —
// the redacted, bounded Feature 007 operator-surface projections (never the
// durable schema records, and never a resolved `NotificationEnvelope.summary`
// beyond the bounded string the backend already produced; this module does
// not fabricate or expand it).

import type { Occurrence, NotificationEnvelope } from "@opencode-ai/protocol/jobs/commands"

export interface OccurrenceRowView {
  readonly occurrenceId: string
  readonly nominalDueAtText: string
  readonly stateText: string
  readonly outcomeText: string
  readonly attemptText: string
  readonly processText: string
}

export interface NotificationRowView {
  readonly notificationId: string
  readonly typeText: string
  readonly priorityText: string
  readonly summaryText: string
  readonly deliveryStateText: string
  readonly ackStateText: string
  readonly createdAtText: string
  readonly expiresAtText: string
}

function attemptText(attempt: Occurrence["attempt"]): string {
  return attempt === null ? "not attempted" : `attempt ${attempt}`
}

function processText(processId: Occurrence["processId"]): string {
  return processId ?? "no process yet"
}

/** Derive the bounded, redacted row view for one occurrence (FR10, C6). */
export function deriveOccurrenceRowView(occurrence: Occurrence): OccurrenceRowView {
  return {
    occurrenceId: occurrence.occurrenceId,
    nominalDueAtText: occurrence.nominalDueTime,
    stateText: occurrence.state,
    outcomeText: occurrence.outcome ?? "not settled",
    attemptText: attemptText(occurrence.attempt),
    processText: processText(occurrence.processId),
  }
}

/** Derive the bounded, redacted row view for one notification (FR22, C15). */
export function deriveNotificationRowView(notification: NotificationEnvelope): NotificationRowView {
  return {
    notificationId: notification.notificationId,
    typeText: notification.type,
    priorityText: notification.priority,
    summaryText: notification.summary,
    deliveryStateText: notification.deliveryState,
    ackStateText: notification.ackState,
    createdAtText: notification.createdAt,
    expiresAtText: notification.expiresAt,
  }
}

export * as JobsHistory from "./history"
