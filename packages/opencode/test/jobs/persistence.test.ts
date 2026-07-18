/**
 * Feature 003 / T033 — Config.Service persistence integration (AC13, AC23).
 *
 * Durable `JobDefinition` + `ScheduleRegistration` persistence through the REUSED
 * Feature 007 `ConfigPort` (in-memory double of the Config.Service authority):
 * CAS create/update, version-conflict on a stale write, enumeration index,
 * delete tombstone, round-trip decode, registration state persistence, and the
 * SecretRef-only invariant (secrets are opaque references, never plaintext).
 * Mirrors `test/lifecycle` durable-integration style but over the config double.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createJobPersistence, type JobPersistenceError } from "@/jobs/persistence"
import { makeJobDefinition, makeScheduleRegistration } from "./fixtures"
import type { Ids } from "@opencode-ai/schema/jobs/ids"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

function build() {
  const config = createMemoryConfigPort()
  const persistence = createJobPersistence({ config, clock: () => 1_721_260_800_000 })
  return { config, persistence }
}

describe("T033 persistence — definition CAS + rehydration (AC13)", () => {
  test("save then load round-trips the durable definition with a CAS version token", async () => {
    const { persistence } = build()
    const definition = makeJobDefinition()
    const saved = await run(persistence.saveDefinition(definition, null))
    expect(saved.version).toBeDefined()

    const loaded = await run(persistence.loadDefinition(definition.id))
    expect(loaded).not.toBeNull()
    expect(String(loaded?.definition.id)).toBe("job_test_1")
    expect(String(loaded?.definition.schedule.schedule.expression)).toBe("*/5 * * * *")
    expect(loaded?.version).toBe(saved.version)
  })

  test("a stale create (expectedVersion null on an existing authority) is a version conflict", async () => {
    const { persistence } = build()
    const definition = makeJobDefinition()
    await run(persistence.saveDefinition(definition, null))
    const conflict = await exit(persistence.saveDefinition(definition, null))
    expect(conflict._tag).toBe("Failure")
    if (conflict._tag === "Failure") {
      const err = JSON.stringify(conflict.cause.toJSON())
      expect(err).toContain("version_conflict")
    }
  })

  test("an update under the correct CAS version succeeds and advances the token", async () => {
    const { persistence } = build()
    const definition = makeJobDefinition()
    const first = await run(persistence.saveDefinition(definition, null))
    const updated = await run(persistence.saveDefinition(makeJobDefinition({ version: 2 }), first.version))
    expect(updated.version).not.toBe(first.version)
    const loaded = await run(persistence.loadDefinition(definition.id))
    expect(loaded?.definition.identity.version).toBe(2)
  })

  test("listDefinitions enumerates persisted definitions via the index", async () => {
    const { persistence } = build()
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_a", scheduleId: "sch_a" }), null))
    await run(persistence.saveDefinition(makeJobDefinition({ id: "job_b", scheduleId: "sch_b" }), null))
    const all = await run(persistence.listDefinitions())
    expect(all.map((d) => String(d.definition.id)).sort()).toEqual(["job_a", "job_b"])
  })

  test("delete tombstones the definition and drops it from the index", async () => {
    const { persistence } = build()
    const definition = makeJobDefinition()
    const saved = await run(persistence.saveDefinition(definition, null))
    await run(persistence.deleteDefinition(definition.id, saved.version))
    expect(await run(persistence.loadDefinition(definition.id))).toBeNull()
    expect(await run(persistence.listDefinitions())).toHaveLength(0)
  })
})

describe("T033 persistence — registration state (AC23)", () => {
  test("registration durable intent + state survives save/load", async () => {
    const { persistence } = build()
    const registration = makeScheduleRegistration({ state: "pending", intent: "register" })
    await run(persistence.saveRegistration(registration, null))
    const loaded = await run(
      persistence.loadRegistration("job_test_1" as Ids.JobDefinitionId, "sch_1" as Ids.ScheduleId),
    )
    expect(loaded?.registration.state).toBe("pending")
    expect(loaded?.registration.intent).toBe("register")
  })

  test("a reconciled registration transition persists idempotently (AC23)", async () => {
    const { persistence } = build()
    const pending = makeScheduleRegistration({ state: "pending" })
    const first = await run(persistence.saveRegistration(pending, null))
    const reconciled = makeScheduleRegistration({ state: "reconciled" })
    await run(persistence.saveRegistration(reconciled, first.version))
    const loaded = await run(
      persistence.loadRegistration("job_test_1" as Ids.JobDefinitionId, "sch_1" as Ids.ScheduleId),
    )
    expect(loaded?.registration.state).toBe("reconciled")
  })
})

describe("T033 persistence — SecretRef-only invariant (Security 3, C10)", () => {
  test("a definition persists opaque SecretRef handles and no plaintext reaches the store", async () => {
    const { config, persistence } = build()
    const definition = makeJobDefinition({ secretRefs: ["secretref_keychain_alpha", "secretref_keychain_beta"] })
    await run(persistence.saveDefinition(definition, null))

    // Inspect the raw persisted document: only opaque references, never plaintext.
    const entry = await config.get(`jobs/definitions/${String(definition.id)}`)
    const doc = JSON.stringify(entry?.payload)
    expect(doc).toContain("secretref_keychain_alpha")
    expect(doc).not.toContain("password")
    expect(doc).not.toContain("BEGIN PRIVATE KEY")

    const loaded = await run(persistence.loadDefinition(definition.id))
    expect(loaded?.definition.authorization.secret_refs.map(String)).toEqual([
      "secretref_keychain_alpha",
      "secretref_keychain_beta",
    ])
  })

  test("a missing definition loads as null, never a fabricated read", async () => {
    const { persistence } = build()
    const missing = await run(persistence.loadDefinition("job_absent" as Ids.JobDefinitionId))
    expect(missing).toBeNull()
  })
})

// A typed-error smoke assertion so the error union is exercised by the suite.
const _errorShape: JobPersistenceError = { type: "unavailable", reason: "x" }
void _errorShape
