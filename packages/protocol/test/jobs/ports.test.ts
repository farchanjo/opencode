/**
 * Feature 003 / T032 — SchedulerPort / NotificationPort / JobsPort method
 * completeness (FR30, C12).
 *
 * `packages/protocol/src/jobs/ports.ts` declares plain TypeScript
 * `interface`s (no Effect `Schema`, unlike the Feature 002 lifecycle
 * precedent), so there is no runtime decoder to round-trip. The
 * `satisfies Record<keyof Port, true>` pattern below pins the exact method
 * set at compile time: TypeScript's excess-property check on a `satisfies`
 * object literal rejects both a missing key (the `Record` requires every
 * key) and an extra key (excess-property checking on the fresh literal), so
 * any drift in `ports.ts` fails `tsgo --noEmit` here. The matching runtime
 * assertion keeps the pin visible to `bun test` as well.
 */
import { describe, expect, test } from "bun:test"
import type { JobsError, JobsPort, NotificationError, NotificationPort, SchedulerError, SchedulerPort } from "../../src/jobs"

const schedulerPortMethods = {
  register: true,
  unregister: true,
  reconcile: true,
  tick: true,
} satisfies Record<keyof SchedulerPort, true>

const notificationPortMethods = {
  enqueue: true,
  deliverAtBoundary: true,
  ack: true,
  expire: true,
  audit: true,
  observe: true,
} satisfies Record<keyof NotificationPort, true>

const jobsPortMethods = {
  list: true,
  status: true,
  show: true,
  create: true,
  update: true,
  enable: true,
  disable: true,
  delete: true,
  reschedule: true,
  runNow: true,
  history: true,
  watch: true,
} satisfies Record<keyof JobsPort, true>

describe("SchedulerPort — register / unregister / reconcile / tick (FR4, C1)", () => {
  test("declares exactly the four registration/reconciliation/tick methods", () => {
    expect(Object.keys(schedulerPortMethods).sort()).toEqual(["reconcile", "register", "tick", "unregister"])
  })
})

describe("NotificationPort — enqueue / deliverAtBoundary / ack / expire / audit / observe (FR20, C8)", () => {
  test("declares exactly the six bounded async-channel methods", () => {
    expect(Object.keys(notificationPortMethods).sort()).toEqual([
      "ack",
      "audit",
      "deliverAtBoundary",
      "enqueue",
      "expire",
      "observe",
    ])
  })
})

describe("JobsPort — the twelve canonical jobs.* operator operations (FR30, FR31, C12)", () => {
  test("declares exactly the twelve operations enumerated in tasks.md T027/T028", () => {
    expect(Object.keys(jobsPortMethods).sort()).toEqual([
      "create",
      "delete",
      "disable",
      "enable",
      "history",
      "list",
      "reschedule",
      "runNow",
      "show",
      "status",
      "update",
      "watch",
    ])
  })
})

describe("Typed error unions carry the closed set of type discriminants (satisfies-pinned)", () => {
  test("SchedulerError — every variant is constructible against the interface", () => {
    const variants: ReadonlyArray<SchedulerError> = [
      { type: "capability_unsupported", capability: "os_level" },
      { type: "invalid_schedule", reason: "bad cron expression" },
      { type: "second_authority_rejected", reason: "not the canonical scheduler" },
      { type: "unauthorized", reason: "no operator grant" },
      { type: "unavailable", reason: "config service offline" },
      { type: "not_implemented" },
    ]
    expect(new Set(variants.map((v) => v.type)).size).toBe(6)
  })

  test("NotificationError — every variant is constructible against the interface", () => {
    const variants: ReadonlyArray<NotificationError> = [
      { type: "unauthorized", reason: "no observer grant" },
      { type: "cross_scope_leak_rejected", reason: "cross-project leakage" },
      { type: "invalid_action", reason: "raw prompt injection rejected" },
      { type: "not_found", notificationId: "ntf_1" },
      { type: "unavailable", reason: "observation seam offline" },
      { type: "not_implemented" },
    ]
    expect(new Set(variants.map((v) => v.type)).size).toBe(6)
  })

  test("JobsError — every variant is constructible against the interface", () => {
    const variants: ReadonlyArray<JobsError> = [
      { type: "not_found", jobDefinitionId: "jdf_1" },
      { type: "unauthorized", reason: "no operator grant" },
      { type: "version_conflict", expectedVersion: 1, actualVersion: 2 },
      { type: "invalid_argument", field: "schedule", reason: "unsupported timezone" },
      { type: "reserved_name", id: "job.definition_created" },
      { type: "capability_unsupported", capability: "os_level" },
      { type: "unavailable", reason: "registry offline" },
      { type: "not_implemented" },
    ]
    expect(new Set(variants.map((v) => v.type)).size).toBe(8)
  })
})
