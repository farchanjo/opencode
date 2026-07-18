/**
 * Operator audit EventV2 definition (Feature 007 / T022–T024).
 * Canonical durable schema registered in DurableEventManifest.
 */
import { OperatorEvent } from "@opencode-ai/schema/operator-event"

/** Re-export durable definition (aggregate field: aggregateID). */
export const OperatorAuditEvent = OperatorEvent.Audit

export const OPERATOR_AUDIT_EVENT_TYPE = "operator.audit" as const

export const OPERATOR_AUDIT_DURABLE_VERSION = OperatorEvent.AUDIT_DURABLE_VERSION

export type OperatorAuditEventData = {
  readonly aggregateID: string
  readonly source: string
  readonly actorRef: string
  readonly scopeKind: string
  readonly scopeRef: string | null
  readonly commandId: string
  readonly beforeVersion: string | null
  readonly afterVersion: string | null
  readonly outcome: string
  readonly createdAtMs: number
}

/** Default aggregate for global operator stream; project-scoped uses operator:{key}. */
export function operatorAuditAggregateID(projectKey?: string): string {
  if (!projectKey || projectKey === "project" || projectKey === "global") return "operator"
  return `operator:${projectKey}`
}

/**
 * Retention: hard-prune supported via EventV2.pruneDurable for operator.audit only.
 * Query window remains AUDIT_RETENTION_DAYS (90).
 */
export const EVENTV2_RETENTION_MODE = "hard_prune_and_query_window" as const

export * as OperatorEventDefinition from "./event-definition"
