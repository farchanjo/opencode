/**
 * Feature 013 / T008 + T016 — unit coverage for the live pools operator domain stack
 * (FR5, FR7, FR8). Drives the real `createLivePoolsBackend` (and the `pools` command
 * adapter) over the Feature 007 in-memory Config.Service double: resolve projects the
 * effective `role_pools`; `planSet`/`planReset` VALIDATE and return an
 * `OperatorMutationPlan` (routing authority + pure transform) the dispatcher commits —
 * the backend never self-commits; validate mutates nothing; a malformed binding, a
 * non-mutating principal, and a config-store outage all degrade to typed envelopes —
 * never a fabricated success. End-to-end CAS commit is proved through the full
 * dispatcher in `feature013-wire.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import { createLivePoolsBackend } from "@/operator/pools/backend-live"
import { PoolsCommandPort } from "@/operator/pools/pools-command-port"
import type { PoolsAuditEvent } from "@/operator/pools/pools-port"
import type { OperatorPrincipal } from "@opencode-ai/protocol/pools/commands"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

const OPERATOR: OperatorPrincipal = { kind: "operator", id: "operator:root" }
const CLOCK = () => 1_721_260_800_000

function backendOf(config: ConfigPort = createMemoryConfigPort()) {
  return createLivePoolsBackend({ config, clock: CLOCK })
}

const rolePoolsOf = (payload: unknown) => (payload as RoutingConfig.Info).models.role_pools

describe("T008 — resolve projects the effective role_pools (FR5, FR8)", () => {
  test("an unconfigured domain resolves the empty, available, valid projection", async () => {
    const out = await run(backendOf().resolve())
    expect(out.configured).toBe(false)
    expect(out.available).toBe(true)
    expect(out.valid).toBe(true)
    expect(out.bindings).toEqual([])
    expect(out.version).toBe(INITIAL_CONFIG_VERSION)
  })

  test("a config-store outage degrades resolve to unavailable, never a fabricated read", async () => {
    const failing: ConfigPort = { ...createMemoryConfigPort(), get: () => Promise.reject(new Error("store offline")) }
    const failure = await exit(backendOf(failing).resolve())
    expect(failure._tag).toBe("Failure")
    if (failure._tag === "Failure") expect(JSON.stringify(failure.cause.toJSON())).toContain("unavailable")
  })
})

describe("T008 — set/reset are validated mutation plans over the routing authority (FR5, FR7)", () => {
  test("planSet targets the routing authority and its apply installs the bindings (nothing persisted)", async () => {
    const config = createMemoryConfigPort()
    const plan = await run(
      backendOf(config).planSet({ bindings: [{ role: "worker", models: ["gpt-5"] }], expectedVersion: INITIAL_CONFIG_VERSION, principal: OPERATOR }),
    )
    expect(plan.authority).toBe("routing")
    expect(await config.get("routing")).toBeNull()
    expect(rolePoolsOf(plan.apply(null)).worker).toEqual(["gpt-5"])
  })

  test("planReset apply clears the role_pools map", async () => {
    const plan = await run(backendOf().planReset({ expectedVersion: INITIAL_CONFIG_VERSION, principal: OPERATOR }))
    expect(Object.keys(rolePoolsOf(plan.apply(null)))).toEqual([])
  })

  test("a malformed binding is rejected as invalid_argument before any plan or write", async () => {
    const config = createMemoryConfigPort()
    const failure = await exit(
      backendOf(config).planSet({ bindings: [{ role: "worker", models: [] }], expectedVersion: INITIAL_CONFIG_VERSION, principal: OPERATOR }),
    )
    expect(failure._tag).toBe("Failure")
    if (failure._tag === "Failure") expect(JSON.stringify(failure.cause.toJSON())).toContain("invalid_argument")
    expect(await config.get("routing")).toBeNull()
  })

  test("a non-mutating principal may never mutate the role pools (Security)", async () => {
    const failure = await exit(
      backendOf().planSet({ bindings: [{ role: "worker", models: ["gpt-5"] }], expectedVersion: INITIAL_CONFIG_VERSION, principal: { kind: "manager-view", id: "mgr:1" } }),
    )
    expect(failure._tag).toBe("Failure")
    if (failure._tag === "Failure") expect(JSON.stringify(failure.cause.toJSON())).toContain("unauthorized")
  })
})

describe("T008 — validate reports validity without mutating (FR5, FR8)", () => {
  test("validate returns the current validity and writes nothing", async () => {
    const config = createMemoryConfigPort()
    const out = await run(backendOf(config).validate())
    expect(out.valid).toBe(true)
    expect(out.configured).toBe(false)
    expect(await config.get("routing")).toBeNull()
  })
})

describe("T008 — command adapter dispatches to the real backend and audits (FR9)", () => {
  const descriptor = (id: string) => ({ id, domain: "pools" }) as never
  const request = (id: string, payload?: unknown) =>
    ({
      id,
      principal: { kind: "operator", subject: "operator:root", projectBinding: null },
      scope: { kind: "global", ref: null },
      source: "cli",
      payload,
    }) as never

  function dispatcher(config: ConfigPort = createMemoryConfigPort()) {
    const events: PoolsAuditEvent[] = []
    const ports = PoolsCommandPort.createPoolsDomainPorts({
      backend: backendOf(config),
      audit: { record: (event) => Effect.sync(() => void events.push(event)) },
    })
    return { invoke: ports.pools.invoke, events }
  }

  test("pools.status projects the bindings and records one ok audit event", async () => {
    const d = dispatcher()
    const result = await d.invoke({ request: request("pools.status"), descriptor: descriptor("pools.status") })
    expect(result.kind).toBe("query")
    expect(d.events).toEqual([{ commandId: "pools.status", principalId: "operator:root", target: "global", outcome: "ok" }])
  })

  test("pools.set with no bindings is rejected as invalid_argument", async () => {
    const d = dispatcher()
    const result = await d.invoke({ request: request("pools.set", {}), descriptor: descriptor("pools.set") })
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("invalid_argument")
  })

  test("pools.set returns a scoped routing-authority mutation_plan (no phantom success audit)", async () => {
    const d = dispatcher()
    // The request helper carries scope.kind "global", so pools.set now commits to the
    // GLOBAL routing document (Feature 033) instead of the old hardwired project authority.
    const result = await d.invoke({
      request: request("pools.set", { bindings: [{ role: "worker", models: ["gpt-5"] }], expectedVersion: INITIAL_CONFIG_VERSION }),
      descriptor: descriptor("pools.set"),
    })
    expect(result.kind).toBe("mutation_plan")
    if (result.kind === "mutation_plan") expect(result.authority).toBe("global:routing")
    expect(d.events).toEqual([])
  })
})
