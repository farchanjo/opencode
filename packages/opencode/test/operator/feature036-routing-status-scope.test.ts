/**
 * Feature 036 — the operator `routing.status` READ honors the request scope.
 *
 * `routing.status` is served config-backed (the retained shadow, Feature 013 T010), but the
 * generic `createConfigStatusHandler` keyed a SCOPE-BLIND authority — `authorityKeyForCommandId`
 * always resolved the project `routing` document. So with ONLY a `global:routing` document set,
 * `routing.status --scope global` reported `configured:false` even though `smart.status --scope
 * global` correctly reported `configured:true` (its real domain port reads the effective config,
 * which resolves the global document). This suite drives the SAME REAL wired dispatcher the TUI
 * uses (smart + budget + pools + routing over ONE shared `store.config`, production authority
 * resolver threaded) with a bound `projectId` in ctx, and proves the scope-aware
 * `createRoutingStatusHandler` (Feature 036) closes the gap:
 *   - (a) with only `global:routing` present, `routing.status --scope global` reports
 *     `configured:true` and the global activation (`enabled` + `mode`);
 *   - (b) `routing.status --scope global` and `smart.status --scope global` AGREE on the
 *     activation (enabled + mode/auto) for the same global document;
 *   - (c) `routing.status --scope project` now SHADOWS the global config (Feature 040 supersedes
 *     the Feature 036 project/bare `configured:false` residual): with only `global:routing` set it
 *     reports the shadowed activation and AGREES with `smart.status --scope project`; with no
 *     routing document anywhere it is honestly `configured:false` / `activation:null`;
 *   - (d) a bare `routing.status` (no explicit scope, project bound) shadows the global config too.
 *
 * NOTE (Feature 040): Option A re-points the project/bare `routing.status` read at the layered
 * effective config (`resolveEffective`: project > global > default) — the SAME read `smart.status`
 * consumes — so a global-only activation surfaces at the default scope. This DELIBERATELY supersedes
 * the Feature 036 accepted residual that the project/bare read reported `configured:false` under a
 * global-only config (recorded in ADR-0040 and the ADR-0036 residual note). The (c)/(d) expectations
 * below are UPDATED to the shadowed behavior, not weakened.
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
  createSlashConfirmStore,
  createSlashInterceptor,
  createTuiOperatorSlashPort,
} from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import { createOperatorAuthorityResolver } from "@/operator/application/command-authority"
import { SmartStackWiring } from "@/operator/smart/stack-wiring"
import { SmartBackendLive } from "@/operator/smart/backend-live"
import { BudgetStackWiring } from "@/operator/budget/stack-wiring"
import { BudgetBackendLive } from "@/operator/budget/backend-live"
import { PoolsStackWiring } from "@/operator/pools/stack-wiring"
import { PoolsBackendLive } from "@/operator/pools/backend-live"
import { createRoutingDomainPort } from "@/routing/adapters/inbound/routing-command-port"
import { createRoutingConfigureBackend } from "@/routing/adapters/outbound/configure-backend"
import { DEFAULT_ROUTING_CONFIG } from "@/routing/adapters/outbound/config-adapter"
import { Effect } from "effect"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { RoutingPort } from "@/routing/application/ports"

// A minimal read-only RoutingPort — routing.status is served config-backed, so it is never called.
function fakeRouting(): RoutingPort {
  const nyi = Effect.fail({ type: "not_implemented" as const })
  return { evaluate: () => nyi, explain: () => nyi, test: () => nyi, capabilityInspect: () => nyi, status: () => nyi }
}

// The REAL wired stack — smart + budget + pools + routing over ONE shared config seam, with the
// production authority resolver threaded (exactly as stack-live composes).
function wiredStack(store: ReturnType<typeof createDurableOperatorStore>) {
  const registry = createSeededOperatorCommandRegistry()
  const mp: MutationPorts = {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: store.outbox,
  }
  const domainPorts = wireDomainPorts({
    ...SmartStackWiring.createSmartDomainWiring({ backend: SmartBackendLive.createLiveSmartBackend({ config: mp.config }) }).ports,
    ...BudgetStackWiring.createBudgetDomainWiring({ backend: BudgetBackendLive.createLiveBudgetBackend({ config: mp.config }) }).ports,
    ...PoolsStackWiring.createPoolsDomainWiring({ backend: PoolsBackendLive.createLivePoolsBackend({ config: mp.config }) }).ports,
    routing: createRoutingDomainPort(fakeRouting(), createRoutingConfigureBackend({ config: mp.config })),
  })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  const interceptor = createSlashInterceptor({ registry, dispatcher, confirmStore: createSlashConfirmStore() })
  const tuiPort = createTuiOperatorSlashPort(interceptor, { config: mp.config, resolveAuthority: createOperatorAuthorityResolver() })
  return { tuiPort, config: mp.config }
}

function freshStore() {
  return createDurableOperatorStore({ config: createFakeConfigService(), lock: createProcessMutexLockPort() })
}

// A schema-valid global routing config — enabled + auto — the exact only-global scenario.
const GLOBAL_ROUTING: RoutingConfig.Info = {
  ...DEFAULT_ROUTING_CONFIG,
  activation: { enabled: true, mode: "auto", strict_gates: true },
}

// A project is ALWAYS bound in ctx — the exact CLI/TUI condition.
const PROJECT = "proj_36"
type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
type RequestScope = "global" | "project"

/** Drive a status READ with an EXPLICIT request scope (project bound); returns the effective payload. */
async function readStatus(port: TuiPort, id: string, requestedScope?: RequestScope) {
  const res = await port.tryHandle({ text: `/op.${id}`, projectId: PROJECT, requestedScope })
  if (!res.handled) throw new Error(`${id} was not handled`)
  if (res.result?.outcome !== "success") throw new Error(`${id} outcome ${res.result?.outcome}`)
  return res.result?.effective as Record<string, unknown>
}

// =============================================================================
// (a) with only global:routing present, routing.status --scope global is configured.
// =============================================================================
describe("Feature 036 (a) — routing.status --scope global reads the global:routing document", () => {
  test("configured:true and the global activation (enabled + mode) with no project routing document", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })
    expect(await config.get("routing")).toBe(null)

    const effective = await readStatus(tuiPort, "routing.status", "global")
    expect(effective.authority).toBe("global:routing")
    expect(effective.configured).toBe(true)
    expect(effective.status).toBe("configured")
    expect(effective.activation).toEqual({ enabled: true, mode: "auto" })
  })
})

// =============================================================================
// (b) routing.status --scope global and smart.status --scope global agree.
// =============================================================================
describe("Feature 036 (b) — routing.status and smart.status agree at global scope", () => {
  test("both read the same global:routing document and agree on enabled/mode", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })

    const routing = await readStatus(tuiPort, "routing.status", "global")
    const smart = await readStatus(tuiPort, "smart.status", "global")

    const smartEnabled = smart.enabled as boolean
    const smartAuto = smart.auto as boolean
    expect(smart.configured).toBe(true)
    expect(smartEnabled).toBe(true)
    expect(smartAuto).toBe(true)
    const activation = routing.activation as { enabled: boolean; mode: string }
    expect(activation.enabled).toBe(smartEnabled)
    expect(activation.mode === "auto").toBe(smartAuto)
  })
})

// =============================================================================
// (c) routing.status --scope project SHADOWS the global config (Feature 040 supersession).
// =============================================================================
describe("Feature 036 (c) — routing.status --scope project shadows the global config (Feature 040)", () => {
  test("with only global:routing set, project scope reports the shadowed activation and agrees with smart.status", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })
    expect(await config.get("routing")).toBe(null)

    // Feature 040: the project/bare read now resolves the layered effective config, so the
    // global-only activation shadows into project scope (the write target stays `routing`).
    const effective = await readStatus(tuiPort, "routing.status", "project")
    expect(effective.authority).toBe("routing")
    expect(effective.configured).toBe(true)
    expect(effective.status).toBe("configured")
    expect(effective.activation).toEqual({ enabled: true, mode: "auto" })

    // Parity: routing.status --scope project now AGREES with smart.status --scope project.
    const smart = await readStatus(tuiPort, "smart.status", "project")
    const activation = effective.activation as { enabled: boolean; mode: string }
    expect(activation.enabled).toBe(smart.enabled as boolean)
    expect(activation.mode === "auto").toBe(smart.auto as boolean)
  })

  test("with NO routing document anywhere, project scope is honestly unconfigured (activation null)", async () => {
    const { tuiPort } = wiredStack(freshStore())

    const effective = await readStatus(tuiPort, "routing.status", "project")
    expect(effective.authority).toBe("routing")
    expect(effective.configured).toBe(false)
    expect(effective.status).toBe("unconfigured")
    expect(effective.activation).toBe(null)
  })
})

// =============================================================================
// (d) a bare routing.status (no explicit scope, project bound) shadows the global config too.
// =============================================================================
describe("Feature 036 (d) — a bare routing.status shadows the global config (Feature 040)", () => {
  test("omitting requestedScope with a bound project reports the shadowed global activation", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })

    const effective = await readStatus(tuiPort, "routing.status")
    expect(effective.authority).toBe("routing")
    expect(effective.configured).toBe(true)
    expect(effective.activation).toEqual({ enabled: true, mode: "auto" })
  })
})
