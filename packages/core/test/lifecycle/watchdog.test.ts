import { describe, expect, test } from "bun:test"
import { createWatchdog, DEFAULT_LEASE_TTL_MS, DEFAULT_SWEEP_INTERVAL_MS } from "@opencode-ai/core/lifecycle/watchdog"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"

const processId = (id: string) => id as Ids.ProcessId
const runtimeInstanceId = (id: string) => id as Ids.RuntimeInstanceId
const leaseId = (id: string) => id as Ids.LeaseId

function clock(startMs: number) {
  let now = startMs
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe("Watchdog (T021)", () => {
  test("acquire creates an in-memory lease with the default TTL", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now })
    const lease = watchdog.acquire({
      processId: processId("p1"),
      runtimeInstanceId: runtimeInstanceId("r1"),
      leaseId: leaseId("l1"),
    })
    expect(lease.expiresAtMs).toBe(DEFAULT_LEASE_TTL_MS)
    expect(watchdog.size()).toBe(1)
  })

  test("heartbeat renews a matching, not-yet-expired lease", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 1000 })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    c.advance(500)
    const renewed = watchdog.heartbeat({ processId: processId("p1"), leaseId: leaseId("l1") })
    expect(renewed).toBe(true)
    expect(watchdog.leaseFor(processId("p1"))?.expiresAtMs).toBe(1500)
  })

  test("heartbeat rejects an unknown process, a mismatched lease id, or an already-expired lease", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 100 })
    expect(watchdog.heartbeat({ processId: processId("ghost"), leaseId: leaseId("l1") })).toBe(false)

    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    expect(watchdog.heartbeat({ processId: processId("p1"), leaseId: leaseId("wrong") })).toBe(false)

    c.advance(200)
    expect(watchdog.heartbeat({ processId: processId("p1"), leaseId: leaseId("l1") })).toBe(false)
  })

  test("release drops the lease so a later sweep never assesses it", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 10 })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    watchdog.release(processId("p1"))
    expect(watchdog.size()).toBe(0)
    c.advance(1000)
    expect(watchdog.sweep()).toEqual([])
  })

  test("sweep only assesses leases whose bucket is due, never scanning fresh leases", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 1000, sweepIntervalMs: 100 })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    expect(watchdog.sweep(500)).toEqual([]) // not yet due (expires at 1000)
    expect(watchdog.size()).toBe(1)
    expect(watchdog.sweep(1000)).toHaveLength(1) // due now
    expect(watchdog.size()).toBe(0)
  })

  test("expired lease with a confirmed-dead owner publishes owner_lost, never claiming a provider stopped", () => {
    const c = clock(0)
    const watchdog = createWatchdog({
      nowMs: c.now,
      leaseTtlMs: 10,
      ownerLiveness: { isAlive: () => false },
    })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    const assessments = watchdog.sweep(10)
    expect(assessments).toHaveLength(1)
    expect(assessments[0]!.outcome).toBe("owner_lost")
    expect(assessments[0]!.process_id).toBe(processId("p1"))
    expect(assessments[0]!.reason).not.toMatch(/provider|tool/i)
  })

  test("expired lease with a confirmed-alive owner publishes zombie_detected", () => {
    const c = clock(0)
    const watchdog = createWatchdog({
      nowMs: c.now,
      leaseTtlMs: 10,
      ownerLiveness: { isAlive: () => true },
    })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    const assessments = watchdog.sweep(10)
    expect(assessments[0]!.outcome).toBe("zombie_detected")
  })

  test("expired lease with no liveness port (or unknown liveness) publishes unknown, never fabricating owner_lost", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 10 })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    const assessments = watchdog.sweep(10)
    expect(assessments[0]!.outcome).toBe("unknown")
  })

  test("a fresh heartbeat before expiry removes the lease from the due bucket (never a stale sweep)", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 1000, sweepIntervalMs: 100 })
    watchdog.acquire({ processId: processId("p1"), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId("l1") })
    c.advance(900)
    expect(watchdog.heartbeat({ processId: processId("p1"), leaseId: leaseId("l1") })).toBe(true)
    // Renewed lease now expires at 900 + 1000 = 1900, well past the original due bucket at 1000.
    expect(watchdog.sweep(1000)).toEqual([])
    expect(watchdog.size()).toBe(1)
  })

  test("single shared sweeper assesses every due process in one call, never one timer per Task", () => {
    const c = clock(0)
    const watchdog = createWatchdog({ nowMs: c.now, leaseTtlMs: 10, sweepIntervalMs: DEFAULT_SWEEP_INTERVAL_MS })
    for (const id of ["p1", "p2", "p3"]) {
      watchdog.acquire({ processId: processId(id), runtimeInstanceId: runtimeInstanceId("r1"), leaseId: leaseId(`lease-${id}`) })
    }
    c.advance(10)
    const assessments = watchdog.sweep()
    expect(assessments).toHaveLength(3)
    expect(watchdog.size()).toBe(0)
  })
})
