import { fallback, isRecord, yesNo } from "../operator/output"

/**
 * Feature 003 / T029 (S17) — human renderers for the `opencode op jobs`
 * command surface. Pure string builders over the redacted `JobsPort`
 * response views (list/status/show/create/update/enable/disable/delete/
 * reschedule/run-now/history/watch, `contracts/ports.ts`). No renderer ever
 * touches process streams so they stay unit-testable, and no renderer ever
 * makes a model call — every row arrives already redacted server-side
 * (FR32, C12).
 */

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function scheduleLine(schedule: unknown): string | undefined {
  if (!isRecord(schedule)) return undefined
  return `schedule: ${String(schedule.cronExpression ?? "-")} (${String(schedule.ianaTimezone ?? "-")})`
}

/** Render a single `JobDefinitionSummary`-shaped payload. */
export function renderDefinition(definition: unknown): string {
  if (!isRecord(definition)) return fallback(definition)
  const lines = [
    `job ${String(definition.jobDefinitionId ?? "-")}: ${String(definition.name ?? "-")} (v${String(definition.version ?? "-")})`,
  ]
  lines.push(`enabled: ${yesNo(definition.enabled)}  registration: ${String(definition.registrationState ?? "unknown")}`)
  const schedule = scheduleLine(definition.schedule)
  if (schedule) lines.push(schedule)
  lines.push(
    `action: ${String(definition.actionType ?? "-")}  overlap: ${String(definition.overlapPolicy ?? "-")}  misfire: ${String(definition.misfirePolicy ?? "-")}`,
  )
  if (definition.nextDueAt) lines.push(`next due: ${String(definition.nextDueAt)}`)
  if (definition.lastOutcome) lines.push(`last outcome: ${String(definition.lastOutcome)}`)
  if (definition.updatedAt) lines.push(`updated: ${String(definition.updatedAt)}`)
  return lines.join("\n")
}

function definitionOf(effective: unknown): unknown {
  if (!isRecord(effective)) return effective
  return effective.definition ?? effective
}

export function renderStatus(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  return renderDefinition(definitionOf(effective))
}

export function renderList(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const definitions = asArray(effective.definitions)
  if (!definitions.length) return "jobs: (empty)"
  const lines = definitions.map((definition) => renderDefinition(definition))
  if (effective.cursor) lines.push(`cursor: ${String(effective.cursor)}`)
  return lines.join("\n---\n")
}

function occurrenceLine(occurrence: unknown): string {
  if (!isRecord(occurrence)) return String(occurrence)
  const parts = [
    `occurrence ${String(occurrence.occurrenceId ?? "-")}: ${String(occurrence.state ?? "unknown")}`,
    `due: ${String(occurrence.nominalDueTime ?? "-")}`,
  ]
  if (occurrence.outcome) parts.push(`outcome: ${String(occurrence.outcome)}`)
  if (occurrence.processId) parts.push(`process: ${String(occurrence.processId)}`)
  return parts.join("  ")
}

function notificationLine(notification: unknown): string {
  if (!isRecord(notification)) return String(notification)
  const parts = [
    `notification ${String(notification.notificationId ?? "-")}: ${String(notification.type ?? "unknown")}`,
    `delivery: ${String(notification.deliveryState ?? "-")}`,
    `ack: ${String(notification.ackState ?? "-")}`,
  ]
  if (notification.summary) parts.push(`summary: ${String(notification.summary)}`)
  return parts.join("  ")
}

export function renderShow(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [renderDefinition(effective.definition)]
  const occurrences = asArray(effective.occurrences)
  lines.push(occurrences.length ? occurrences.map(occurrenceLine).join("\n") : "occurrences: (empty)")
  return lines.join("\n")
}

/** Shared renderer for create/update/enable/reschedule: definition + audit id. */
export function renderMutation(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [renderDefinition(effective.definition)]
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export function renderDisable(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [renderDefinition(effective.definition)]
  lines.push(`active occurrence: ${String(effective.activeOccurrenceOutcome ?? "unknown")}`)
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export function renderDelete(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`deleted: ${yesNo(effective.deleted)}`]
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export function renderRunNow(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [occurrenceLine(effective.occurrence)]
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export function renderHistory(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const occurrences = asArray(effective.occurrences)
  const notifications = asArray(effective.notifications)
  const lines = [occurrences.length ? occurrences.map(occurrenceLine).join("\n") : "occurrences: (empty)"]
  lines.push(notifications.length ? notifications.map(notificationLine).join("\n") : "notifications: (empty)")
  if (effective.cursor) lines.push(`cursor: ${String(effective.cursor)}`)
  return lines.join("\n")
}

export function renderWatch(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [renderDefinition(effective.definition)]
  lines.push(`streaming: ${String(effective.streaming ?? "observation-surface")} (live stream is a TUI surface)`)
  return lines.join("\n")
}

export * as JobsRender from "./render"
