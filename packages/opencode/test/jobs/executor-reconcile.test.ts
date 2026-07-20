/**
 * Feature 018 / Group C (T011) — the persistence reconcile bridge that rehydrates
 * the eager executor from the committed operator `jobs` persistence.
 *
 * Proves, over the REAL `createOperatorJobPersistence` bound to an in-memory
 * ConfigPort double (no Bun runtime, no durable store):
 *   - a persisted ENABLED definition re-registers on the `arm()` startup sweep;
 *   - a persisted DISABLED definition is not re-registered;
 *   - `resolveDueContext` yields a definition-keyed view for an enabled definition
 *     (rootSessionId = jobDefinitionId) and drops a missing definition honestly.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createOperatorJobPersistence } from "@/operator/jobs/persistence"
import { ExecutorReconcile } from "@/jobs/executor-reconcile"
import { buildExecutorComposition, type ExecutorCompositionDeps } from "@/jobs/executor-composition"
import type { BunCronHandle, BunCronRuntime, DueSignal } from "@/jobs/bun-cron-adapter"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { JobsCreateInput } from "@opencode-ai/protocol/jobs/commands"
import { fakeCoordinator, fakeEmitter, fakeRegistry } from "./fixtures"
import type { OccurrenceRunner } from "@/jobs/executor-composition"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const principal = { kind: "operator", id: "op_1" } as const

function fakeCron(): BunCronRuntime {
  const registered: { handler: () => unknown }[] = []
  return {
    schedule: (expression, handler): BunCronHandle => {
      registered.push({ handler })
      return { cron: expression, stop: () => registered.splice(registered.findIndex((r) => r.handler === handler), 1) }
    },
    parse: () => new Date(Date.now() + 60_000),
    remove: () => Promise.resolve(),
  }
}

const fakeRunner: OccurrenceRunner = { run: () => Effect.succeed({ disposition: "completed" }) }

/** Build a memory-config persistence with a deterministic id sequence (job_1, sch_2, ...). */
function buildPersistence() {
  const config = createMemoryConfigPort()
  let n = 0
  const persistence = createOperatorJobPersistence({ config, clock: () => 1_721_260_800_000, idGen: (p) => `${p}_${++n}` })
  return { config, persistence }
}

const createInput = (over: Partial<JobsCreateInput> = {}): JobsCreateInput => ({
  name: over.name ?? "nightly-reindex",
  description: "",
  schedule: over.schedule ?? { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
  actionType: "native_maintenance",
  overlapPolicy: over.overlapPolicy ?? "forbid",
  misfirePolicy: "skip",
  scope: "project",
  scopeId: "proj_1",
  payloadRef: "secretref_keychain_1",
  principal,
})

async function commit(
  config: ReturnType<typeof createMemoryConfigPort>,
  plan: OperatorMutationPlan,
): Promise<void> {
  const current = await config.get(plan.authority)
  const cas = await config.compareAndSet({
    authority: plan.authority,
    expectedVersion: current?.version ?? null,
    payload: plan.apply(current?.payload ?? null),
    nowMs: 0,
  })
  if (!cas.ok) throw new Error(`commit failed: ${JSON.stringify(cas)}`)
}

function buildComposition(seams: Pick<ExecutorCompositionDeps, "reconcileSource" | "resolveDueContext">) {
  const { emitter } = fakeEmitter()
  const { registry } = fakeRegistry()
  const { coordinator } = fakeCoordinator()
  const deps: ExecutorCompositionDeps = {
    cron: fakeCron(),
    emitter,
    registry,
    coordinator,
    runner: fakeRunner,
    resolveDueContext: seams.resolveDueContext,
    reconcileSource: seams.reconcileSource,
  }
  return buildExecutorComposition(deps)
}

const signal = (jobDefinitionId: string): DueSignal => ({
  jobDefinitionId: jobDefinitionId as DueSignal["jobDefinitionId"],
  scheduleId: "sch_2" as DueSignal["scheduleId"],
  cronExpression: "*/5 * * * *",
  timezone: "UTC",
  firedAtMs: 1_000_000,
})

describe("T011 executor reconcile bridge — rehydrate over the committed jobs persistence", () => {
  test("arm() re-registers a persisted enabled definition (startup rehydration)", async () => {
    const { config, persistence } = buildPersistence()
    await commit(config, await run(persistence.planCreate(createInput())))
    const seams = ExecutorReconcile.createExecutorReconcileSeams(persistence)
    const composition = buildComposition(seams)

    expect(composition.adapter!.isRegistered("job_1", "sch_2")).toBe(false)
    await run(composition.arm())
    expect(composition.adapter!.isRegistered("job_1", "sch_2")).toBe(true)
  })

  test("a persisted disabled definition is not re-registered on the sweep", async () => {
    const { config, persistence } = buildPersistence()
    await commit(config, await run(persistence.planCreate(createInput())))
    // Disable it (version 1 → the memory CAS token) before arming.
    await commit(config, await run(persistence.planDisable({ jobDefinitionId: "job_1", expectedVersion: 0, principal })))
    const composition = buildComposition(ExecutorReconcile.createExecutorReconcileSeams(persistence))
    await run(composition.arm())
    expect(composition.adapter!.isRegistered("job_1", "sch_2")).toBe(false)
  })

  test("resolveDueContext yields a definition-keyed view; a missing definition drops honestly", async () => {
    const { config, persistence } = buildPersistence()
    await commit(config, await run(persistence.planCreate(createInput({ overlapPolicy: "forbid" }))))
    const seams = ExecutorReconcile.createExecutorReconcileSeams(persistence)

    const view = await run(seams.resolveDueContext(signal("job_1")))
    expect(view).not.toBeNull()
    expect(view!.overlapPolicy).toBe("forbid")
    expect(view!.rootSessionId).toBe("job_1") // definition-keyed durable aggregate

    const missing = await run(seams.resolveDueContext(signal("job_absent")))
    expect(missing).toBeNull()
  })
})
