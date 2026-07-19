/**
 * Feature 013 / T005 + T013 — telemetry operator domain stack (backend-live + command-port).
 *
 * Proves the honest, Config-backed posture of the telemetry domain stack over the
 * reused effective telemetry config (FR2, FR7, FR8): `resolve` projects the redacted
 * effective config; `planOn`/`planOff`/`planConfigure` VALIDATE and return an
 * `OperatorMutationPlan` (authority + pure transform) the Feature 007 dispatcher
 * commits via `mutateAuthority` — the backend never self-commits, so a rejected
 * mutation (plaintext secret, unreachable store) never leaves a persisted write; a
 * config-unreachable read/plan degrades to `unavailable`; a plaintext-looking export
 * header is rejected as `invalid_argument` and only a `SecretRef` is persisted; the
 * `test` verb delegates to the probe seam. End-to-end CAS commit + persistence +
 * honest conflict is proved through the full dispatcher in `feature013-wire.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createLiveTelemetryBackend } from "@/operator/telemetry/backend-live"
import { TelemetryStackWiring } from "@/operator/telemetry/stack-wiring"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import type { ProbeTarget, TelemetryDomainError } from "@opencode-ai/protocol/telemetry/commands"
import type { TelemetryProbe } from "@/operator/telemetry/telemetry-port"
import type { HandlerContext, HandlerResult, OperatorMutationPlan } from "@/operator/application/handler"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

const AUTHORITY = "global:telemetry"
const NOW = 1_721_260_800_000
const CORE_OPERATOR: OperatorPrincipalCore = { kind: "operator", subject: "op_1", projectBinding: null }
const PRINCIPAL = { kind: "operator", id: "op_1" } as const

function build(probe?: TelemetryProbe) {
  const config = createMemoryConfigPort()
  const backend = createLiveTelemetryBackend({ config, probe, now: () => NOW })
  return { config, backend }
}

/** A ConfigPort whose reads/writes always throw — exercises the honest `unavailable` degradation. */
const brokenConfig: ConfigPort = {
  get: () => Promise.reject(new Error("config service down")),
  compareAndSet: () => Promise.reject(new Error("config service down")),
  snapshot: () => Promise.reject(new Error("config service down")),
  listSnapshots: () => Promise.reject(new Error("config service down")),
  pruneSnapshots: () => Promise.reject(new Error("config service down")),
  restoreSnapshot: () => Promise.reject(new Error("config service down")),
}

const reachableProbe = (reachable: boolean, reason?: string): TelemetryProbe => ({
  dial: (_target: ProbeTarget) => Effect.succeed({ reachable, reason }),
})

const expectFailure = async <A>(eff: Effect.Effect<A, TelemetryDomainError>, needle: string): Promise<void> => {
  const result = await exit(eff)
  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") expect(JSON.stringify(result.cause.toJSON())).toContain(needle)
}

describe("T005 telemetry backend-live — honest reads over the effective config", () => {
  test("resolve projects the disabled default and the initial CAS token when nothing is persisted", async () => {
    const { backend } = build()
    const summary = await run(backend.resolve())
    expect(summary.enabled).toBe(false)
    expect(summary.configured).toBe(false)
    expect(summary.available).toBe(true)
    expect(summary.transport).toBe("http/protobuf")
    expect(summary.endpoint).toMatch(/^https?:\/\//)
    expect(summary.version).toBe("cas_v0")
  })

  test("resolve degrades to unavailable when the config authority is unreachable", async () => {
    const backend = createLiveTelemetryBackend({ config: brokenConfig, now: () => NOW })
    await expectFailure(backend.resolve(), "unavailable")
  })
})

describe("T005 telemetry backend-live — mutation plans validate without self-committing", () => {
  test("planOn targets the telemetry authority and its pure apply enables the export", async () => {
    const { config, backend } = build()
    const plan = await run(backend.planOn({ expectedVersion: "cas_v0", principal: PRINCIPAL }))
    expect(plan.authority).toBe(AUTHORITY)
    // The plan is pure — validating it persists nothing (the dispatcher owns the CAS write).
    expect(await config.get(AUTHORITY)).toBeNull()
    const next = plan.apply(null) as { enabled: boolean }
    expect(next.enabled).toBe(true)
  })

  test("planOff apply disables the export", async () => {
    const { backend } = build()
    const plan = await run(backend.planOff({ expectedVersion: "cas_v0", principal: PRINCIPAL }))
    const next = plan.apply(null) as { enabled: boolean }
    expect(next.enabled).toBe(false)
  })

  test("planConfigure apply writes the export target and stores the header as a SecretRef", async () => {
    const { backend } = build()
    const plan = await run(
      backend.planConfigure({
        transport: "grpc",
        endpoint: "https://collector.internal:4317",
        headerSecret: "keychain:otlp-token",
        expectedVersion: "cas_v0",
        principal: PRINCIPAL,
      }),
    )
    const next = plan.apply(null) as { export: { transport: string; endpoint: string; headers: Record<string, string> } }
    expect(next.export.transport).toBe("grpc")
    expect(next.export.endpoint).toBe("https://collector.internal:4317")
    expect(next.export.headers.authorization).toBe("keychain:otlp-token")
  })

  test("planConfigure rejects a plaintext-looking header secret as invalid_argument (no plan produced)", async () => {
    const { config, backend } = build()
    await expectFailure(
      backend.planConfigure({
        transport: "http/protobuf",
        endpoint: "http://collector.internal:4318",
        headerSecret: "super secret plaintext token",
        expectedVersion: "cas_v0",
        principal: PRINCIPAL,
      }),
      "invalid_argument",
    )
    expect(await config.get(AUTHORITY)).toBeNull()
  })

  test("planOn degrades to unavailable when the config authority is unreachable", async () => {
    const backend = createLiveTelemetryBackend({ config: brokenConfig, now: () => NOW })
    await expectFailure(backend.planOn({ expectedVersion: "cas_v0", principal: PRINCIPAL }), "unavailable")
  })
})

describe("T005 telemetry backend-live — test delegates to the probe seam", () => {
  test("test returns reachable when the injected probe dials successfully", async () => {
    const { backend } = build(reachableProbe(true))
    const result = await run(backend.test())
    expect(result.outcome).toBe("reachable")
    expect(result.target.endpoint).toMatch(/^https?:\/\//)
  })

  test("test returns unreachable when the injected probe reports a refused dial", async () => {
    const { backend } = build(reachableProbe(false, "connection refused"))
    const result = await run(backend.test())
    expect(result.outcome).toBe("unreachable")
  })

  test("test degrades to unavailable when no probe is wired", async () => {
    const { backend } = build()
    await expectFailure(backend.test(), "unavailable")
  })
})

// =============================================================================
// Command-port round-trips through the Feature 007 DomainInvoke seam
// =============================================================================

function ctx(id: string, payload: Record<string, unknown> = {}, version?: string): HandlerContext {
  return {
    request: {
      principal: CORE_OPERATOR,
      payload,
      scope: { kind: "global", ref: null },
      version,
    } as unknown as HandlerContext["request"],
    descriptor: { id, domain: "telemetry" } as unknown as HandlerContext["descriptor"],
  }
}

const effective = (r: HandlerResult): unknown => (r.kind === "query" ? r.effective : undefined)

function wire(probe?: TelemetryProbe) {
  const { config, backend } = build(probe)
  const wiring = TelemetryStackWiring.createTelemetryDomainWiring({ backend })
  return { config, invoke: wiring.ports.telemetry.invoke }
}

describe("T005 telemetry command port — reserved verbs dispatch to the live backend", () => {
  test("telemetry.status projects the redacted summary", async () => {
    const { invoke } = wire()
    const result = await invoke(ctx("telemetry.status"))
    expect(result.kind).toBe("query")
    expect((effective(result) as { enabled: boolean }).enabled).toBe(false)
  })

  test("telemetry.on returns a mutation_plan the dispatcher commits (never a self-committed query)", async () => {
    const { config, invoke } = wire()
    const result = await invoke(ctx("telemetry.on", {}, "cas_v0"))
    expect(result.kind).toBe("mutation_plan")
    const plan = result as unknown as OperatorMutationPlan
    expect(plan.authority).toBe(AUTHORITY)
    // The command port never self-commits — nothing is persisted at plan time.
    expect(await config.get(AUTHORITY)).toBeNull()
    expect((plan.apply(null) as { enabled: boolean }).enabled).toBe(true)
  })

  test("telemetry.configure without a transport is a local invalid_argument (no backend call)", async () => {
    const { config, invoke } = wire()
    const result = await invoke(ctx("telemetry.configure", { endpoint: "http://c:4318" }))
    expect(result.kind).toBe("failure")
    expect(await config.get(AUTHORITY)).toBeNull()
  })

  test("telemetry.test dispatches to the probe seam", async () => {
    const { invoke } = wire(reachableProbe(true))
    const result = await invoke(ctx("telemetry.test"))
    expect(result.kind).toBe("query")
    expect((effective(result) as { outcome: string }).outcome).toBe("reachable")
  })
})
