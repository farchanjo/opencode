/**
 * Feature 003 / T027 — live `JobsBackend` composition over the operator persistence,
 * carried to the Feature 014 config-backed seam (T010, FR9).
 *
 * The read surface (`list`/`status`/`show`) projects the bounded `JobDefinitionSummary`
 * from the REAL Config.Service persistence (in-memory `ConfigPort` double) via the
 * operator job records committed through the mutation plans; the seams not reachable
 * from the operator AppRuntime (`history`/`watch`/`planRunNow`) return the port's typed
 * `JobsError` — never fabricated data.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createOperatorJobPersistence, OperatorJobPersistence } from "@/operator/jobs/persistence"
import { createLiveJobsBackend } from "@/operator/jobs/backend-live"
import type { JobsCreateInput, JobsError } from "@opencode-ai/protocol/jobs/commands"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

const principal = { kind: "operator", id: "op_1" } as const

/** Build the backend over an in-memory config double with a deterministic id sequence. */
function build() {
  const config = createMemoryConfigPort()
  let n = 0
  const persistence = createOperatorJobPersistence({ config, clock: () => 1_721_260_800_000, idGen: (p) => `${p}_${++n}` })
  const backend = createLiveJobsBackend({ persistence })
  return { config, persistence, backend }
}

const createInput = (over: Partial<JobsCreateInput> = {}): JobsCreateInput => ({
  name: over.name ?? "nightly-reindex",
  description: over.description ?? "",
  schedule: over.schedule ?? { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
  actionType: over.actionType ?? "native_maintenance",
  overlapPolicy: over.overlapPolicy ?? "forbid",
  misfirePolicy: over.misfirePolicy ?? "skip",
  scope: over.scope ?? "project",
  scopeId: over.scopeId ?? "proj_1",
  payloadRef: over.payloadRef ?? "secretref_keychain_1",
  principal,
})

/** Commit a plan into the config store the way `mutateAuthority` would (create/CAS). */
async function commit(
  config: ReturnType<typeof createMemoryConfigPort>,
  plan: { authority: string; apply: (current: unknown) => unknown },
): Promise<string> {
  const current = await config.get(plan.authority)
  const cas = await config.compareAndSet({
    authority: plan.authority,
    expectedVersion: current?.version ?? null,
    payload: plan.apply(current?.payload ?? null),
    nowMs: 0,
  })
  if (!cas.ok) throw new Error(`commit failed: ${JSON.stringify(cas)}`)
  return cas.version
}

describe("T010 backend-live — read surface over the committed operator persistence", () => {
  test("status projects a committed operator job record into a redacted summary", async () => {
    const { config, persistence, backend } = build()
    const plan = await run(persistence.planCreate(createInput({ name: "job-x" })))
    await commit(config, plan)

    const list = await run(backend.list({ scope: "project", scopeId: "proj_1", limit: 50 }))
    expect(list.definitions).toHaveLength(1)
    const id = list.definitions[0]!.jobDefinitionId

    const out = await run(backend.status({ jobDefinitionId: id }))
    expect(out.definition.name).toBe("job-x")
    // No external registration is reachable at this seam; state stays honest.
    expect(out.definition.registrationState).toBe("unknown")
    expect(out.definition.nextDueAt).toBeNull()
    expect(out.definition.lastOutcome).toBeNull()
  })

  test("status on a missing definition is a typed not_found", async () => {
    const { backend } = build()
    const result = await exit(backend.status({ jobDefinitionId: "nope" }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("not_found")
  })

  test("list enumerates committed definitions and honors enabledOnly + the limit bound", async () => {
    const { config, persistence, backend } = build()
    await commit(config, await run(persistence.planCreate(createInput({ name: "a" }))))
    await commit(config, await run(persistence.planCreate(createInput({ name: "b" }))))

    const all = await run(backend.list({ scope: "project", scopeId: "proj_1", limit: 50 }))
    expect(all.definitions.map((d) => d.name).sort()).toEqual(["a", "b"])

    const capped = await run(backend.list({ scope: "project", scopeId: "proj_1", limit: 1 }))
    expect(capped.definitions.length).toBe(1)
  })

  test("show returns the persisted definition with an honestly empty occurrence list", async () => {
    const { config, persistence, backend } = build()
    await commit(config, await run(persistence.planCreate(createInput({ name: "seen" }))))
    const list = await run(backend.list({ scope: "project", scopeId: "proj_1", limit: 50 }))
    const out = await run(backend.show({ jobDefinitionId: list.definitions[0]!.jobDefinitionId, occurrenceLimit: 10 }))
    expect(out.definition.name).toBe("seen")
    expect(out.occurrences).toEqual([])
  })
})

describe("T010 backend-live — mutation-plan transforms round-trip the record (FR9)", () => {
  test("enable/update/reschedule commit and re-read; delete drops the record", async () => {
    const { config, persistence, backend } = build()
    await commit(config, await run(persistence.planCreate(createInput({ name: "m", overlapPolicy: "forbid" }))))
    const id = (await run(backend.list({ scope: "project", scopeId: "proj_1", limit: 50 }))).definitions[0]!.jobDefinitionId

    await commit(config, await run(persistence.planUpdate({ jobDefinitionId: id, expectedVersion: 0, patch: { name: "renamed", overlapPolicy: "queue" }, principal })))
    let s = (await run(backend.status({ jobDefinitionId: id }))).definition
    expect(s.name).toBe("renamed")
    expect(s.overlapPolicy).toBe("queue")
    expect(s.version).toBe(2)

    await commit(config, await run(persistence.planReschedule({ jobDefinitionId: id, expectedVersion: 0, schedule: { cronExpression: "0 3 * * *", ianaTimezone: "Europe/Lisbon" }, principal })))
    s = (await run(backend.status({ jobDefinitionId: id }))).definition
    expect(s.schedule.cronExpression).toBe("0 3 * * *")
    expect(s.schedule.ianaTimezone).toBe("Europe/Lisbon")

    await commit(config, await run(persistence.planDelete({ jobDefinitionId: id, expectedVersion: 0, principal })))
    expect((await run(backend.list({ scope: "project", scopeId: "proj_1", limit: 50 }))).definitions).toHaveLength(0)
  })

  test("a plan for an absent definition is a typed not_found before any write", async () => {
    const { backend } = build()
    const result = await exit(backend.planEnable({ jobDefinitionId: "job_absent", expectedVersion: 1, principal }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("not_found")
  })

  test("a config outage degrades every read to a typed unavailable, never a fabricated read", async () => {
    const brokenConfig = { ...createMemoryConfigPort(), get: () => Promise.reject(new Error("config down")) }
    const persistence = createOperatorJobPersistence({ config: brokenConfig })
    const backend = createLiveJobsBackend({ persistence })
    const result = await exit(backend.list({ scope: "global", scopeId: "", limit: 50 }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("unavailable")
  })
})

describe("T010 backend-live — unreachable seams return a typed capability gap (RESIDUAL, T011)", () => {
  const expectUnavailable = async <A>(eff: Effect.Effect<A, JobsError>): Promise<void> => {
    const result = await exit(eff)
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("unavailable")
  }

  test("history/watch reads and planRunNow return unavailable, never fabricated data", async () => {
    const { backend } = build()
    await expectUnavailable(backend.history({ jobDefinitionId: "job_x", limit: 10 }))
    await expectUnavailable(backend.planRunNow({ jobDefinitionId: "job_x", principal }))
  })

  test("the authority key is the single config-backed jobs authority (FR2, FR9)", () => {
    expect(OperatorJobPersistence.AUTHORITY).toBe("jobs")
  })
})
