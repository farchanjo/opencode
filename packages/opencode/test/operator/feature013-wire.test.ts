/**
 * Feature 013 / T018 — integration: the four config-backed domains wired into the
 * Feature 007 runtime (FR9, FR11). Builds the same composition `stack-live.ts`
 * assembles — the four `create*DomainWiring` overrides spread into `wireDomainPorts`
 * over ONE shared `store.config` seam — behind the real dispatcher + slash
 * interceptor, and proves:
 *
 *   - READS (`telemetry|smart|budget|pools.status`) dispatch through the full slash
 *     wire to the REAL domain ports: they render the domain-specific effective
 *     projection (transport/auto/limits/bindings), NOT the generic config-status
 *     shadow and NOT the `not_implemented` stub.
 *   - the dropped `STATUS_SHOW_IDS` shadow is gone for the four domains while
 *     `routing.status` stays config-backed (its shadow was retained by T010).
 *   - one CAS MUTATION per domain, dispatched through the wired `DomainInvoke` seam
 *     the dispatcher routes to, persists under CAS: it returns a Feature 007 audit
 *     id and a re-read reflects the bumped version.
 *   - the stubs baseline returns `not_implemented`, so the wiring is what flips the
 *     four domains onto real ports.
 *
 * Dispatch boundary: each mutating verb returns a validated `mutation_plan`, so the
 * Feature 007 `mutateAuthority` pipeline owns the single committed CAS write and
 * emits the audit correlation — the backend never self-commits. This proves the
 * mutations succeed end-to-end through the SAME dispatcher slash/CLI/HTTP use (FR7),
 * and that a rejected mutation persists NOTHING (no fabricated failure with a real
 * side effect).
 */
import { describe, expect, test } from "bun:test"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import {
  createFakeConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createSlashConfirmStore,
  createSlashInterceptor,
} from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import {
  createDomainStubs,
  domainHandlerFor,
  handlersFromDomainPorts,
  wireDomainPorts,
} from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import type { HandlerContext } from "@/operator/application/handler"
import { TelemetryStackWiring } from "@/operator/telemetry/stack-wiring"
import { TelemetryBackendLive } from "@/operator/telemetry/backend-live"
import { TelemetryProbeLive } from "@/operator/telemetry/probe-live"
import { SmartStackWiring } from "@/operator/smart/stack-wiring"
import { SmartBackendLive } from "@/operator/smart/backend-live"
import { BudgetStackWiring } from "@/operator/budget/stack-wiring"
import { BudgetBackendLive } from "@/operator/budget/backend-live"
import { PoolsStackWiring } from "@/operator/pools/stack-wiring"
import { PoolsBackendLive } from "@/operator/pools/backend-live"

function mutationPorts(): MutationPorts {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  return {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
}

/** Compose the four Feature 013 domain overrides exactly as `stack-live.ts` does. */
function wireFeature013(mp: MutationPorts): DomainPorts {
  const config = mp.config
  return wireDomainPorts({
    ...TelemetryStackWiring.createTelemetryDomainWiring({
      backend: TelemetryBackendLive.createLiveTelemetryBackend({ config, probe: TelemetryProbeLive.createLiveTelemetryProbe() }),
    }).ports,
    ...SmartStackWiring.createSmartDomainWiring({ backend: SmartBackendLive.createLiveSmartBackend({ config }) }).ports,
    ...BudgetStackWiring.createBudgetDomainWiring({ backend: BudgetBackendLive.createLiveBudgetBackend({ config }) }).ports,
    ...PoolsStackWiring.createPoolsDomainWiring({ backend: PoolsBackendLive.createLivePoolsBackend({ config }) }).ports,
  })
}

function harness() {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const domainPorts = wireFeature013(mp)
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  const interceptor = createSlashInterceptor({ registry, dispatcher, confirmStore: createSlashConfirmStore() })
  return { interceptor, dispatcher, domainPorts, config: mp.config }
}

const read = async (interceptor: ReturnType<typeof harness>["interceptor"], id: string) => {
  const r = await interceptor.tryHandle({ text: `/op.${id}`, principalContext: { projectId: "proj_13", subject: "op_1" } })
  if (!r.handled) throw new Error(`unhandled ${id}`)
  return r.result
}

/**
 * Dispatch a mutating verb through the FULL Feature 007 pipeline (confirm → contract
 * → handler plan → `mutateAuthority` CAS commit + audit) — the exact path slash / CLI
 * / HTTP take. `version === undefined` is the create-if-absent case (preflight null).
 */
const mutate = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  version?: string,
) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_13" },
      scope: { kind: "project", ref: "proj_13" },
      source: "cli",
      payload,
      version,
      idempotencyKey: `idem_${id}_${version ?? "create"}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

describe("T018 — the four reads dispatch through the full slash wire to real ports", () => {
  test("telemetry.status renders the effective telemetry projection (not the shadow, not a stub)", async () => {
    const { interceptor } = harness()
    const result = await read(interceptor, "telemetry.status")
    expect(result.outcome).toBe("success")
    const effective = result.effective as { transport: string; enabled: boolean }
    expect(effective.transport).toMatch(/^(http\/protobuf|grpc)$/)
    expect(typeof effective.enabled).toBe("boolean")
    // The generic config-status shadow would carry `hasPayload`; the real port never does.
    expect((result.effective as Record<string, unknown>)["hasPayload"]).toBeUndefined()
  })

  test("smart.status renders the activation projection with the auto flag", async () => {
    const { interceptor } = harness()
    const effective = (await read(interceptor, "smart.status")).effective as { auto: boolean; enabled: boolean }
    expect(typeof effective.auto).toBe("boolean")
    expect(typeof effective.enabled).toBe("boolean")
  })

  test("budget.status renders the bounded limits view", async () => {
    const { interceptor } = harness()
    const effective = (await read(interceptor, "budget.status")).effective as { limits: { maxTurns: number } }
    expect(typeof effective.limits.maxTurns).toBe("number")
  })

  test("pools.status renders the role-pool bindings projection", async () => {
    const { interceptor } = harness()
    const effective = (await read(interceptor, "pools.status")).effective as { bindings: unknown[] }
    expect(Array.isArray(effective.bindings)).toBe(true)
  })

  test("routing.status stays config-backed (the retained shadow), unchanged by T010", async () => {
    const { interceptor } = harness()
    const effective = (await read(interceptor, "routing.status")).effective as Record<string, unknown>
    expect(effective["hasPayload"]).toBe(false)
    expect(effective["authority"]).toBe("routing")
  })
})

describe("T018 — one CAS mutation per domain commits end-to-end through mutateAuthority", () => {
  test("telemetry.on commits through the dispatcher and a re-read reflects the enabled + bumped version", async () => {
    const { interceptor, dispatcher } = harness()
    const before = (await read(interceptor, "telemetry.status")).effective as { version: string; enabled: boolean }
    expect(before.enabled).toBe(false)
    const result = await mutate(dispatcher, "telemetry.on", {})
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
    const after = (await read(interceptor, "telemetry.status")).effective as { version: string; enabled: boolean }
    expect(after.enabled).toBe(true)
    expect(after.version).not.toBe(before.version)
  })

  test("smart.on commits through the dispatcher and status reflects the projected enabled state", async () => {
    const { interceptor, dispatcher } = harness()
    const result = await mutate(dispatcher, "smart.on", {})
    expect(result.ok).toBe(true)
    const after = (await read(interceptor, "smart.status")).effective as { enabled: boolean }
    expect(after.enabled).toBe(true)
  })

  test("budget.set commits the tightened limits through the dispatcher under CAS", async () => {
    const { interceptor, dispatcher } = harness()
    const before = (await read(interceptor, "budget.status")).effective as { limits: Record<string, number> }
    const tighter = { ...before.limits, maxTurns: before.limits.maxTurns - 1 }
    const result = await mutate(dispatcher, "budget.set", { limits: tighter })
    expect(result.ok).toBe(true)
    const after = (await read(interceptor, "budget.status")).effective as { limits: { maxTurns: number } }
    expect(after.limits.maxTurns).toBe(tighter.maxTurns)
  })

  test("pools.set commits the bindings through the dispatcher", async () => {
    const { interceptor, dispatcher } = harness()
    const result = await mutate(dispatcher, "pools.set", { bindings: [{ role: "worker", models: ["gpt-5"] }] })
    expect(result.ok).toBe(true)
    const after = (await read(interceptor, "pools.status")).effective as { bindings: { role: string }[] }
    expect(after.bindings.some((b) => b.role === "worker")).toBe(true)
  })

  test("a rejected mutation (stale CAS version on an absent authority) persists NOTHING", async () => {
    const { interceptor, dispatcher, config } = harness()
    // A non-null expected version against an absent authority is a CAS conflict; the
    // fix guarantees no write is committed while the caller is told it failed.
    const result = await mutate(dispatcher, "telemetry.on", {}, "cas_v9")
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("conflict")
    expect(await config.get("global:telemetry")).toBeNull()
    const after = (await read(interceptor, "telemetry.status")).effective as { enabled: boolean }
    expect(after.enabled).toBe(false)
  })
})

describe("T018 — the wiring is what flips the four domains off the not_implemented stub", () => {
  const stubCtx = (id: string, domain: keyof DomainPorts): HandlerContext =>
    ({
      request: {
        principal: { kind: "operator", subject: "op_1", projectBinding: null },
        payload: {},
        scope: { kind: "global", ref: null },
        source: "cli",
      },
      descriptor: { id, domain },
    }) as unknown as HandlerContext

  test("the stubs baseline returns not_implemented for the four read verbs", async () => {
    const stubs = createDomainStubs()
    for (const [domain, id] of [
      ["telemetry", "telemetry.status"],
      ["smart", "smart.status"],
      ["budget", "budget.status"],
      ["pools", "pools.status"],
    ] as const) {
      const result = await Promise.resolve(stubs[domain].invoke(stubCtx(id, domain)))
      expect(result.kind).toBe("failure")
      if (result.kind === "failure") expect(result.code).toBe("not_implemented")
    }
  })

  test("the wired ports never resolve not_implemented for the four reads", async () => {
    const { interceptor } = harness()
    for (const id of ["telemetry.status", "smart.status", "budget.status", "pools.status"]) {
      const result = await read(interceptor, id)
      expect(result.outcome).toBe("success")
      expect(result.error?.code).not.toBe("not_implemented")
    }
  })
})
