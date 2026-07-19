/**
 * Feature 013 residual — regression: an InstanceRef-less operator runtime (the exact
 * CLI `op` reproduction) must NEVER crash a mutation. The live operator stack runs its
 * Config.Service calls on an AppRuntime fiber; when that fiber carries no `InstanceRef`,
 * `Config.get`/`update` (InstanceState-backed, project-scoped authorities and the
 * idempotency/rollback meta store) `Effect.die("InstanceRef not provided")`, which a
 * Promise-boundary caller surfaces as a rejected promise. Before the fix that rejection
 * escaped the dispatcher and crashed the CLI (exit 1, "Unexpected error / InstanceRef
 * not provided"), violating FR8 (honest degradation).
 *
 * The primary fix binds `InstanceRef` onto the operator config seam (stack-live.ts); this
 * test pins the defense-in-depth invariant regardless: the dispatcher's mutation commit
 * path converts ANY unexpected throw from `mutateAuthority` into a typed `unavailable`
 * envelope, so no config-seam defect can ever crash the process. It covers all four
 * Feature 013 domains (telemetry/smart/budget/pools) — a mutation returns a typed
 * failure envelope, never a rejected promise.
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
} from "@/operator/adapters"
import { createDurableOperatorStore, type ConfigServiceLike } from "@/operator/adapters/outbound/config-service"
import { domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import { TelemetryStackWiring } from "@/operator/telemetry/stack-wiring"
import { TelemetryBackendLive } from "@/operator/telemetry/backend-live"
import { TelemetryProbeLive } from "@/operator/telemetry/probe-live"
import { SmartStackWiring } from "@/operator/smart/stack-wiring"
import { SmartBackendLive } from "@/operator/smart/backend-live"
import { BudgetStackWiring } from "@/operator/budget/stack-wiring"
import { BudgetBackendLive } from "@/operator/budget/backend-live"
import { PoolsStackWiring } from "@/operator/pools/stack-wiring"
import { PoolsBackendLive } from "@/operator/pools/backend-live"

const DIE = "InstanceRef not provided"

/**
 * A Config.Service double that dies exactly like the live InstanceRef-less runtime:
 * the project-scoped `update` (InstanceState.directory-backed — the idempotency claim's
 * meta-store write, and any project authority write) rejects with the reproduced defect.
 * Reads stay honest so each domain plan validates and reaches the commit path, where the
 * die used to escape and crash the CLI — this pins that the dispatcher converts it into a
 * typed envelope instead.
 */
function createInstanceRefLessConfigService(): ConfigServiceLike {
  const fake = createFakeConfigService()
  return {
    ...fake,
    update: () => Promise.reject(new Error(DIE)),
  }
}

function harness() {
  const registry = createSeededOperatorCommandRegistry()
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createInstanceRefLessConfigService(), lock })
  const mp: MutationPorts = {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
  const domainPorts: DomainPorts = wireDomainPorts({
    ...TelemetryStackWiring.createTelemetryDomainWiring({
      backend: TelemetryBackendLive.createLiveTelemetryBackend({
        config: mp.config,
        probe: TelemetryProbeLive.createLiveTelemetryProbe(),
      }),
    }).ports,
    ...SmartStackWiring.createSmartDomainWiring({ backend: SmartBackendLive.createLiveSmartBackend({ config: mp.config }) }).ports,
    ...BudgetStackWiring.createBudgetDomainWiring({ backend: BudgetBackendLive.createLiveBudgetBackend({ config: mp.config }) }).ports,
    ...PoolsStackWiring.createPoolsDomainWiring({ backend: PoolsBackendLive.createLivePoolsBackend({ config: mp.config }) }).ports,
  })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher }
}

const mutate = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_ir" },
      scope: { kind: "project", ref: "proj_ir" },
      source: "cli",
      payload,
      version: undefined,
      idempotencyKey: `idem_${id}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

describe("Feature 013 residual — InstanceRef-less mutations degrade, never crash", () => {
  const cases: ReadonlyArray<{ id: string; payload: Record<string, unknown> }> = [
    { id: "telemetry.on", payload: {} },
    { id: "smart.on", payload: {} },
    { id: "budget.set", payload: { limits: { max_turns: 8 } } },
    { id: "pools.set", payload: { bindings: [{ role: "reasoning", models: ["anthropic/claude-opus-4-8"] }] } },
  ]

  for (const { id, payload } of cases) {
    test(`${id} returns a typed envelope (never a rejected promise) when Config dies with "${DIE}"`, async () => {
      // Must resolve — a rejected promise here is the crash the fix prevents.
      const result = await mutate(harness().dispatcher, id, payload)
      expect(result.ok).toBe(false)
      // A typed operator failure envelope, not a raw defect.
      expect(typeof result.error?.code).toBe("string")
      expect(result.outcome).not.toBe("success")
    })
  }
})
