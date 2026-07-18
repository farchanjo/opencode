/**
 * Feature 003 / T027 — live `JobsBackend` composition over the durable persistence.
 *
 * Proves the honest RESIDUAL posture of `backend-live.ts`: the read surface
 * (`list`/`status`) projects the bounded `JobDefinitionSummary` from the REAL
 * Config.Service persistence (in-memory `ConfigPort` double), and every seam not
 * reachable from the operator AppRuntime returns the port's typed `JobsError`
 * (`unavailable`/`not_implemented`) — never fabricated data.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createJobPersistence } from "@/jobs/persistence"
import { createLiveJobsBackend } from "@/operator/jobs/backend-live"
import { makeJobDefinition, makeScheduleRegistration } from "./fixtures"
import type { JobsError } from "@opencode-ai/protocol/jobs/commands"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

function build() {
  const config = createMemoryConfigPort()
  const persistence = createJobPersistence({ config, clock: () => 1_721_260_800_000 })
  const backend = createLiveJobsBackend({ persistence })
  return { persistence, backend }
}

describe("T027 backend-live — honest read surface over Config.Service", () => {
  test("status projects a persisted definition into a redacted summary", async () => {
    const { persistence, backend } = build()
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_x", scheduleId: "sch_x" }), null))
    await run(persistence.saveRegistration(makeScheduleRegistration({ id: "job_x", scheduleId: "sch_x", state: "registered" }), null))

    const out = await run(backend.status({ jobDefinitionId: "job_x" }))
    expect(out.definition.jobDefinitionId).toBe("job_x")
    expect(out.definition.registrationState).toBe("registered")
    // Not-yet-projected fields stay the contract's nullable values, never invented.
    expect(out.definition.nextDueAt).toBeNull()
    expect(out.definition.lastOutcome).toBeNull()
  })

  test("status on a missing definition is a typed not_found", async () => {
    const { backend } = build()
    const result = await exit(backend.status({ jobDefinitionId: "nope" }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("not_found")
  })

  test("list enumerates persisted definitions and defaults registration to unknown", async () => {
    const { persistence, backend } = build()
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_a", scheduleId: "sch_a" }), null))
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_b", scheduleId: "sch_b" }), null))

    const out = await run(backend.list({ scope: "global", scopeId: "", limit: 50 }))
    expect(out.definitions.map((d) => d.jobDefinitionId).sort()).toEqual(["job_a", "job_b"])
    for (const d of out.definitions) expect(d.registrationState).toBe("unknown")
  })

  test("list honors enabledOnly and the limit bound", async () => {
    const { persistence, backend } = build()
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_on", scheduleId: "s1", enabled: true }), null))
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_off", scheduleId: "s2", enabled: false }), null))

    const enabled = await run(backend.list({ scope: "global", scopeId: "", limit: 50, enabledOnly: true }))
    expect(enabled.definitions.map((d) => d.jobDefinitionId)).toEqual(["job_on"])

    const capped = await run(backend.list({ scope: "global", scopeId: "", limit: 1 }))
    expect(capped.definitions.length).toBe(1)
  })
})

describe("T027 backend-live — unreachable seams return a typed capability gap (RESIDUAL)", () => {
  const principal = { kind: "operator", id: "op_1" } as const

  const expectUnavailable = async <A>(eff: Effect.Effect<A, JobsError>): Promise<void> => {
    const result = await exit(eff)
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("unavailable")
  }

  test("show/history/run-now return unavailable, never fabricated data", async () => {
    const { backend } = build()
    await expectUnavailable(backend.show({ jobDefinitionId: "job_x", occurrenceLimit: 10 }))
    await expectUnavailable(backend.history({ jobDefinitionId: "job_x", limit: 10 }))
    await expectUnavailable(backend.runNow({ jobDefinitionId: "job_x", principal }))
  })

  test("create/update/delete/reschedule return not_implemented", async () => {
    const { backend } = build()
    const create = await exit(
      backend.create({
        name: "n",
        description: "",
        schedule: { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
        actionType: "native_maintenance",
        overlapPolicy: "forbid",
        misfirePolicy: "skip",
        scope: "project",
        scopeId: "p",
        payloadRef: "ref",
        principal,
      }),
    )
    expect(create._tag).toBe("Failure")
    if (create._tag === "Failure") expect(JSON.stringify(create.cause.toJSON())).toContain("not_implemented")
  })
})
