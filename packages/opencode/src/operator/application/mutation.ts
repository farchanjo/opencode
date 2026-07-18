/**
 * Mutation pipeline: outbox prepare → idempotency claim → CAS → audit (review fix).
 * Handlers cannot bypass this path when dispatcher mutationPorts are configured.
 */
import {
  failureResult,
  successResult,
  type AuditRecord,
  type CommandRequest,
  type CommandResult,
  selectSnapshotsToPrune,
  snapshotMaxAgeMs,
  SNAPSHOT_MAX_COUNT,
} from "@opencode-ai/core/operator"
import type { ConfigPort } from "./ports/config-port"
import type { EventPort } from "./ports/event-port"
import type { IdempotencyPort } from "./ports/idempotency-port"
import { idempotencyRequestHash, principalRef, redactResultForIdempotency } from "./ports/idempotency-port"
import type { OutboxPort } from "./ports/outbox-port"
import type { RollbackPort } from "./ports/rollback-port"

export type MutationPorts = {
  readonly config: ConfigPort
  readonly idempotency: IdempotencyPort
  /** Required for live mutations that change state — fail closed if publish fails. */
  readonly events?: EventPort
  /** When true (live mode), missing/failed audit aborts mutation (no unaudited write). */
  readonly requireAudit?: boolean
  readonly outbox?: OutboxPort
  readonly rollback?: RollbackPort
  readonly nowMs?: () => number
}

export type MutateAuthorityInput = {
  readonly request: CommandRequest
  readonly authority: string
  readonly apply: (current: unknown) => unknown
  readonly snapshotBefore?: boolean
  readonly cutoverDomain?: string
  readonly rollbackDomain?: string
}

/**
 * Require mutation contract fields.
 */
export function requireMutationContract(request: CommandRequest): CommandResult | null {
  if (!request.idempotencyKey || request.idempotencyKey.trim() === "") {
    return failureResult({
      id: String(request.id),
      code: "invalid_argument",
      message: "mutations require idempotencyKey",
    })
  }
  // version may be undefined only for first create; still accept explicit null via missing
  // When version is provided as empty string, reject
  if (request.version !== undefined && request.version.trim() === "") {
    return failureResult({
      id: String(request.id),
      code: "invalid_argument",
      message: "mutations require a non-empty version token when version is set",
    })
  }
  return null
}

export async function mutateAuthority(ports: MutationPorts, input: MutateAuthorityInput): Promise<CommandResult> {
  const nowMs = ports.nowMs?.() ?? Date.now()
  const id = String(input.request.id)

  const contract = requireMutationContract(input.request)
  if (contract) return contract

  // Live mode: audit port required before any mutate (no unaudited writes)
  if (ports.requireAudit && !ports.events) {
    return failureResult({
      id,
      code: "unavailable",
      message: "audit EventPort required for live mutations",
    })
  }

  // Outbox must be prepared/checked BEFORE mutation
  if (ports.outbox) {
    if (ports.outbox.requiredForLocalMutation()) {
      return failureResult({
        id,
        code: "unavailable",
        message: "outbox must not be required for local config mutation",
      })
    }
    const prepared = await ports.outbox.prepareExternal?.({
      commandId: id,
      nowMs,
    })
    if (prepared && !prepared.ok) {
      return failureResult({
        id,
        code: "unavailable",
        message: prepared.reason,
      })
    }
  }

  const key = {
    principalRef: principalRef(input.request.principal),
    commandId: id,
    idempotencyKey: input.request.idempotencyKey!,
  }
  const requestHash = idempotencyRequestHash(input.request)

  // Idempotency claim (prevents concurrent double mutate)
  if (ports.idempotency.claim) {
    const claim = await ports.idempotency.claim(key, nowMs, requestHash)
    if (claim.status === "replay") {
      if (claim.record.requestHash !== requestHash) {
        return failureResult({
          id,
          code: "invalid_argument",
          message: "idempotency key was already used with a different request payload",
        })
      }
      return {
        ...claim.record.result,
        outcome: "idempotent_replay",
        ok: claim.record.result.ok,
      }
    }
    if (claim.status === "busy") {
      return failureResult({
        id,
        code: "conflict",
        message: "idempotency key is already in flight",
        details: { idempotencyKey: key.idempotencyKey },
      })
    }
    if (claim.status === "mismatch") {
      return failureResult({
        id,
        code: "invalid_argument",
        message: "idempotency key was already used with a different request payload",
      })
    }
  } else {
    const prior = await ports.idempotency.get(key, requestHash)
    if (prior) {
      if (prior.requestHash !== requestHash) {
        return failureResult({
          id,
          code: "invalid_argument",
          message: "idempotency key was already used with a different request payload",
        })
      }
      return {
        ...prior.result,
        outcome: "idempotent_replay",
        ok: prior.result.ok,
      }
    }
  }

  // Rollback path: restore full previous payload (same atomic auditIntent as main CAS)
  if (input.rollbackDomain && ports.rollback) {
    const slot = await ports.rollback.get(input.rollbackDomain)
    if (!slot || !slot.available) {
      return failureResult({
        id,
        code: "unavailable",
        message: `no rollback slot for ${input.rollbackDomain}`,
        details: { domain: input.rollbackDomain },
      })
    }
    const current = await ports.config.get(input.authority)
    const expected = input.request.version ?? current?.version ?? null
    const restorePayload =
      slot.previousPayload !== undefined
        ? slot.previousPayload
        : { bindingVersion: slot.previousBinding, restoredFrom: input.rollbackDomain }
    const cas = await ports.config.compareAndSet({
      authority: input.authority,
      expectedVersion: expected,
      payload: restorePayload,
      nowMs,
      auditIntent: successAuditIntent(ports, input.request, id, current?.version ?? null, nowMs),
      // R1: clear rollback slot in the same Config/Flock write as restore payload
      clearRollbackDomain: input.rollbackDomain,
    })
    if (!cas.ok) {
      return failureResult({
        id,
        code: cas.code === "conflict" ? "conflict" : "unavailable",
        message: cas.code === "conflict" ? "CAS version conflict" : cas.reason,
        details: cas.code === "conflict" ? { currentVersion: cas.currentVersion } : undefined,
      })
    }
    // Only dual-write memory RollbackPort when CAS did not clear atomically.
    if (ports.rollback && !cas.applied?.clearRollback) {
      await ports.rollback.clear(input.rollbackDomain)
    }
    const result = successResult({
      id,
      version: cas.version,
      effective: restorePayload,
    })
    return finalize(ports, input.request, result, current?.version ?? null, cas.version, nowMs, key, requestHash)
  }

  const current = await ports.config.get(input.authority)
  // Mutations require expected version when an entry already exists
  if (current && input.request.version === undefined) {
    return failureResult({
      id,
      code: "invalid_argument",
      message: "mutations require version (CAS token) when authority already exists",
      details: { currentVersion: current.version },
    })
  }
  const expected = input.request.version ?? null
  if (input.request.version !== undefined && current && current.version !== input.request.version) {
    return failureResult({
      id,
      code: "conflict",
      message: "CAS version conflict",
      details: { currentVersion: current.version, expectedVersion: input.request.version },
    })
  }

  const nextPayload = input.apply(current?.payload ?? null)
  // R1/H1/H3: payload + optional snapshot + rollback slot + audit intent in ONE CAS write
  const cas = await ports.config.compareAndSet({
    authority: input.authority,
    expectedVersion: expected,
    payload: nextPayload,
    nowMs,
    auditIntent: successAuditIntent(ports, input.request, id, current?.version ?? null, nowMs),
    snapshotBefore: input.snapshotBefore === true,
    rollbackSlot:
      input.cutoverDomain && ports.rollback
        ? {
            domain: input.cutoverDomain,
            previousBinding: current?.version ?? "none",
            previousPayload: current?.payload ?? null,
            activatedAtMs: nowMs,
            available: true,
          }
        : undefined,
  })

  if (!cas.ok) {
    return failureResult({
      id,
      code: cas.code === "conflict" ? "conflict" : "unavailable",
      message: cas.code === "conflict" ? "CAS version conflict" : cas.reason,
      details: cas.code === "conflict" ? { currentVersion: cas.currentVersion } : undefined,
    })
  }

  // Only dual-write memory RollbackPort when CAS did not set the slot atomically.
  // Durable Config store reports applied.rollbackSlot — no second write (no crash window).
  if (input.cutoverDomain && ports.rollback && !cas.applied?.rollbackSlot) {
    await ports.rollback.set({
      domain: input.cutoverDomain,
      previousBinding: current?.version ?? "none",
      previousPayload: current?.payload ?? null,
      activatedAtMs: nowMs,
      available: true,
    })
  }

  const result = successResult({
    id,
    version: cas.version,
    effective: nextPayload,
  })
  return finalize(ports, input.request, result, current?.version ?? null, cas.version, nowMs, key, requestHash)
}

async function finalize(
  ports: MutationPorts,
  request: CommandRequest,
  result: CommandResult,
  beforeVersion: string | null,
  afterVersion: string | null,
  nowMs: number,
  key: { principalRef: string; commandId: string; idempotencyKey: string },
  requestHash: string,
): Promise<CommandResult> {
  let auditId: string | undefined
  if (ports.events) {
    const record: AuditRecord = {
      source: request.source,
      actorRef: `${request.principal.kind}:${request.principal.subject}`,
      scope: request.scope,
      commandId: String(request.id),
      beforeVersion,
      afterVersion,
      outcome: result.outcome,
      createdAtMs: nowMs,
    }
    // Intent already durable from atomic CAS when requireAudit; try publish + ack
    const { stableOperatorAuditEventIdFromRecord } = await import("../adapters/outbound/event-v2-live")
    const eventId = stableOperatorAuditEventIdFromRecord(record)
    const appended = await ports.events.appendAudit(record, {
      eventId,
      projectKey: request.principal.projectBinding ?? request.scope.ref ?? "project",
    })
    if (!appended.ok) {
      if (ports.requireAudit && result.ok) {
        // Intent already in Config from CAS; return audit_pending (afterVersion visible)
        const pending: CommandResult = {
          ...result,
          ok: true,
          outcome: "audit_pending",
          version: afterVersion ?? result.version,
          effective: {
            ...(typeof result.effective === "object" && result.effective !== null
              ? (result.effective as object)
              : {}),
            auditPending: true,
            afterVersion,
            auditError: appended.reason,
          },
        }
        await ports.idempotency.put({
          ...key,
          result: redactResultForIdempotency(pending),
          createdAtMs: nowMs,
          requestHash,
        })
        return pending
      }
    } else {
      auditId = appended.auditId
      // Ack durable intent after successful publish
      await ports.outbox?.markDelivered?.(eventId)
    }
  } else if (ports.requireAudit && result.ok) {
    // Preflight: missing audit service — must not mutate. Callers must check before CAS.
    // If we reach here after CAS, surface audit_pending with afterVersion.
    if (afterVersion) {
      const pending: CommandResult = {
        ...result,
        ok: true,
        outcome: "audit_pending",
        version: afterVersion,
        effective: {
          auditPending: true,
          afterVersion,
          auditError: "audit EventPort missing",
        },
      }
      await ports.idempotency.put({
        ...key,
        result: redactResultForIdempotency(pending),
        createdAtMs: nowMs,
        requestHash,
      })
      return pending
    }
    return failureResult({
      id: String(request.id),
      code: "unavailable",
      message: "audit EventPort required for live mutations",
    })
  }

  await ports.idempotency.put({
    ...key,
    result: redactResultForIdempotency(result),
    createdAtMs: nowMs,
    requestHash,
  })

  return auditId ? { ...result, auditId } : result
}

/** Audit a non-mutating or not_implemented outcome without CAS. */
export async function auditOnly(
  ports: Pick<MutationPorts, "events" | "nowMs">,
  request: CommandRequest,
  result: CommandResult,
): Promise<CommandResult> {
  if (!ports.events) return result
  const nowMs = ports.nowMs?.() ?? Date.now()
  const appended = await ports.events.appendAudit({
    source: request.source,
    actorRef: `${request.principal.kind}:${request.principal.subject}`,
    scope: request.scope,
    commandId: String(request.id),
    beforeVersion: null,
    afterVersion: null,
    outcome: result.outcome,
    createdAtMs: nowMs,
  }, { projectKey: request.principal.projectBinding ?? request.scope.ref ?? "project" })
  if (!appended.ok) return result
  return { ...result, auditId: appended.auditId }
}

/** Atomic audit intent payload for successful authority CAS (main + rollback). */
function successAuditIntent(
  ports: MutationPorts,
  request: CommandRequest,
  commandId: string,
  beforeVersion: string | null,
  nowMs: number,
) {
  if (!ports.requireAudit) return undefined
  return {
    record: {
      source: request.source,
      actorRef: `${request.principal.kind}:${request.principal.subject}`,
      scope: request.scope,
      commandId,
      beforeVersion,
      outcome: "success" as const,
      createdAtMs: nowMs,
    },
    projectKey: request.principal.projectBinding ?? request.scope.ref ?? "project",
  }
}

export async function pruneSnapshotsForAuthority(
  config: ConfigPort,
  authority: string,
  nowMs: number,
): Promise<number> {
  const listed = await config.listSnapshots(authority)
  const dropIds = selectSnapshotsToPrune(
    listed.map((s) => ({ id: s.id, createdAtMs: s.createdAtMs })),
    nowMs,
    { maxCount: SNAPSHOT_MAX_COUNT, maxAgeMs: snapshotMaxAgeMs() },
  )
  if (dropIds.length === 0) return 0
  return config.pruneSnapshots({ authority, dropIds })
}

export * as OperatorMutation from "./mutation"
