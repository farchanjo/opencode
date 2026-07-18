// Pure signal-and-projection layer for the Jobs panel (Feature 003 / T030,
// FR30, C12). No I/O, no solid-js — safe to recompute on every render,
// mirroring packages/tui/src/routes/session/process-panel/state.ts (Feature
// 002 T036).

import type { JobDefinitionSummary, Occurrence, NotificationEnvelope } from "@opencode-ai/protocol/jobs/commands"
import { deriveDefinitionCardView, type JobDefinitionCardView } from "./card"
import { deriveNotificationRowView, deriveOccurrenceRowView, type NotificationRowView, type OccurrenceRowView } from "./history"

/**
 * Raw jobs signal the caller assembles from the Feature 007 registry's
 * `JobsPort` reads (`list`/`show`/`history`). Every field here is already the
 * bounded, redacted, versioned operator-surface projection — this module
 * never widens or resolves anything further.
 */
export interface JobsPanelSignal {
  readonly definitions: readonly JobDefinitionSummary[]
  readonly occurrences: readonly Occurrence[]
  readonly notifications: readonly NotificationEnvelope[]
}

/**
 * Safe default: no definitions, no occurrences, no notifications. Used until
 * a live `JobsPort` source is wired into this component; the panel renders
 * nothing rather than inventing rows. See
 * ../../routes/session/process-panel/state.ts's `EMPTY_PROCESS_PANEL_SIGNAL`
 * wiring point for the precedent this mirrors: the TUI operator surface
 * (`packages/tui/src/context/operator-slash.tsx`) currently exposes only a
 * request/response `tryHandle` returning an `OperatorSlashDisplay` (title/
 * message/variant/outcome strings), not a structured `JobsPort` query result
 * or a live `job.*` observation stream, so there is no live `JobsPanelSignal`
 * source to wire yet. Once either seam exists, thread it through `<JobsPanel
 * signal={...} />` (see ./index.tsx) without changing this module's shape.
 */
export const EMPTY_JOBS_PANEL_SIGNAL: JobsPanelSignal = { definitions: [], occurrences: [], notifications: [] }

/** Bounded row counts rendered per panel view (mirrors process-panel's C22 bound). */
export const MAX_VISIBLE_DEFINITIONS = 50
export const MAX_VISIBLE_OCCURRENCES = 50
export const MAX_VISIBLE_NOTIFICATIONS = 50

/** Bounded, order-preserving definition card list. */
export function deriveVisibleDefinitionCards(signal: JobsPanelSignal): readonly JobDefinitionCardView[] {
  return signal.definitions.slice(0, MAX_VISIBLE_DEFINITIONS).map(deriveDefinitionCardView)
}

export interface JobDefinitionHistoryView {
  readonly occurrences: readonly OccurrenceRowView[]
  readonly notifications: readonly NotificationRowView[]
}

/** Bounded, filtered occurrence + notification history for one Job Definition (FR10, FR22). */
export function deriveDefinitionHistory(signal: JobsPanelSignal, jobDefinitionId: string): JobDefinitionHistoryView {
  const occurrences = signal.occurrences
    .filter((occurrence) => occurrence.jobDefinitionId === jobDefinitionId)
    .slice(0, MAX_VISIBLE_OCCURRENCES)
    .map(deriveOccurrenceRowView)
  const notifications = signal.notifications
    .filter((notification) => notification.jobDefinitionId === jobDefinitionId)
    .slice(0, MAX_VISIBLE_NOTIFICATIONS)
    .map(deriveNotificationRowView)
  return { occurrences, notifications }
}

export * as JobsPanelState from "./state"
