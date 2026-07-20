/**
 * Feature 018 / Group B (T008, T009) — `jobs.run-now` as an effectful mutation plan.
 *
 * Proves, over the REAL `createLiveJobsBackend` + `mutateAuthority` pipeline (memory
 * ConfigPort + memory idempotency, no server):
 *   - a run-now enqueues ONE immediate occurrence through the bound executor seam and
 *     the effect runs EXACTLY ONCE after the contract/CAS checks (T008);
 *   - an overlap rejection / disarmed executor returns a typed failure and commits
 *     NOTHING — no phantom write, the effect still ran once (T009);
 *   - a disabled definition is a typed failure BEFORE any plan/effect (T009);
 *   - an unbound executor keeps run-now the honest `unavailable` capability gap.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort, createMemoryIdempotencyPort } from "@/operator/adapters"
import { mutateAuthority } from "@/operator/application"
import { createOperatorJobPersistence, OperatorJobPersistence } from "@/operator/jobs/persistence"
import { createLiveJobsBackend, type RunNowEnqueuePort, type RunNowEnqueueResult } from "@/operator/jobs/backend-live"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { CommandRequest } from "@opencode-ai/core/operator"
import type { JobsCreateInput, JobsError } from "@opencode-ai/protocol/jobs/commands"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)
const principal = { kind: "operator", id: "op_1" } as const

const createInput = (over: Partial<JobsCreateInput> = {}): JobsCreateInput => ({
  name: over.name ?? "nightly",
  description: "",
  schedule: { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
  actionType: "native_maintenance",
  overlapPolicy: over.overlapPolicy ?? "forbid",
  misfirePolicy: "skip",
  scope: "project",
  scopeId: "proj_1",
  payloadRef: "secretref_keychain_1",
  principal,
})

async function commit(config: ReturnType<typeof createMemoryConfigPort>, plan: OperatorMutationPlan): Promise<void> {
  const current = await config.get(plan.authority)
  const cas = await config.compareAndSet({
    authority: plan.authority,
    expectedVersion: current?.version ?? null,
    payload: plan.apply(current?.payload ?? null),
    nowMs: 0,
  })
  if (!cas.ok) throw new Error(`commit failed: ${JSON.stringify(cas)}`)
}

/** A recording run-now port returning a fixed outcome. */
function fakeRunNow(result: RunNowEnqueueResult): { port: RunNowEnqueuePort; calls: number } {
  const state = { calls: 0 }
  const port: RunNowEnqueuePort = async () => {
    state.calls++
    return result
  }
  return {
    port,
    get calls() {
      return state.calls
    },
  }
}

function req(version: string | undefined): CommandRequest {
  return {
    id: "jobs.run-now" as CommandRequest["id"],
    principal: { kind: "operator", subject: "op_1", projectBinding: null },
    scope: { kind: "project", ref: "proj_1" },
    source: "cli",
    isTty: false,
    confirm: false,
    idempotencyKey: "idemp-" + Math.random().toString(36).slice(2),
    version,
  }
}

/** Seed a committed enabled definition and return the created id + config/persistence. */
async function seed(over: Partial<JobsCreateInput> = {}) {
  const config = createMemoryConfigPort()
  let n = 0
  const persistence = createOperatorJobPersistence({ config, clock: () => 1_721_260_800_000, idGen: (p) => `${p}_${++n}` })
  await commit(config, await run(persistence.planCreate(createInput(over))))
  return { config, persistence, jobDefinitionId: "job_1" }
}

describe("T008 run-now effectful mutation plan — enqueues once after the checks", () => {
  test("a dispatch enqueues one immediate occurrence and commits (effect runs once)", async () => {
    const { config, persistence, jobDefinitionId } = await seed()
    const runNow = fakeRunNow({ outcome: "enqueued", occurrenceId: "occ_now" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })

    const plan = await run(backend.planRunNow({ jobDefinitionId, principal }))
    expect(plan.authority).toBe(OperatorJobPersistence.AUTHORITY)

    const version = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    const result = await mutateAuthority(
      { config, idempotency: createMemoryIdempotencyPort() },
      { request: req(version), authority: plan.authority, apply: plan.apply, effect: plan.effect, effectOnly: plan.effectOnly },
    )
    expect(result.ok).toBe(true)
    expect(runNow.calls).toBe(1) // the effect ran exactly once, after the CAS check
  })

  test("a successful run-now leaves the jobs authority version UNCHANGED (effect-only, no CAS churn)", async () => {
    const { config, persistence, jobDefinitionId } = await seed()
    const runNow = fakeRunNow({ outcome: "enqueued", occurrenceId: "occ_now" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })

    const before = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    const plan = await run(backend.planRunNow({ jobDefinitionId, principal }))
    expect(plan.effectOnly).toBe(true)
    const result = await mutateAuthority(
      { config, idempotency: createMemoryIdempotencyPort() },
      { request: req(before), authority: plan.authority, apply: plan.apply, effect: plan.effect, effectOnly: plan.effectOnly },
    )
    expect(result.ok).toBe(true)
    expect(runNow.calls).toBe(1) // still enqueued exactly once
    // No CAS churn: a successful run-now does NOT bump the definitions authority version,
    // so it never spuriously conflicts with a concurrent definition edit (ADR-0018).
    const after = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    expect(after).toBe(before)
  })

  test("a successful run-now is idempotent — a replay does not re-enqueue", async () => {
    const { config, persistence, jobDefinitionId } = await seed()
    const runNow = fakeRunNow({ outcome: "enqueued", occurrenceId: "occ_now" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })
    const idempotency = createMemoryIdempotencyPort()
    const before = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    const request = req(before)

    const plan = await run(backend.planRunNow({ jobDefinitionId, principal }))
    const first = await mutateAuthority(
      { config, idempotency },
      { request, authority: plan.authority, apply: plan.apply, effect: plan.effect, effectOnly: plan.effectOnly },
    )
    const second = await mutateAuthority(
      { config, idempotency },
      { request, authority: plan.authority, apply: plan.apply, effect: plan.effect, effectOnly: plan.effectOnly },
    )
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.outcome).toBe("idempotent_replay")
    expect(runNow.calls).toBe(1) // the replay did NOT re-run the enqueue effect
  })
})

describe("T009 run-now honest outcomes — typed failure, no phantom write", () => {
  test("an overlap rejection returns a typed failure and commits nothing (no phantom)", async () => {
    const { config, persistence, jobDefinitionId } = await seed()
    const runNow = fakeRunNow({ outcome: "overlap_rejected", reason: "overlap policy forbids a concurrent occurrence" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })

    const before = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    const plan = await run(backend.planRunNow({ jobDefinitionId, principal }))
    const result = await mutateAuthority(
      { config, idempotency: createMemoryIdempotencyPort() },
      { request: req(before), authority: plan.authority, apply: plan.apply, effect: plan.effect },
    )
    expect(result.ok).toBe(false)
    expect(runNow.calls).toBe(1)
    // No phantom write: the jobs authority version is unchanged (the effect aborted before CAS).
    const after = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    expect(after).toBe(before)
  })

  test("a disarmed executor returns a typed unavailable and commits nothing", async () => {
    const { config, persistence, jobDefinitionId } = await seed()
    const runNow = fakeRunNow({ outcome: "executor_unavailable", reason: "executor disarmed" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })

    const before = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    const plan = await run(backend.planRunNow({ jobDefinitionId, principal }))
    const result = await mutateAuthority(
      { config, idempotency: createMemoryIdempotencyPort() },
      { request: req(before), authority: plan.authority, apply: plan.apply, effect: plan.effect },
    )
    expect(result.ok).toBe(false)
    const after = (await config.get(OperatorJobPersistence.AUTHORITY))!.version
    expect(after).toBe(before)
  })

  test("a disabled definition is a typed failure BEFORE any plan/effect", async () => {
    const { config, persistence, jobDefinitionId } = await seed()
    await commit(config, await run(persistence.planDisable({ jobDefinitionId, expectedVersion: 0, principal })))
    const runNow = fakeRunNow({ outcome: "enqueued", occurrenceId: "occ_x" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })

    const result = await exit(backend.planRunNow({ jobDefinitionId, principal }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("disabled")
    expect(runNow.calls).toBe(0) // never enqueued
  })

  test("a not-found definition is a typed failure, never a fabricated occurrence", async () => {
    const { persistence } = await seed()
    const runNow = fakeRunNow({ outcome: "enqueued", occurrenceId: "occ_x" })
    const backend = createLiveJobsBackend({ persistence, runNow: runNow.port })
    const result = await exit(backend.planRunNow({ jobDefinitionId: "job_absent", principal }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain("not_found")
    expect(runNow.calls).toBe(0)
  })

  test("an unbound executor keeps run-now the honest unavailable gap", async () => {
    const { persistence, jobDefinitionId } = await seed()
    const backend = createLiveJobsBackend({ persistence }) // no runNow bound
    const result = await exit(backend.planRunNow({ jobDefinitionId, principal }))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(JSON.stringify((result.cause as { toJSON: () => unknown }).toJSON())).toContain("unavailable")
  })
})
