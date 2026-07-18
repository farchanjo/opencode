/**
 * EventPort — audit projection (Feature 007 / T022–T024).
 * Production maps to durable EventV2; tests use memory.
 *
 * Retention: AUDIT_RETENTION_DAYS (90) query window + hard prune via EventV2.pruneDurable.
 */
import type { AuditRecord } from "@opencode-ai/core/operator"

export type AuditAppendResult =
  | { readonly ok: true; readonly auditId: string }
  | { readonly ok: false; readonly code: "unavailable"; readonly reason: string }

export type ListAuditsOptions = {
  readonly sinceMs?: number
  readonly untilMs?: number
  readonly limit?: number
  /** Durable aggregate sequence cursor for the next bounded page. */
  readonly afterSeq?: number
  readonly projectKey?: string
  /** When true, fail instead of empty list on backend errors (live default). */
  readonly failClosed?: boolean
}

export type ListAuditsResult =
  | {
      readonly ok: true
      readonly audits: readonly (AuditRecord & { readonly id: string })[]
      readonly nextAfterSeq?: number
    }
  | { readonly ok: false; readonly code: "unavailable"; readonly reason: string }

export type EventPort = {
  readonly appendAudit: (
    record: AuditRecord,
    options?: { readonly eventId?: string; readonly projectKey?: string },
  ) => Promise<AuditAppendResult>
  /**
   * List audits. Live fail-closed when failClosed !== false.
   * Legacy: returns array; prefer listAuditsResult for explicit errors.
   */
  readonly listAudits: (
    options?: ListAuditsOptions,
  ) => Promise<readonly (AuditRecord & { readonly id: string })[]>
  readonly listAuditsResult?: (options?: ListAuditsOptions) => Promise<ListAuditsResult>
  /**
   * Hard-prune audits older than retention (or explicit ids for memory).
   * Live: uses EventV2.pruneDurable on operator aggregate.
   */
  readonly pruneAudits: (idsOrOlderThanMs?: readonly string[] | number) => Promise<number>
}

export * as OperatorEventPort from "./event-port"
