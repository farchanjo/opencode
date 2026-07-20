/**
 * Feature 033 — pools.* (role_pools) write authority follows the REQUEST scope, so a
 * single GLOBAL config can govern every project instead of being bound to one
 * representative directory.
 *
 * Before this feature `pools.set` was HARDWIRED to the project `routing` authority
 * (`pools/backend-live.ts` returned `PROJECT_AUTHORITY` unconditionally, and
 * `command-authority.ts` mapped `pools.*` statically to project), so role_pools could
 * only ever be per-project — even though `smart.*`/`budget.*`/`routing.configure`
 * already honored global scope (Feature 024/025) and the catalog already granted
 * `pools.*` the Global+Project (`GP`) scope set.
 *
 * This suite drives the REAL wired dispatcher (the same construction the TUI uses —
 * pools + smart + budget + routing over ONE shared `store.config`, with the production
 * authority resolver threaded) and proves:
 *   - (a) a GLOBAL-scope pools.set persists role_pools to `global:routing` (project
 *     `routing` untouched), read back through the effective config;
 *   - (b) a PROJECT-scope pools.set still writes the project `routing` authority
 *     (back-compat default), `global:routing` untouched;
 *   - (c) a GLOBAL config governs a project that has NO project routing document — the
 *     effective role_pools resolve from `global:routing`;
 *   - (d) PRECEDENCE — when both scopes hold a document, the PROJECT role_pool wins for
 *     the same role (project shadows global — the Feature 001/024 layered model);
 *   - (e) the mutation preflight authority tracks the request scope (global → the CAS
 *     token comes from `global:routing`, project → `routing`), so a second global save
 *     never fails "mutations require version".
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

// A minimal read-only RoutingPort — the pools mutation path never calls it, so every
// method fails loudly if the wiring ever routes a read through here.
function fakeRouting(): RoutingPort {
  const nyi = Effect.fail({ type: "not_implemented" as const })
  return { evaluate: () => nyi, explain: () => nyi, test: () => nyi, capabilityInspect: () => nyi, status: () => nyi }
}

// =============================================================================
// The REAL wired stack — pools + smart + budget + routing over ONE shared config
// seam, with the production authority resolver threaded (exactly as stack-live composes).
// =============================================================================
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

const PROJECT = "proj_33"
type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
let idem = 0

/** Drive a mutating slash command through the REAL TUI port (confirm branch handled). */
async function driveMutation(port: TuiPort, text: string, version?: string, projectId: string | null = PROJECT) {
  const idempotencyKey = `idem_${idem++}`
  const first = await port.tryHandle({ text, projectId, version, idempotencyKey })
  if (!first.handled) throw new Error(`${text} was not handled`)
  if (first.needsConfirmation) {
    const confirmed = await port.tryHandle({ text, projectId, version, idempotencyKey, confirmToken: first.needsConfirmation.token })
    if (!confirmed.handled) throw new Error(`${text} confirm was not handled`)
    return confirmed
  }
  return first
}

/** Preflight the CAS token for a command's resolved authority (projectId null → global). */
async function preflight(port: TuiPort, commandId: string, projectId: string | null = PROJECT) {
  const pre = await port.preflightMutation({ commandId, projectId })
  if (!pre.ok) throw new Error(`preflight ${commandId} failed: ${pre.message}`)
  return pre
}

const poolsText = (bindings: unknown) => `/op.pools.set ${JSON.stringify({ bindings })}`

/** Read the effective routing config back through the SAME config-adapter the engine uses. */
async function readEffective(config: MutationPorts["config"]) {
  return (await createConfigAdapter({ config }).resolveEffective()).config
}

// =============================================================================
// (a) GLOBAL-scope pools.set persists role_pools to global:routing.
// =============================================================================
describe("Feature 033 (a) — a global-scope pools.set persists role_pools to global:routing", () => {
  test("global pools.set writes global:routing and leaves the project routing document absent", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre = await preflight(tuiPort, "pools.set", null)
    expect(pre.authority).toBe("global:routing")
    expect(pre.currentVersion).toBe(null)

    const res = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5"] }]), pre.currentVersion ?? undefined, null)
    expect(res.result?.outcome).toBe("success")

    // The write landed on the GLOBAL authority — the project `routing` doc stays absent.
    expect(await config.get("global:routing")).not.toBe(null)
    expect(await config.get("routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["architect"]).toEqual(["gpt-5"])
  })
})

// =============================================================================
// (b) PROJECT-scope pools.set still writes the project routing authority (back-compat).
// =============================================================================
describe("Feature 033 (b) — a project-scope pools.set still writes the project routing authority", () => {
  test("project pools.set writes routing and leaves global:routing absent", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre = await preflight(tuiPort, "pools.set", PROJECT)
    expect(pre.authority).toBe("routing")

    const res = await driveMutation(tuiPort, poolsText([{ role: "worker", models: ["claude-x"] }]), pre.currentVersion ?? undefined, PROJECT)
    expect(res.result?.outcome).toBe("success")

    expect(await config.get("routing")).not.toBe(null)
    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["worker"]).toEqual(["claude-x"])
  })
})

// =============================================================================
// (c) a GLOBAL config governs a project with no project routing document.
// =============================================================================
describe("Feature 033 (c) — a global role_pool governs a project that has no project document", () => {
  test("the effective config of a fresh project resolves role_pools from global:routing", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    // Write ONLY the global authority — no project routing document is ever created.
    const pre = await preflight(tuiPort, "pools.set", null)
    const res = await driveMutation(tuiPort, poolsText([{ role: "reviewer", models: ["gpt-5"] }]), pre.currentVersion ?? undefined, null)
    expect(res.result?.outcome).toBe("success")
    expect(await config.get("routing")).toBe(null)

    // A read for the project (no project doc) inherits the global role_pools.
    expect((await readEffective(config)).models.role_pools["reviewer"]).toEqual(["gpt-5"])
  })
})

// =============================================================================
// (d) PRECEDENCE — a project role_pool overrides a global role_pool for the same role.
// =============================================================================
describe("Feature 033 (d) — project role_pools override global for the same role (layered model)", () => {
  test("a project pools.set shadows the global role_pool while global stays persisted", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    // 1) Establish a GLOBAL role_pool for architect.
    const gpre = await preflight(tuiPort, "pools.set", null)
    const global = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["global-model"] }]), gpre.currentVersion ?? undefined, null)
    expect(global.result?.outcome).toBe("success")

    // 2) Establish a PROJECT role_pool for the SAME role with different models.
    const ppre = await preflight(tuiPort, "pools.set", PROJECT)
    expect(ppre.authority).toBe("routing")
    const project = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["project-model"] }]), ppre.currentVersion ?? undefined, PROJECT)
    expect(project.result?.outcome).toBe("success")

    // Effective resolution: the PROJECT document shadows the GLOBAL one for the role.
    expect((await readEffective(config)).models.role_pools["architect"]).toEqual(["project-model"])

    // Both documents remain independently persisted — global is not clobbered.
    expect(await config.get("global:routing")).not.toBe(null)
    expect(await config.get("routing")).not.toBe(null)
  })
})

// =============================================================================
// (e) the preflight authority tracks the request scope — a second global save succeeds.
// =============================================================================
describe("Feature 033 (e) — the pools preflight authority tracks the request scope", () => {
  test("two consecutive global-scope pools.set BOTH succeed and bump the global:routing CAS token", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre0 = await preflight(tuiPort, "pools.set", null)
    expect(pre0.authority).toBe("global:routing")
    expect(pre0.currentVersion).toBe(null)
    const first = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5"] }]), pre0.currentVersion ?? undefined, null)
    expect(first.result?.outcome).toBe("success")

    // SECOND save threads the bumped GLOBAL token — must NOT fail 'mutations require version'.
    const pre1 = await preflight(tuiPort, "pools.set", null)
    expect(pre1.authority).toBe("global:routing")
    expect(pre1.currentVersion).toBe(first.result?.version ?? null)
    const second = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5", "claude-x"] }]), pre1.currentVersion ?? undefined, null)
    expect(second.result?.outcome).toBe("success")
    expect(second.result?.version ?? null).not.toBe(first.result?.version ?? null)

    expect(await config.get("routing")).toBe(null)
    expect((await readEffective(config)).models.role_pools["architect"]).toEqual(["gpt-5", "claude-x"])
  })
})
