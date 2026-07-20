/**
 * Feature 034 — an EXPLICIT operator request-scope selector overrides the ambient-project
 * preference, so a scope-flexible command (e.g. `pools.set`) can be requested at GLOBAL
 * scope even while a project is bound to the working directory.
 *
 * Feature 033 widened the pools WRITE authority to follow the request scope, but no
 * frontend could actually REQUEST global scope: both `resolveOperatorScope` (core) and
 * `resolveCliScope` (CLI) prefer PROJECT whenever a `projectId` is bound — and opencode
 * binds a project to every directory — so `global:routing` was unreachable in practice.
 * The F033 suite only reached global by passing `projectId: null`, bypassing the
 * project-preference the real frontends hit.
 *
 * This suite drives the SAME REAL wired dispatcher the TUI uses (pools + smart + budget +
 * routing over ONE shared `store.config`, production authority resolver threaded) but with
 * a bound `projectId` in ctx — exactly the CLI/TUI scenario F033 could not reach — and
 * proves the explicit request scope overrides that binding:
 *   - (a) an explicit-GLOBAL `pools.set` (project bound) persists role_pools to
 *     `global:routing`, the project `routing` document stays absent;
 *   - (b) a SECOND explicit-global save succeeds (preflight authority == write authority ==
 *     read authority — CAS bump, no "mutations require version");
 *   - (c) an explicit-PROJECT `pools.set` still writes the project `routing` document;
 *   - (d) the DEFAULT (no explicit scope, project bound) stays project — full back-compat.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
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
import { createConfigAdapter } from "@/routing/adapters/outbound/config-adapter"
import type { RoutingPort } from "@/routing/application/ports"

// A minimal read-only RoutingPort — the pools mutation path never calls it.
function fakeRouting(): RoutingPort {
  const nyi = Effect.fail({ type: "not_implemented" as const })
  return { evaluate: () => nyi, explain: () => nyi, test: () => nyi, capabilityInspect: () => nyi, status: () => nyi }
}

// The REAL wired stack — pools + smart + budget + routing over ONE shared config seam,
// with the production authority resolver threaded (exactly as stack-live composes).
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
  return { interceptor, tuiPort, config: mp.config }
}

function freshStore() {
  return createDurableOperatorStore({ config: createFakeConfigService(), lock: createProcessMutexLockPort() })
}

// A project is ALWAYS bound in ctx — the exact condition that made global unreachable pre-034.
const PROJECT = "proj_34"
type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
type RequestScope = "global" | "project"
let idem = 0

/** Drive a mutating slash command with an EXPLICIT request scope while a projectId is bound. */
async function driveMutation(port: TuiPort, text: string, requestedScope: RequestScope, version?: string) {
  const idempotencyKey = `idem_${idem++}`
  const first = await port.tryHandle({ text, projectId: PROJECT, requestedScope, version, idempotencyKey })
  if (!first.handled) throw new Error(`${text} was not handled`)
  if (first.needsConfirmation) {
    const confirmed = await port.tryHandle({ text, projectId: PROJECT, requestedScope, version, idempotencyKey, confirmToken: first.needsConfirmation.token })
    if (!confirmed.handled) throw new Error(`${text} confirm was not handled`)
    return confirmed
  }
  return first
}

/** Preflight the CAS token for the command's EXPLICIT request scope (project always bound). */
async function preflight(port: TuiPort, commandId: string, requestedScope: RequestScope) {
  const pre = await port.preflightMutation({ commandId, projectId: PROJECT, requestedScope })
  if (!pre.ok) throw new Error(`preflight ${commandId} failed: ${pre.message}`)
  return pre
}

const poolsText = (bindings: unknown) => `/op.pools.set ${JSON.stringify({ bindings })}`

async function readEffective(config: MutationPorts["config"]) {
  return (await createConfigAdapter({ config }).resolveEffective()).config
}

// =============================================================================
// (a) explicit-GLOBAL pools.set persists to global:routing WHILE a project is bound.
// =============================================================================
describe("Feature 034 (a) — explicit-global pools.set overrides the bound project", () => {
  test("global request writes global:routing and leaves the project routing document absent", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    // A project IS bound (projectId=PROJECT) — pre-034 this would resolve to project scope.
    const pre = await preflight(tuiPort, "pools.set", "global")
    expect(pre.authority).toBe("global:routing")
    expect(pre.currentVersion).toBe(null)

    const res = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5"] }]), "global", pre.currentVersion ?? undefined)
    expect(res.result?.outcome).toBe("success")

    expect(await config.get("global:routing")).not.toBe(null)
    expect(await config.get("routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["architect"]).toEqual(["gpt-5"])
  })
})

// =============================================================================
// (b) preflight authority == write authority == read authority — second global save OK.
// =============================================================================
describe("Feature 034 (b) — the explicit-global preflight tracks the write authority", () => {
  test("two consecutive explicit-global pools.set BOTH succeed and bump the global:routing CAS token", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre0 = await preflight(tuiPort, "pools.set", "global")
    expect(pre0.authority).toBe("global:routing")
    expect(pre0.currentVersion).toBe(null)
    const first = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5"] }]), "global", pre0.currentVersion ?? undefined)
    expect(first.result?.outcome).toBe("success")

    // SECOND save threads the bumped GLOBAL token — must NOT fail 'mutations require version'.
    const pre1 = await preflight(tuiPort, "pools.set", "global")
    expect(pre1.authority).toBe("global:routing")
    expect(pre1.currentVersion).toBe(first.result?.version ?? null)
    const second = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5", "claude-x"] }]), "global", pre1.currentVersion ?? undefined)
    expect(second.result?.outcome).toBe("success")
    expect(second.result?.version ?? null).not.toBe(first.result?.version ?? null)

    expect(await config.get("routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["architect"]).toEqual(["gpt-5", "claude-x"])
  })
})

// =============================================================================
// (c) explicit-PROJECT pools.set still writes the project routing authority.
// =============================================================================
describe("Feature 034 (c) — explicit-project pools.set still writes the project routing authority", () => {
  test("project request writes routing and leaves global:routing absent", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre = await preflight(tuiPort, "pools.set", "project")
    expect(pre.authority).toBe("routing")

    const res = await driveMutation(tuiPort, poolsText([{ role: "worker", models: ["claude-x"] }]), "project", pre.currentVersion ?? undefined)
    expect(res.result?.outcome).toBe("success")

    expect(await config.get("routing")).not.toBe(null)
    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["worker"]).toEqual(["claude-x"])
  })
})

// =============================================================================
// (d) DEFAULT (no explicit scope, project bound) stays project — back-compat.
// =============================================================================
describe("Feature 034 (d) — the default (no explicit scope) stays project", () => {
  test("omitting requestedScope with a bound project writes the project routing authority", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    // No requestedScope threaded — the ambient project preference applies (pre-034 behavior).
    const idempotencyKey = `idem_${idem++}`
    const pre = await tuiPort.preflightMutation({ commandId: "pools.set", projectId: PROJECT })
    if (!pre.ok) throw new Error(`preflight failed: ${pre.message}`)
    expect(pre.authority).toBe("routing")

    const res = await tuiPort.tryHandle({
      text: poolsText([{ role: "reviewer", models: ["gpt-5"] }]),
      projectId: PROJECT,
      version: pre.currentVersion ?? undefined,
      idempotencyKey,
    })
    if (!res.handled) throw new Error("default pools.set was not handled")
    expect(res.result?.outcome).toBe("success")

    expect(await config.get("routing")).not.toBe(null)
    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["reviewer"]).toEqual(["gpt-5"])
  })
})
