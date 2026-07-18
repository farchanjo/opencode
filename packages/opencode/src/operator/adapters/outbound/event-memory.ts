/**
 * EventPort memory adapter — tests only (T022/T024).
 * Live production uses event-v2-live (durable EventV2).
 */
import {
  auditIsSecretFree,
  auditRetentionMs,
  stableAuditEventId,
  type AuditRecord,
} from "@opencode-ai/core/operator"
import type { EventPort } from "../../application/ports/event-port"

export function createMemoryEventPort(): EventPort {
  const rows: (AuditRecord & { id: string })[] = []
  return {
    async appendAudit(record, options) {
      const plain = record as unknown as Record<string, unknown>
      if (!auditIsSecretFree(plain)) {
        return { ok: false, code: "unavailable", reason: "audit record must be secret-free" }
      }
      for (const forbidden of ["password", "secret", "token", "apiKey", "plaintext", "payload"]) {
        if (forbidden in plain) {
          return { ok: false, code: "unavailable", reason: "forbidden audit fields" }
        }
      }
      const derivedId = stableAuditEventId(record)
      if (options?.eventId && options.eventId !== derivedId) {
        return { ok: false, code: "unavailable", reason: "event id does not match audit record" }
      }
      const id = options?.eventId ?? derivedId
      // Idempotent by id
      const existing = rows.find((r) => r.id === id)
      if (existing) {
        if (stableAuditEventId(existing) !== derivedId) {
          return { ok: false, code: "unavailable", reason: "event id already contains different audit data" }
        }
        return { ok: true, auditId: id }
      }
      rows.push({ ...record, id })
      return { ok: true, auditId: id }
    },
    async listAudits(options) {
      const since = options?.sinceMs ?? 0
      const until = options?.untilMs ?? Number.POSITIVE_INFINITY
      const limit = options?.limit ?? 10_000
      return rows
        .filter((r) => r.createdAtMs >= since && r.createdAtMs <= until)
        .slice(0, limit)
    },
    async listAuditsResult(options) {
      return { ok: true, audits: await this.listAudits(options) }
    },
    async pruneAudits(idsOrOlderThanMs) {
      if (Array.isArray(idsOrOlderThanMs)) {
        const drop = new Set(idsOrOlderThanMs)
        const before = rows.length
        for (let i = rows.length - 1; i >= 0; i--) {
          if (drop.has(rows[i]!.id)) rows.splice(i, 1)
        }
        return before - rows.length
      }
      const olderThan =
        typeof idsOrOlderThanMs === "number" ? idsOrOlderThanMs : Date.now() - auditRetentionMs()
      const before = rows.length
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]!.createdAtMs < olderThan) rows.splice(i, 1)
      }
      return before - rows.length
    },
  }
}

export * as MemoryEventAdapter from "./event-memory"
