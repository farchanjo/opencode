/**
 * Feature 002 / T019 — Per-scope token bucket.
 *
 * Pure, deterministic token-bucket primitive over the wire
 * `Admission.TokenBucketState` shape (`packages/schema/src/lifecycle/admission.ts`,
 * doc/arch/schemas/lifecycle/admission.cue). `capacity` is a hard ceiling that is
 * never relaxed by a model, plugin, MCP call or nested instruction (FR34); every
 * function below only ever caps `available` at `capacity`, never raises the
 * ceiling itself.
 *
 * Zero framework deps: no I/O, no Effect runtime import, no wall-clock read.
 * Callers pass elapsed time explicitly (mirrors
 * `packages/core/src/operator/retention.ts`'s `nowMs` parameter style), so the
 * whole module is trivially deterministic under test (C11).
 */
export * as TokenBucket from "./token-bucket"

import type { Admission } from "@opencode-ai/schema/lifecycle/admission"

/**
 * Build a fresh bucket at full capacity. `capacity` and `refillPerSecond` are
 * floored and clamped non-negative — a bucket never starts above its own
 * hard ceiling (FR34).
 */
export function createBucket(capacity: number, refillPerSecond: number): Admission.TokenBucketState {
  const clampedCapacity = clampNonNegativeInt(capacity)
  return {
    capacity: clampedCapacity,
    available: clampedCapacity,
    refill_per_second: clampNonNegativeInt(refillPerSecond),
  }
}

/**
 * Refill by elapsed wall-clock milliseconds. `available` is always capped at
 * `capacity` — refill can never relax the hard ceiling (FR34). A non-positive
 * or non-finite `elapsedMs` is a no-op (never a negative refill).
 */
export function refill(bucket: Admission.TokenBucketState, elapsedMs: number): Admission.TokenBucketState {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return bucket
  const grown = bucket.available + (bucket.refill_per_second * elapsedMs) / 1000
  const available = Math.min(bucket.capacity, grown)
  if (available === bucket.available) return bucket
  return { ...bucket, available }
}

export interface AcquireResult {
  readonly bucket: Admission.TokenBucketState
  /** Tokens actually granted: `min(requested, available)`, never negative. */
  readonly granted: number
}

/**
 * Acquire up to `requested` tokens without refilling first. `granted` is
 * `min(requested, available)` — a request never drains below zero and never
 * exceeds what is presently available (no unbounded grant, C11, FR30).
 */
export function tryAcquire(bucket: Admission.TokenBucketState, requested: number): AcquireResult {
  const want = clampNonNegativeInt(requested)
  const granted = Math.min(want, bucket.available)
  if (granted <= 0) return { bucket, granted: 0 }
  return { bucket: { ...bucket, available: bucket.available - granted }, granted }
}

/** Refill by `elapsedMs` then acquire up to `requested` tokens in one call. */
export function acquire(bucket: Admission.TokenBucketState, elapsedMs: number, requested: number): AcquireResult {
  return tryAcquire(refill(bucket, elapsedMs), requested)
}

/** Tokens presently available, never above the hard ceiling. */
export function available(bucket: Admission.TokenBucketState): number {
  return bucket.available
}

/** True once refunding tokens back to the bucket after a rejected/cancelled admission. */
export function release(bucket: Admission.TokenBucketState, count: number): Admission.TokenBucketState {
  const give = clampNonNegativeInt(count)
  if (give <= 0) return bucket
  return { ...bucket, available: Math.min(bucket.capacity, bucket.available + give) }
}

function clampNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}
