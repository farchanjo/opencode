/**
 * Audit record shape for EventV2 projector (Feature 007 / T022).
 * Secret-free; content-free version hashes only.
 */
import { Schema } from "effect"
import { createHash } from "node:crypto"
import { CommandSource } from "./envelope"
import { OperatorScope } from "./scope"
import { Outcome } from "./envelope"

export const AuditRecord = Schema.Struct({
  source: CommandSource,
  actorRef: Schema.String,
  scope: OperatorScope,
  commandId: Schema.String,
  beforeVersion: Schema.NullOr(Schema.String),
  afterVersion: Schema.NullOr(Schema.String),
  outcome: Outcome,
  createdAtMs: Schema.Number,
}).annotate({ identifier: "Operator.AuditRecord" })
export type AuditRecord = typeof AuditRecord.Type

/**
 * The only fields that may participate in an operator audit identity.
 * Keep this projection explicit: adding a payload, secret reference material, or
 * transport detail to the hash would make the EventV2 id unstable or leak data.
 */
export function canonicalAuditRecord(record: AuditRecord) {
  return {
    source: record.source,
    actorRef: record.actorRef,
    scope: {
      kind: record.scope.kind,
      ref: record.scope.ref,
    },
    commandId: record.commandId,
    beforeVersion: record.beforeVersion,
    afterVersion: record.afterVersion,
    outcome: record.outcome,
    createdAtMs: record.createdAtMs,
  } as const
}

/** Stable id for the complete canonical, secret-free audit record. */
export function stableAuditEventId(record: AuditRecord): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalAuditRecord(record)))
    .digest("hex")
    .slice(0, 24)
  return `evt_opaudit_${digest}`
}

/** Fields that must never appear on audit records. */
export const FORBIDDEN_AUDIT_KEYS = [
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "plaintext",
  "content",
  "body",
  "payload",
] as const

export function auditIsSecretFree(record: Record<string, unknown>): boolean {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_AUDIT_KEYS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      return false
    }
  }
  const json = JSON.stringify(record)
  if (/\b(sk|pk|rk)_[A-Za-z0-9]{8,}\b/.test(json)) return false
  if (/Bearer\s+\S+/i.test(json)) return false
  return true
}

export * as OperatorAudit from "./audit"
