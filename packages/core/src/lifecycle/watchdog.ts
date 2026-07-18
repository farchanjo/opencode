/**
 * Feature 002 / T021 — Shared bucketed watchdog.
 *
 * A single shared bucketed sweeper holds in-memory lease and heartbeat state
 * for every Task's owning process — never one timer per Task, never a
 * per-heartbeat SQLite write (FR38, C12). `acquire`/`heartbeat`/`release` are
 * plain in-memory map operations; `sweep` is the one operation an external
 * caller invokes on a shared cadence (`DEFAULT_SWEEP_INTERVAL_MS`) to assess
 * every lease that has fallen due, bucketed by `floor(expiresAtMs /
 * sweepIntervalMs)` so a sweep only ever touches buckets that are actually
 * due instead of scanning every live lease on every tick.
 *
 * This module owns no timer itself (zero framework deps, no I/O) — the
 * composition root/application layer calls `sweep(now)` periodically. That
 * keeps the sweeper genuinely "single and shared": one external cadence
 * drives assessment for every process, never a timer per Task.
 *
 * Owner liveness is an injected minimal port (`OwnerLivenessPort`), mirroring
 * the Feature 001 domain style of pure modules with injected ports rather
 * than reaching for real I/O inside the domain. When liveness is unknown the
 * outcome is `"unknown"`, never a fabricated `"owner_lost"` — the watchdog
 * never claims that a provider or external tool has stopped (FR39, C12).
 */
export * as Watchdog from "./watchdog"

import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type { Watchdog as WatchdogSchema } from "@opencode-ai/schema/lifecycle/watchdog"

// =============================================================================
// Provisional plan constants (data-model.md "Parameters": watchdog_sweep_interval_ms,
// lease_ttl_ms, heartbeat_interval_ms). Named and overridable, never inlined.
// =============================================================================

export const DEFAULT_LEASE_TTL_MS = 15_000
export const DEFAULT_SWEEP_INTERVAL_MS = 1_000
/** In-memory only cadence a lease owner is expected to heartbeat at; never
 *  written to SQLite per beat (FR38). Informational default for callers. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000

// =============================================================================
// Lease state (domain-internal). DEVIATION FROM the wire
// `Watchdog.WatchdogLease` schema shape: the wire schema's `last_heartbeat_at`
// / `expires_at` decode through `DateTimeUtcFromMillis` to `DateTime.Utc`
// (Effect runtime value); this domain module stays zero-framework-deps and
// tracks plain epoch-millis numbers instead, matching every other pure
// core/routing domain module's `nowMs: number` style. The application-layer
// eventv2-adapter is the encode/decode boundary to the wire shape.
// =============================================================================

export interface LeaseState {
  readonly leaseId: Ids.LeaseId
  readonly processId: Ids.ProcessId
  readonly runtimeInstanceId: Ids.RuntimeInstanceId
  readonly lastHeartbeatAtMs: number
  readonly expiresAtMs: number
}

/**
 * Injected minimal port for owner-instance liveness. `true`/`false` when
 * known; `null` when liveness cannot be determined — the sweeper never
 * infers a positive/negative answer it was not given (FR39).
 */
export interface OwnerLivenessPort {
  readonly isAlive: (runtimeInstanceId: Ids.RuntimeInstanceId) => boolean | null
}

export interface WatchdogOptions {
  readonly leaseTtlMs?: number
  readonly sweepIntervalMs?: number
  readonly nowMs?: () => number
  readonly ownerLiveness?: OwnerLivenessPort
}

export interface AcquireInput {
  readonly processId: Ids.ProcessId
  readonly runtimeInstanceId: Ids.RuntimeInstanceId
  readonly leaseId: Ids.LeaseId
}

export interface HeartbeatInput {
  readonly processId: Ids.ProcessId
  readonly leaseId: Ids.LeaseId
}

export interface WatchdogSweeper {
  /** Acquire (or replace) the in-memory lease for one process. */
  readonly acquire: (input: AcquireInput) => LeaseState
  /** Renew heartbeat + expiry for a matching, not-yet-expired lease.
   *  `false` when the lease is unknown, mismatched, or already expired —
   *  the caller must `acquire` a fresh lease in that case. */
  readonly heartbeat: (input: HeartbeatInput) => boolean
  /** Drop the lease on terminal Process state; a released process is never assessed. */
  readonly release: (processId: Ids.ProcessId) => void
  /** Assess every lease whose bucket is due at `now` (defaults to the
   *  injected clock). Assessed leases are removed — a process that recovers
   *  must `acquire` a fresh lease (FR39, FR40, C12). */
  readonly sweep: (now?: number) => ReadonlyArray<WatchdogSchema.ZombieAssessment>
  readonly leaseFor: (processId: Ids.ProcessId) => LeaseState | undefined
  readonly size: () => number
}

export function createWatchdog(options?: WatchdogOptions): WatchdogSweeper {
  const leaseTtlMs = options?.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS)
  const nowMs = options?.nowMs ?? (() => Date.now())
  const ownerLiveness = options?.ownerLiveness

  const leasesByProcess = new Map<Ids.ProcessId, LeaseState>()
  const bucketsByKey = new Map<number, Set<Ids.ProcessId>>()

  function bucketKeyFor(expiresAtMs: number): number {
    return Math.floor(expiresAtMs / sweepIntervalMs)
  }

  function addToBucket(processId: Ids.ProcessId, expiresAtMs: number): void {
    const bkey = bucketKeyFor(expiresAtMs)
    let bucket = bucketsByKey.get(bkey)
    if (!bucket) {
      bucket = new Set()
      bucketsByKey.set(bkey, bucket)
    }
    bucket.add(processId)
  }

  function removeFromBucket(processId: Ids.ProcessId, expiresAtMs: number): void {
    const bkey = bucketKeyFor(expiresAtMs)
    const bucket = bucketsByKey.get(bkey)
    if (!bucket) return
    bucket.delete(processId)
    if (bucket.size === 0) bucketsByKey.delete(bkey)
  }

  function acquire(input: AcquireInput): LeaseState {
    const now = nowMs()
    const previous = leasesByProcess.get(input.processId)
    if (previous) removeFromBucket(input.processId, previous.expiresAtMs)
    const lease: LeaseState = {
      leaseId: input.leaseId,
      processId: input.processId,
      runtimeInstanceId: input.runtimeInstanceId,
      lastHeartbeatAtMs: now,
      expiresAtMs: now + leaseTtlMs,
    }
    leasesByProcess.set(input.processId, lease)
    addToBucket(input.processId, lease.expiresAtMs)
    return lease
  }

  function heartbeat(input: HeartbeatInput): boolean {
    const now = nowMs()
    const existing = leasesByProcess.get(input.processId)
    if (!existing || existing.leaseId !== input.leaseId || existing.expiresAtMs <= now) return false
    removeFromBucket(input.processId, existing.expiresAtMs)
    const renewed: LeaseState = { ...existing, lastHeartbeatAtMs: now, expiresAtMs: now + leaseTtlMs }
    leasesByProcess.set(input.processId, renewed)
    addToBucket(input.processId, renewed.expiresAtMs)
    return true
  }

  function release(processId: Ids.ProcessId): void {
    const existing = leasesByProcess.get(processId)
    if (!existing) return
    removeFromBucket(processId, existing.expiresAtMs)
    leasesByProcess.delete(processId)
  }

  function assess(lease: LeaseState): WatchdogSchema.ZombieAssessment {
    const liveness = ownerLiveness?.isAlive(lease.runtimeInstanceId) ?? null
    const outcome: EnumsObservation.WatchdogOutcome =
      liveness === false ? "owner_lost" : liveness === true ? "zombie_detected" : "unknown"
    const reason =
      outcome === "owner_lost"
        ? "lease expired and the owning runtime instance is confirmed gone"
        : outcome === "zombie_detected"
          ? "lease expired with no heartbeat while the owning runtime instance is alive"
          : "lease expired; owner liveness could not be determined"
    return { process_id: lease.processId, outcome, reason }
  }

  function sweep(now?: number): ReadonlyArray<WatchdogSchema.ZombieAssessment> {
    const at = now ?? nowMs()
    const dueBucket = bucketKeyFor(at)
    const assessments: WatchdogSchema.ZombieAssessment[] = []
    const dueKeys = [...bucketsByKey.keys()].filter((bkey) => bkey <= dueBucket).sort((a, b) => a - b)
    for (const bkey of dueKeys) {
      const bucket = bucketsByKey.get(bkey)
      if (!bucket) continue
      for (const processId of [...bucket]) {
        const lease = leasesByProcess.get(processId)
        if (!lease || lease.expiresAtMs > at) continue
        assessments.push(assess(lease))
        leasesByProcess.delete(processId)
      }
      bucketsByKey.delete(bkey)
    }
    return assessments
  }

  return {
    acquire,
    heartbeat,
    release,
    sweep,
    leaseFor(processId) {
      return leasesByProcess.get(processId)
    },
    size() {
      return leasesByProcess.size
    },
  }
}
