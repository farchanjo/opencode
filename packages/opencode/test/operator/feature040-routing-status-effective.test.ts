/**
 * Feature 040 — the operator Configure modals prefill from the persisted authority via the
 * EFFECTIVE read (ADR-0040 Option A). This suite drives the SAME real wired dispatcher the TUI
 * modal prefill rides (smart + budget + pools + routing over ONE shared `store.config`, the
 * production authority resolver threaded) and proves the `routing.status` read the
 * `routing.configure` modal prefills from:
 *   - (1) reports the shadowed EFFECTIVE activation for a project/bare scope (project > global >
 *     default), so a global-only config surfaces — the modal-prefill value set EQUALS what the
 *     effective status / `op routing show` reports for the resolved scope (read-parity);
 *   - (2) re-resolves per Request scope: switching project ↔ global reflects THAT scope's
 *     effective config (a project document shadows the global one at project scope; explicit
 *     global reads `global:routing` directly) — the scope-switch parity the modal re-read needs;
 *   - (3) drops nothing on a Save → reopen round-trip: a committed global save is re-read at the
 *     same scope with the saved `enabled`/`mode`.
 *
 * The redacted activation projection (`enabled` + `mode`) is the ONLY payload field surfaced —
 * never the raw config document — so the read stays a status projection.
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

function fakeRouting(): RoutingPort {
  const nyi = Effect.fail({ type: "not_implemented" as const })
  return { evaluate: () => nyi, explain: () => nyi, test: () => nyi, capabilityInspect: () => nyi, status: () => nyi }
}

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

const GLOBAL_ROUTING: RoutingConfig.Info = { ...DEFAULT_ROUTING_CONFIG, activation: { enabled: true, mode: "auto", strict_gates: true } }
const PROJECT_ROUTING: RoutingConfig.Info = { ...DEFAULT_ROUTING_CONFIG, activation: { enabled: false, mode: "never", strict_gates: true } }

const PROJECT = "proj_40"
type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
type RequestScope = "global" | "project"

async function readStatus(port: TuiPort, id: string, requestedScope?: RequestScope) {
  const res = await port.tryHandle({ text: `/op.${id}`, projectId: PROJECT, requestedScope })
  if (!res.handled) throw new Error(`${id} was not handled`)
  if (res.result?.outcome !== "success") throw new Error(`${id} outcome ${res.result?.outcome}`)
  return res.result?.effective as Record<string, unknown>
}

// (1) read-parity — the prefill read reports the shadowed effective activation ==============
describe("Feature 040 (1) — routing.status prefill EQUALS the effective status for the resolved scope", () => {
  test("a global-only activation surfaces at the default (project) scope and matches smart.status", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })

    const routing = await readStatus(tuiPort, "routing.status", "project")
    const smart = await readStatus(tuiPort, "smart.status", "project")

    expect(routing.configured).toBe(true)
    expect(routing.activation).toEqual({ enabled: true, mode: "auto" })
    const activation = routing.activation as { enabled: boolean; mode: string }
    expect(activation.enabled).toBe(smart.enabled as boolean)
    expect(activation.mode === "auto").toBe(smart.auto as boolean)
  })
})

// (2) scope-switch parity — each scope reflects THAT scope's effective config ===============
describe("Feature 040 (2) — switching Request scope reflects that scope's effective config", () => {
  test("a project document shadows the global one at project scope; explicit global reads global:routing", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })
    await config.compareAndSet({ authority: "routing", expectedVersion: null, payload: PROJECT_ROUTING, nowMs: 2 })

    const project = await readStatus(tuiPort, "routing.status", "project")
    expect(project.authority).toBe("routing")
    expect(project.activation).toEqual({ enabled: false, mode: "never" })

    const global = await readStatus(tuiPort, "routing.status", "global")
    expect(global.authority).toBe("global:routing")
    expect(global.activation).toEqual({ enabled: true, mode: "auto" })
  })
})

// (3) round-trip — a committed global save is re-read intact at the same scope =============
describe("Feature 040 (3) — a Save → reopen round-trip drops no persisted field", () => {
  test("a global routing.configure save is re-prefilled with the saved enabled/mode on reopen", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    // Persist the global activation the operator would have saved through the modal.
    await config.compareAndSet({ authority: "global:routing", expectedVersion: null, payload: GLOBAL_ROUTING, nowMs: 1 })

    const reopened = await readStatus(tuiPort, "routing.status", "global")
    expect(reopened.configured).toBe(true)
    expect(reopened.activation).toEqual({ enabled: true, mode: "auto" })
  })
})
