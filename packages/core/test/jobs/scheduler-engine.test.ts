import { describe, expect, test } from "bun:test"
import { SchedulerEngine } from "@opencode-ai/core/jobs/scheduler-engine"
import type { JobDefinition } from "@opencode-ai/schema/jobs/definition"

// Feature 003 / T031 (S18) — scheduler engine maps a definition to a registration
// intent, builds the occurrence idempotency tuple, and measures lag from the
// nominal due instant (FR3, FR6, C5, C6). Pure, total, zero I/O — it authors NO
// sequence/attempt/generation (executor-owned, C6). Only the fields the engine
// reads are populated; the rest are cast through `as never` as in the Feature 002
// exemplars.

/** Build a minimal definition exposing only the fields `planRegistration` reads. */
const definition = (overrides: {
  id: string
  scheduleId: string
  enabled: boolean
  capabilitySurface: "in_process" | "os_level"
}): JobDefinition =>
  ({
    id: overrides.id,
    schedule: { schedule_id: overrides.scheduleId, enabled: overrides.enabled },
    policy: { capability_surface: overrides.capabilitySurface },
  }) as never

describe("SchedulerEngine.planRegistration — definition → registration intent (FR3, FR6, C5)", () => {
  test("an enabled definition intends to register with an initial pending state", () => {
    const plan = SchedulerEngine.planRegistration(
      definition({ id: "job_1", scheduleId: "sch_1", enabled: true, capabilitySurface: "in_process" }),
    )
    expect(plan.intent).toBe("register")
    expect(plan.state).toBe("pending")
    expect(plan.job_definition_id).toBe("job_1" as never)
    expect(plan.schedule_id).toBe("sch_1" as never)
    expect(plan.capability_surface).toBe("in_process")
  })

  test("a disabled definition intends to unregister (the compensating effect)", () => {
    const plan = SchedulerEngine.planRegistration(
      definition({ id: "job_2", scheduleId: "sch_2", enabled: false, capabilitySurface: "os_level" }),
    )
    expect(plan.intent).toBe("unregister")
    expect(plan.state).toBe("pending")
    expect(plan.capability_surface).toBe("os_level")
  })

  test("the initial state is always pending — settled states are owned elsewhere (C5)", () => {
    for (const enabled of [true, false]) {
      const plan = SchedulerEngine.planRegistration(
        definition({ id: "j", scheduleId: "s", enabled, capabilitySurface: "in_process" }),
      )
      expect(plan.state).toBe("pending")
    }
  })
})

describe("SchedulerEngine.planStartupRegistrations — batch rehydration (FR3, C5, AC2)", () => {
  test("every definition yields a plan; intents follow the enabled flag, order preserved", () => {
    const defs = [
      definition({ id: "a", scheduleId: "sa", enabled: true, capabilitySurface: "in_process" }),
      definition({ id: "b", scheduleId: "sb", enabled: false, capabilitySurface: "in_process" }),
      definition({ id: "c", scheduleId: "sc", enabled: true, capabilitySurface: "os_level" }),
    ]
    const plans = SchedulerEngine.planStartupRegistrations(defs)
    expect(plans).toHaveLength(3)
    expect(plans.map((p) => p.intent)).toEqual(["register", "unregister", "register"])
    expect(plans.map((p) => p.job_definition_id)).toEqual(["a", "b", "c"] as never)
  })

  test("an empty batch yields no plans", () => {
    expect(SchedulerEngine.planStartupRegistrations([])).toHaveLength(0)
  })
})

describe("SchedulerEngine.buildIdempotencyKey — the (def, schedule, nominal, generation) tuple (FR10, C6)", () => {
  test("assembles the four-part tuple verbatim", () => {
    const key = SchedulerEngine.buildIdempotencyKey(
      "job_1" as never,
      "sch_1" as never,
      "2026-07-18T00:00:00.000Z" as never,
      3 as never,
    )
    expect(key.job_definition_id).toBe("job_1" as never)
    expect(key.schedule_id).toBe("sch_1" as never)
    expect(key.nominal_due_time).toBe("2026-07-18T00:00:00.000Z" as never)
    expect(key.generation).toBe(3 as never)
  })

  test("the same inputs always produce a structurally equal tuple (stable identity)", () => {
    const a = SchedulerEngine.buildIdempotencyKey("j" as never, "s" as never, "t" as never, 0 as never)
    const b = SchedulerEngine.buildIdempotencyKey("j" as never, "s" as never, "t" as never, 0 as never)
    expect(a).toEqual(b)
  })

  test("generation is carried, not authored — a distinct generation yields a distinct tuple", () => {
    const g0 = SchedulerEngine.buildIdempotencyKey("j" as never, "s" as never, "t" as never, 0 as never)
    const g1 = SchedulerEngine.buildIdempotencyKey("j" as never, "s" as never, "t" as never, 1 as never)
    expect(g0.generation).not.toBe(g1.generation)
  })
})

describe("SchedulerEngine.measureScheduleLagMs — lag from nominal due (FR19, AC3, AC4)", () => {
  test("positive when observed after nominal, clamped to zero when before", () => {
    expect(SchedulerEngine.measureScheduleLagMs(1_000, 4_000)).toBe(3_000)
    expect(SchedulerEngine.measureScheduleLagMs(4_000, 1_000)).toBe(0)
  })
})
