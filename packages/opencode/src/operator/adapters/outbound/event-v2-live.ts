/**
 * Live EventV2 → EventPort (T022/T024 review).
 * - Bounded readDurablePage (no infinite Stream.runCollect / EventV2.durable collect)
 * - Hard limit + maxScan; scan budget exhausted before page fill → fail-closed
 *   (`listAuditsResult` ok:false / unavailable) — never silent partial success
 * - Stable event id from FULL canonical secret-free audit record hash
 * - listAudits fail-closed on backend/malformed errors
 * - prune via SQL EventV2.pruneDurable (json_extract createdAtMs)
 */
import { Effect } from "effect"
import {
  auditIsSecretFree,
  auditRetentionMs,
  stableAuditEventId,
  OperatorAuditEvent,
  operatorAuditAggregateID,
  OPERATOR_AUDIT_EVENT_TYPE,
  type AuditRecord,
} from "@opencode-ai/core/operator"
import type { EventPort, ListAuditsOptions, ListAuditsResult } from "../../application/ports/event-port"

export type EventV2ServiceLike = {
  readonly publish: (
    definition: typeof OperatorAuditEvent,
    data: Record<string, unknown>,
    options?: { id?: string },
  ) => Effect.Effect<{ id: string; type: string; data: unknown }>
  readonly readDurablePage: (input: {
    readonly aggregateID: string
    readonly after?: number
    readonly limit: number
  }) => Effect.Effect<{
    readonly events: readonly {
      id: string
      type: string
      data: unknown
      durable?: { seq: number }
    }[]
    readonly hasMore: boolean
    readonly lastSeq: number
  }>
  readonly pruneDurable: (input: {
    readonly aggregateID: string
    readonly typePrefix: string
    readonly olderThanMs: number
    readonly limit: number
  }) => Effect.Effect<number>
}

/** Hash FULL canonical secret-free audit record → stable Event.ID. */
export function stableOperatorAuditEventIdFromRecord(record: AuditRecord): string {
  return stableAuditEventId(record)
}

function toAudit(ev: { id: string; type: string; data: unknown }): (AuditRecord & { id: string }) | null {
  if (String(ev.type) !== OPERATOR_AUDIT_EVENT_TYPE && !String(ev.type).startsWith(`${OPERATOR_AUDIT_EVENT_TYPE}.`)) {
    return null
  }
  if (!ev.data || typeof ev.data !== "object") throw new Error("operator.audit event data is not an object")
  const d = ev.data as Record<string, unknown>
  if (
    typeof d.source !== "string" ||
    typeof d.actorRef !== "string" ||
    typeof d.scopeKind !== "string" ||
    (d.scopeRef !== null && typeof d.scopeRef !== "string") ||
    typeof d.commandId !== "string" ||
    (d.beforeVersion !== null && typeof d.beforeVersion !== "string") ||
    (d.afterVersion !== null && typeof d.afterVersion !== "string") ||
    typeof d.outcome !== "string" ||
    typeof d.createdAtMs !== "number" ||
    !Number.isFinite(d.createdAtMs)
  ) {
    throw new Error("operator.audit event data is malformed")
  }
  return {
    id: ev.id,
    source: d.source as AuditRecord["source"],
    actorRef: d.actorRef,
    scope: {
      kind: d.scopeKind as AuditRecord["scope"]["kind"],
      ref: d.scopeRef,
    },
    commandId: d.commandId,
    beforeVersion: d.beforeVersion,
    afterVersion: d.afterVersion,
    outcome: d.outcome as AuditRecord["outcome"],
    createdAtMs: d.createdAtMs,
  }
}

/**
 * Preferred composition: each call resolves EventV2 via useEvents (Effect).
 */
export function createLiveEventV2AuditPortFromUse(input: {
  readonly useEvents: <A>(fn: (svc: EventV2ServiceLike) => Effect.Effect<A>) => Promise<A>
  readonly projectKey?: string
}): EventPort {
  const defaultProject = input.projectKey

  return {
    async appendAudit(record, options) {
      const aggregateID = operatorAuditAggregateID(options?.projectKey ?? defaultProject)
      const data = {
        aggregateID,
        source: record.source,
        actorRef: record.actorRef,
        scopeKind: record.scope.kind,
        scopeRef: record.scope.ref,
        commandId: record.commandId,
        beforeVersion: record.beforeVersion,
        afterVersion: record.afterVersion,
        outcome: record.outcome,
        createdAtMs: record.createdAtMs,
      }
      if (!auditIsSecretFree(data as unknown as Record<string, unknown>)) {
        return { ok: false, code: "unavailable", reason: "audit data not secret-free" }
      }
      const derivedEventId = stableOperatorAuditEventIdFromRecord(record)
      if (options?.eventId && options.eventId !== derivedEventId) {
        return {
          ok: false,
          code: "unavailable",
          reason: "event id does not match the complete canonical audit record",
        }
      }
      const eventId = options?.eventId ?? derivedEventId
      try {
        const published = await input.useEvents((events) =>
          events.publish(OperatorAuditEvent, data, { id: eventId as never }),
        )
        return { ok: true, auditId: published.id }
      } catch (error) {
        return {
          ok: false,
          code: "unavailable",
          reason: error instanceof Error ? error.message : "EventV2 publish failed",
        }
      }
    },

    async listAudits(options) {
      const result = await listViaUse(input, options, defaultProject)
      if (!result.ok) throw new Error(result.reason)
      return result.audits
    },

    async listAuditsResult(options) {
      return listViaUse(input, options, defaultProject)
    },

    async pruneAudits(idsOrOlderThanMs) {
      if (Array.isArray(idsOrOlderThanMs)) return 0
      const olderThanMs =
        typeof idsOrOlderThanMs === "number" ? idsOrOlderThanMs : Date.now() - auditRetentionMs()
      const aggregateID = operatorAuditAggregateID(defaultProject)
      let total = 0
      for (let page = 0; page < 10; page++) {
        const n = await input.useEvents((events) =>
          events.pruneDurable({
            aggregateID,
            typePrefix: OPERATOR_AUDIT_EVENT_TYPE,
            olderThanMs,
            limit: 200,
          }),
        )
        total += n
        if (n < 200) break
      }
      return total
    },
  }
}

async function listViaUse(
  input: {
    useEvents: <A>(fn: (svc: EventV2ServiceLike) => Effect.Effect<A>) => Promise<A>
  },
  options: ListAuditsOptions | undefined,
  defaultProject: string | undefined,
): Promise<ListAuditsResult> {
  const since = options?.sinceMs ?? 0
  const until = options?.untilMs ?? Number.POSITIVE_INFINITY
  const requestedLimit = options?.limit ?? 200
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
    return { ok: false, code: "unavailable", reason: "audit list limit must be a positive integer" }
  }
  if (options?.afterSeq !== undefined && (!Number.isSafeInteger(options.afterSeq) || options.afterSeq < -1)) {
    return { ok: false, code: "unavailable", reason: "audit list cursor is invalid" }
  }
  const hardLimit = Math.min(requestedLimit, 500)
  const aggregateID = operatorAuditAggregateID(options?.projectKey ?? defaultProject)

  try {
    const out: (AuditRecord & { id: string })[] = []
    let after = options?.afterSeq ?? -1
    let scanned = 0
    let more = false
    const maxScan = Math.max(2_000, hardLimit * 20)
    for (let guard = 0; guard < 100 && out.length < hardLimit && scanned < maxScan; guard++) {
      const pageLimit = Math.min(100, hardLimit - out.length, maxScan - scanned)
      const page = await input.useEvents((events) =>
        events.readDurablePage({
          aggregateID,
          after,
          limit: pageLimit,
        }),
      )
      if (page.events.length === 0) break
      scanned += page.events.length
      for (const ev of page.events) {
        const a = toAudit(ev)
        if (!a) continue
        if (a.createdAtMs < since || a.createdAtMs > until) continue
        out.push(a)
        if (out.length >= hardLimit) break
      }
      after = page.lastSeq
      more = page.hasMore
      if (!more) break
    }
    if (scanned >= maxScan && more && out.length < hardLimit) {
      return { ok: false, code: "unavailable", reason: "bounded audit history scan reached its hard limit" }
    }
    const nextAfterSeq = more && scanned > 0 ? after : undefined
    return nextAfterSeq === undefined ? { ok: true, audits: out } : { ok: true, audits: out, nextAfterSeq }
  } catch (error) {
    return {
      ok: false,
      code: "unavailable",
      reason: error instanceof Error ? error.message : "EventV2 bounded list failed",
    }
  }
}

/** @deprecated use createLiveEventV2AuditPortFromUse */
export function createLiveEventV2AuditPort(input: {
  readonly events: EventV2ServiceLike
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
  readonly projectKey?: string
}): EventPort {
  return createLiveEventV2AuditPortFromUse({
    projectKey: input.projectKey,
    useEvents: (fn) => input.run(fn(input.events)),
  })
}

export * as EventV2Live from "./event-v2-live"
