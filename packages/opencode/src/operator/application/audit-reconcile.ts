/**
 * Reconcile durable operator.audit outbox → EventV2 (T024 review).
 * Lease/claim under Config+Flock; stable full-record event id; dead-letter after threshold.
 * Production maintenance: startup + unref interval, process coalesce, cross-process Flock single-run.
 *
 * Failures are typed (never silently converted to pruned=0 success). Periodic loop continues.
 */
import type { AuditRecord } from "@opencode-ai/core/operator"
import { auditRetentionMs, MS_PER_DAY } from "@opencode-ai/core/operator"
import { randomBytes } from "node:crypto"
import type { EventPort } from "./ports/event-port"
import type { LockPort } from "./ports/lock-port"
import type { OutboxPort } from "./ports/outbox-port"
import { stableOperatorAuditEventIdFromRecord } from "../adapters/outbound/event-v2-live"

/** Bounded reconcile cadence (production default). */
export const DEFAULT_AUDIT_RECONCILE_INTERVAL_MS = 60_000 as const
/** Daily prune cadence (production default). */
export const DEFAULT_AUDIT_PRUNE_INTERVAL_MS = MS_PER_DAY
/** Max outbox messages processed per maintenance tick. */
export const DEFAULT_AUDIT_RECONCILE_BUDGET = 50 as const

export type ReconcileResult = {
  readonly attempted: number
  readonly delivered: number
  readonly failed: number
  readonly deadLetter: number
}

export type MaintenanceErrorPhase = "reconcile" | "prune" | "lock" | "unknown"

/** Content-free error surface (no secrets, no payloads). */
export type MaintenanceError = {
  readonly phase: MaintenanceErrorPhase
  readonly code: string
  readonly message: string
}

export type MaintenanceRunResult = {
  readonly skipped: boolean
  readonly reason?: "disposed" | "in_flight" | "lock_held"
  readonly reconcile?: ReconcileResult
  readonly pruned: number
  readonly prunedThisTick: boolean
  /** True when reconcile and/or prune threw or returned a typed failure. */
  readonly failed?: boolean
  readonly error?: MaintenanceError
}

export async function reconcileOperatorAuditOutbox(input: {
  readonly outbox: OutboxPort
  readonly events: EventPort
  readonly limit?: number
  readonly ownerId?: string
  readonly nowMs?: number
}): Promise<ReconcileResult> {
  const owner = input.ownerId ?? `reconcile_${randomBytes(4).toString("hex")}`
  const nowMs = input.nowMs ?? Date.now()
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_AUDIT_RECONCILE_BUDGET, 100))
  const pending = await input.outbox.listPending(limit)
  const batch = pending.filter((m) => m.target === "operator.audit").slice(0, limit)
  let delivered = 0
  let failed = 0
  let deadLetter = 0

  for (const msg of batch) {
    if (input.outbox.claim) {
      const claim = await input.outbox.claim(msg.id, owner, nowMs)
      if (claim.status === "skipped") continue
      if (claim.status === "dead_letter") {
        // Max-attempt exhaustion: row already dead-lettered by claim; count metric.
        deadLetter += 1
        failed += 1
        continue
      }
    }

    const body = msg.body
    if (!isPendingAuditBody(body) || stableOperatorAuditEventIdFromRecord(body.record) !== body.eventId) {
      await input.outbox.markDeadLetter?.(msg.id, "malformed operator.audit outbox body")
      deadLetter += 1
      failed += 1
      continue
    }

    const eventId = body.eventId
    const published = await input.events.appendAudit(body.record, {
      eventId,
      projectKey: body.projectKey,
    })
    if (!published.ok) {
      failed += 1
      continue
    }
    await input.outbox.markDelivered(msg.id)
    delivered += 1
  }
  return { attempted: batch.length, delivered, failed, deadLetter }
}

function isPendingAuditBody(
  value: unknown,
): value is { readonly record: AuditRecord; readonly projectKey: string; readonly eventId: string } {
  if (!value || typeof value !== "object") return false
  const body = value as Record<string, unknown>
  if (typeof body.projectKey !== "string" || typeof body.eventId !== "string") return false
  if (!body.record || typeof body.record !== "object") return false
  const record = body.record as Record<string, unknown>
  const scope = record.scope
  return (
    typeof record.source === "string" &&
    typeof record.actorRef === "string" &&
    typeof record.commandId === "string" &&
    (record.beforeVersion === null || typeof record.beforeVersion === "string") &&
    (record.afterVersion === null || typeof record.afterVersion === "string") &&
    typeof record.outcome === "string" &&
    typeof record.createdAtMs === "number" &&
    Number.isFinite(record.createdAtMs) &&
    typeof scope === "object" &&
    scope !== null &&
    typeof (scope as Record<string, unknown>).kind === "string" &&
    ((scope as Record<string, unknown>).ref === null || typeof (scope as Record<string, unknown>).ref === "string")
  )
}

export async function runOperatorAuditMaintenance(input: {
  readonly outbox?: OutboxPort
  readonly events: EventPort
  readonly nowMs?: number
  readonly reconcileLimit?: number
  readonly prune?: boolean
  readonly ownerId?: string
}): Promise<{
  reconcile?: ReconcileResult
  pruned: number
  failed?: boolean
  error?: MaintenanceError
}> {
  let reconcile: ReconcileResult | undefined
  if (input.outbox) {
    try {
      reconcile = await reconcileOperatorAuditOutbox({
        outbox: input.outbox,
        events: input.events,
        nowMs: input.nowMs,
        limit: input.reconcileLimit ?? DEFAULT_AUDIT_RECONCILE_BUDGET,
        ownerId: input.ownerId,
      })
    } catch (error) {
      return {
        pruned: 0,
        failed: true,
        error: toMaintenanceError("reconcile", error),
      }
    }
  }
  const shouldPrune = input.prune !== false
  if (!shouldPrune) return { reconcile, pruned: 0 }
  try {
    const pruned = await input.events.pruneAudits(
      input.nowMs !== undefined ? input.nowMs - auditRetentionMs() : undefined,
    )
    return { reconcile, pruned }
  } catch (error) {
    return {
      reconcile,
      pruned: 0,
      failed: true,
      error: toMaintenanceError("prune", error),
    }
  }
}

export type AuditMaintenanceHandle = {
  readonly dispose: () => void
  /** Force one tick (same coalesce/lock rules as the timer). */
  readonly runOnce: () => Promise<MaintenanceRunResult>
  /** Last successful prune wall clock (test/observability). */
  readonly lastPruneAtMs: () => number | null
}

export type StartOperatorAuditMaintenanceInput = {
  readonly outbox?: OutboxPort
  readonly events: EventPort
  /**
   * Cross-process single-run lock. Production MUST pass Flock.
   * When omitted, only process-local coalesce applies.
   */
  readonly lock?: LockPort
  /** Isolates maintenance Flock key per project. */
  readonly projectKey?: string
  /** Reconcile timer cadence (default 60s). */
  readonly intervalMs?: number
  /** Prune cadence (default 1 day). Reconcile still runs every interval. */
  readonly pruneIntervalMs?: number
  /** Outbox budget per tick (default 50). */
  readonly reconcileLimit?: number
  readonly nowMs?: () => number
  /** When false, skip the immediate startup tick (default true). */
  readonly runOnStart?: boolean
  readonly ownerId?: string
  readonly onTick?: (result: MaintenanceRunResult) => void
  /**
   * Content-free error callback (codes/messages only — no audit payloads).
   * Periodic loop continues after errors.
   */
  readonly onError?: (error: MaintenanceError) => void
}

/**
 * Startup + unref periodic maintenance.
 * - process-local: overlapping ticks coalesce (skip while in-flight)
 * - cross-process: Flock key `audit-maintenance:{projectKey}` — only one owner
 * - dispose() clears interval (no timer leaks)
 * - default: reconcile every 60s, prune at most once per day under the same lock
 * - errors surface as `failed` + `error` + `onError`; never silent zero success
 */
export function startOperatorAuditMaintenance(
  input: StartOperatorAuditMaintenanceInput,
): AuditMaintenanceHandle {
  let disposed = false
  let running = false
  let lastPruneAtMs: number | null = null
  const projectKey = input.projectKey ?? "project"
  const maintenanceKey = `audit-maintenance:${projectKey}`
  const intervalMs = input.intervalMs ?? DEFAULT_AUDIT_RECONCILE_INTERVAL_MS
  const pruneIntervalMs = input.pruneIntervalMs ?? DEFAULT_AUDIT_PRUNE_INTERVAL_MS
  const reconcileLimit = input.reconcileLimit ?? DEFAULT_AUDIT_RECONCILE_BUDGET
  const clock = () => input.nowMs?.() ?? Date.now()

  const emit = (result: MaintenanceRunResult): MaintenanceRunResult => {
    if (result.error) input.onError?.(result.error)
    input.onTick?.(result)
    return result
  }

  const execute = async (): Promise<MaintenanceRunResult> => {
    if (disposed) return { skipped: true, reason: "disposed", pruned: 0, prunedThisTick: false }
    if (running) return { skipped: true, reason: "in_flight", pruned: 0, prunedThisTick: false }
    running = true
    try {
      const now = clock()
      const shouldPrune = lastPruneAtMs === null || now - lastPruneAtMs >= pruneIntervalMs
      const body = async (): Promise<MaintenanceRunResult> => {
        const ran = await runOperatorAuditMaintenance({
          outbox: input.outbox,
          events: input.events,
          nowMs: now,
          reconcileLimit,
          prune: shouldPrune,
          ownerId: input.ownerId,
        })
        if (ran.failed) {
          return {
            skipped: false,
            reconcile: ran.reconcile,
            pruned: 0,
            prunedThisTick: false,
            failed: true,
            error: ran.error,
          }
        }
        if (shouldPrune) lastPruneAtMs = now
        return {
          skipped: false,
          reconcile: ran.reconcile,
          pruned: ran.pruned,
          prunedThisTick: shouldPrune,
        }
      }

      if (!input.lock) return emit(await body())

      try {
        const attempt = await input.lock.tryWithLock(maintenanceKey, body)
        if (!attempt.acquired) {
          return emit({
            skipped: true,
            reason: "lock_held",
            pruned: 0,
            prunedThisTick: false,
          })
        }
        return emit(attempt.value)
      } catch (error) {
        return emit({
          skipped: false,
          pruned: 0,
          prunedThisTick: false,
          failed: true,
          error: toMaintenanceError("lock", error),
        })
      }
    } catch (error) {
      return emit({
        skipped: false,
        pruned: 0,
        prunedThisTick: false,
        failed: true,
        error: toMaintenanceError("unknown", error),
      })
    } finally {
      running = false
    }
  }

  if (input.runOnStart !== false) void execute()

  const timer = setInterval(() => void execute(), intervalMs)
  if (typeof timer === "object" && timer && "unref" in timer) {
    ;(timer as { unref: () => void }).unref()
  }

  return {
    dispose() {
      disposed = true
      clearInterval(timer)
    },
    runOnce: () => execute(),
    lastPruneAtMs: () => lastPruneAtMs,
  }
}

function toMaintenanceError(phase: MaintenanceErrorPhase, error: unknown): MaintenanceError {
  const raw = error instanceof Error ? error.message : String(error)
  // Content-free: drop path-like segments and truncate.
  const message = raw
    .replace(/\/[^\s]+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .slice(0, 200)
  const code =
    phase === "prune"
      ? "audit_prune_failed"
      : phase === "reconcile"
        ? "audit_reconcile_failed"
        : phase === "lock"
          ? "audit_maintenance_lock_failed"
          : "audit_maintenance_failed"
  return { phase, code, message: message || code }
}

export * as OperatorAuditReconcile from "./audit-reconcile"
