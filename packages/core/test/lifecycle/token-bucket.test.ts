import { describe, expect, test } from "bun:test"
import { acquire, createBucket, refill, release, tryAcquire } from "@opencode-ai/core/lifecycle/admission/token-bucket"

describe("TokenBucket (T019)", () => {
  test("createBucket starts full and never above the hard ceiling", () => {
    const bucket = createBucket(5, 2)
    expect(bucket.capacity).toBe(5)
    expect(bucket.available).toBe(5)
    expect(bucket.refill_per_second).toBe(2)
  })

  test("createBucket clamps negative/non-finite inputs to zero", () => {
    const bucket = createBucket(-3, Number.NaN)
    expect(bucket.capacity).toBe(0)
    expect(bucket.available).toBe(0)
    expect(bucket.refill_per_second).toBe(0)
  })

  test("tryAcquire grants min(requested, available)", () => {
    const bucket = createBucket(4, 1)
    const first = tryAcquire(bucket, 3)
    expect(first.granted).toBe(3)
    expect(first.bucket.available).toBe(1)

    const second = tryAcquire(first.bucket, 3)
    expect(second.granted).toBe(1)
    expect(second.bucket.available).toBe(0)

    const third = tryAcquire(second.bucket, 1)
    expect(third.granted).toBe(0)
    expect(third.bucket).toBe(second.bucket)
  })

  test("refill never exceeds the hard ceiling (capacity is never relaxed)", () => {
    const bucket = { capacity: 10, available: 0, refill_per_second: 100 }
    const refilled = refill(bucket, 10_000)
    expect(refilled.available).toBe(10)
  })

  test("refill is a no-op for non-positive or non-finite elapsed time", () => {
    const bucket = createBucket(10, 5)
    expect(refill(bucket, 0)).toBe(bucket)
    expect(refill(bucket, -5)).toBe(bucket)
    expect(refill(bucket, Number.NaN)).toBe(bucket)
  })

  test("acquire composes refill then tryAcquire in one call", () => {
    const bucket = { capacity: 10, available: 0, refill_per_second: 10 }
    const result = acquire(bucket, 1000, 5)
    expect(result.granted).toBe(5)
    expect(result.bucket.available).toBe(5)
  })

  test("release returns tokens without exceeding capacity", () => {
    const bucket = { capacity: 5, available: 1, refill_per_second: 1 }
    const released = release(bucket, 100)
    expect(released.available).toBe(5)
  })

  test("release is a no-op for non-positive counts", () => {
    const bucket = createBucket(5, 1)
    expect(release(bucket, 0)).toBe(bucket)
    expect(release(bucket, -1)).toBe(bucket)
  })
})
