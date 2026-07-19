/**
 * Feature 013 / T006 — live `SmartBackend` composition over the routing config.
 *
 * Proves the smart domain is an honest PROJECTION of `RoutingConfig.Activation`
 * over the reused Config.Service authority (in-memory `ConfigPort` double): the
 * read surface (`resolve`) projects the effective activation state; `planOn`/
 * `planOff`/`planAuto` VALIDATE and return an `OperatorMutationPlan` (scoped routing
 * authority + a pure transform that flips only `activation.enabled`/`mode` while
 * preserving models/enforcement) the dispatcher commits — the backend never
 * self-commits; every degradation is a typed `SmartError` (`unavailable`) — never
 * fabricated data (FR3, FR7, FR8). End-to-end CAS commit + conflict is proved
 * through the full dispatcher in `feature013-wire.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import { createLiveSmartBackend } from "@/operator/smart/backend-live"
import type { SmartError, SmartMutationInput } from "@opencode-ai/protocol/smart/commands"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

const principal = { kind: "operator", id: "op_1" } as const
const input = (expectedVersion: string): SmartMutationInput => ({ expectedVersion, principal })

function build(config: ConfigPort = createMemoryConfigPort()) {
  return { config, backend: createLiveSmartBackend({ config, now: () => 1_721_260_800_000 }) }
}

const activationOf = (payload: unknown) => (payload as RoutingConfig.Info).activation

async function causeText<A>(eff: Effect.Effect<A, SmartError>): Promise<string> {
  const result = await exit(eff)
  expect(result._tag).toBe("Failure")
  return result._tag === "Failure" ? JSON.stringify(result.cause.toJSON()) : ""
}

describe("T006 backend-live — honest projection over RoutingConfig.Activation", () => {
  test("resolve on an unconfigured store projects the safe disabled default", async () => {
    const { backend } = build()
    const summary = await run(backend.resolve())
    expect(summary.enabled).toBe(false)
    expect(summary.auto).toBe(false)
    expect(summary.configured).toBe(false)
    expect(summary.available).toBe(true)
    expect(summary.version).toBe(INITIAL_CONFIG_VERSION)
  })

  test("planOn targets the global routing authority and its apply flips enabled=true (nothing persisted)", async () => {
    const { config, backend } = build()
    const plan = await run(backend.planOn(input(INITIAL_CONFIG_VERSION)))
    expect(plan.authority).toBe("global:routing")
    expect(await config.get("global:routing")).toBeNull()
    expect(activationOf(plan.apply(null)).enabled).toBe(true)
  })

  test("planOff apply flips enabled=false", async () => {
    const { backend } = build()
    const plan = await run(backend.planOff(input(INITIAL_CONFIG_VERSION)))
    expect(activationOf(plan.apply(null)).enabled).toBe(false)
  })

  test("planAuto apply sets mode=auto without discarding the models/enforcement", async () => {
    const { backend } = build()
    const plan = await run(backend.planAuto(input(INITIAL_CONFIG_VERSION)))
    const next = plan.apply(null) as RoutingConfig.Info
    expect(next.activation.mode).toBe("auto")
    expect(next.models).toBeDefined()
    expect(next.enforcement).toBeDefined()
  })
})

describe("T006 backend-live — Config.Service outage degrades to a typed capability gap", () => {
  test("an unreachable store resolves to unavailable, never fabricated data", async () => {
    const broken: ConfigPort = { ...createMemoryConfigPort(), get: () => Promise.reject(new Error("config down")) }
    const { backend } = build(broken)
    expect(await causeText(backend.resolve())).toContain("unavailable")
    expect(await causeText(backend.planOn(input(INITIAL_CONFIG_VERSION)))).toContain("unavailable")
  })
})
