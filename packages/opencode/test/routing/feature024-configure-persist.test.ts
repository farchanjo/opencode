/**
 * Feature 024 — routing.configure persistence (the RED "cannot activate routing" fix).
 *
 * Root cause (reproduced): `routing.configure` was the ONE config-backed operator
 * command whose inbound adapter hardcoded `fail("not_implemented", …)` — so the TUI
 * "Routing configure" Save surfaced a RED warning and routing could never be enabled.
 * The persisting writer existed but was orphaned; no write-capable backend was wired
 * into `createRoutingDomainPort` (stack-live.ts:813 passed only the read source).
 *
 * This suite drives the REAL wired dispatcher (the same construction the TUI uses —
 * smart + pools + routing over ONE shared `store.config` seam, with the production
 * authority resolver threaded) and proves:
 *   - (a) a routing.configure Save persists activation.enabled / mode / budget policy
 *     to the shared `routing` authority and the CAS version bumps;
 *   - (b) THE COEXISTENCE PROOF — pools.set (role_pools) + smart.on (activation) +
 *     routing.configure (mode + budget) in sequence, and NONE clobbers the others in
 *     the final on-disk config.json (physical round-trip + fresh-store re-read);
 *   - (c) an invalid advanced policy JSON is a TYPED validation error and commits
 *     NOTHING;
 *   - (d) a stale expected-version is a CAS conflict and commits NOTHING.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
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
import { createDurableOperatorStore, createFileConfigService } from "@/operator/adapters/outbound/config-service"
import { domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import { createOperatorAuthorityResolver } from "@/operator/application/command-authority"
import { SmartStackWiring } from "@/operator/smart/stack-wiring"
import { SmartBackendLive } from "@/operator/smart/backend-live"
import { PoolsStackWiring } from "@/operator/pools/stack-wiring"
import { PoolsBackendLive } from "@/operator/pools/backend-live"
import { createRoutingDomainPort } from "@/routing/adapters/inbound/routing-command-port"
import { createRoutingConfigureBackend } from "@/routing/adapters/outbound/configure-backend"
import { createConfigAdapter, DEFAULT_ROUTING_CONFIG } from "@/routing/adapters/outbound/config-adapter"
import type { RoutingPort } from "@/routing/application/ports"

// A distinct, valid Budget.Policy (cost_budget_usd = 42) — provably NOT the default,
// so an on-disk read confirms the operator's advanced policy actually persisted.
const CUSTOM_BUDGET: Budget.Policy = {
  limits: { max_turns: 7, max_context_tokens: 123_000, max_context_bytes: 456_000, max_output_tokens: 6_000, max_output_bytes: 24_000 },
  concurrency: { max_workers: 3, max_delegation_depth: 2 },
  retrieval: { retrieval_top_k: 12, rerank_top_k: 6, max_skill_chunks: 8, max_skill_tokens: 4_000 },
  cost: { time_budget_ms: 45_000, cost_budget_usd: 42, token_budget: 500_000 },
  resilience: { retry_depth: 2, validation_depth: 1, escalation_threshold: "manual_review" },
}

// A minimal read-only RoutingPort — the configure mutation path never calls it, so
// every method fails loudly if the wiring ever routes a read through here by mistake.
function fakeRouting(): RoutingPort {
  const nyi = Effect.fail({ type: "not_implemented" as const })
  return {
    evaluate: () => nyi,
    explain: () => nyi,
    test: () => nyi,
    capabilityInspect: () => nyi,
    status: () => nyi,
  }
}

// =============================================================================
// The REAL wired stack — smart + pools + routing over ONE shared config seam,
// with the production authority resolver threaded (exactly as stack-live composes).
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
  // The production authority resolver — routing.configure / smart.* resolve their
  // scope-dependent authority (project → "routing") so the preflight reads the RIGHT version.
  const tuiPort = createTuiOperatorSlashPort(interceptor, { config: mp.config, resolveAuthority: createOperatorAuthorityResolver() })
  return { interceptor, tuiPort, config: mp.config }
}

function freshStore() {
  return createDurableOperatorStore({ config: createFakeConfigService(), lock: createProcessMutexLockPort() })
}

const PROJECT = "proj_24"
type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
let idem = 0

/** Drive a mutating slash command through the REAL TUI port (confirm branch handled). */
async function driveMutation(port: TuiPort, text: string, version?: string) {
  const idempotencyKey = `idem_${idem++}`
  const first = await port.tryHandle({ text, projectId: PROJECT, version, idempotencyKey })
  if (!first.handled) throw new Error(`${text} was not handled`)
  if (first.needsConfirmation) {
    const confirmed = await port.tryHandle({ text, projectId: PROJECT, version, idempotencyKey, confirmToken: first.needsConfirmation.token })
    if (!confirmed.handled) throw new Error(`${text} confirm was not handled`)
    return confirmed
  }
  return first
}

/** Preflight the CAS token for a command's resolved authority. */
async function preflightVersion(port: TuiPort, commandId: string): Promise<string | undefined> {
  const pre = await port.preflightMutation({ commandId, projectId: PROJECT })
  if (!pre.ok) throw new Error(`preflight ${commandId} failed`)
  return pre.currentVersion ?? undefined
}

const configureText = (payload: unknown) => `/op.routing.configure ${JSON.stringify(payload)}`

/** Read the effective routing config back through the SAME config-adapter the engine uses. */
async function readEffective(config: MutationPorts["config"]) {
  return (await createConfigAdapter({ config }).resolveEffective()).config
}

/** Seed the project "routing" document (disabled default) so origin=project — the realistic
 *  "routing was initialized, operator now edits it" precondition that aligns the resolver
 *  (scope → "routing") with the backend (origin → "routing"). */
async function seedProjectRouting(config: MutationPorts["config"]) {
  const seed = await createConfigAdapter({ config }).set("project", DEFAULT_ROUTING_CONFIG, null)
  if (!seed.ok) throw new Error("seed failed")
  return seed.version
}

// =============================================================================
// (a) routing.configure Save persists activation + mode + policy; version bumps
// =============================================================================
describe("Feature 024 (a) — routing.configure Save persists and bumps the CAS version", () => {
  test("enabling routing + setting mode + advanced budget policy commits to the shared routing authority", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const seedVersion = await seedProjectRouting(config)

    const pre = await tuiPort.preflightMutation({ commandId: "routing.configure", projectId: PROJECT })
    expect(pre.ok).toBe(true)
    if (!pre.ok) return
    expect(pre.authority).toBe("routing")
    expect(pre.currentVersion).toBe(seedVersion)

    const res = await driveMutation(tuiPort, configureText({ enabled: true, mode: "auto", budgetPolicy: CUSTOM_BUDGET }), pre.currentVersion ?? undefined)
    expect(res.handled).toBe(true)
    expect(res.result?.outcome).toBe("success")
    // The CAS version bumped off the seed.
    expect(res.result?.version).not.toBe(seedVersion)

    const effective = await readEffective(config)
    expect(effective.activation.enabled).toBe(true)
    expect(effective.activation.mode).toBe("auto")
    expect(effective.enforcement.budget.cost.cost_budget_usd).toBe(42)
  })

  test("a SECOND configure threads the bumped version and persists again (no false 'mutations require version')", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await seedProjectRouting(config)

    const v0 = await preflightVersion(tuiPort, "routing.configure")
    const first = await driveMutation(tuiPort, configureText({ enabled: true, mode: "always" }), v0)
    expect(first.result?.outcome).toBe("success")

    const v1 = await preflightVersion(tuiPort, "routing.configure")
    expect(v1).toBe(first.result?.version ?? undefined)
    const second = await driveMutation(tuiPort, configureText({ enabled: false, mode: "never" }), v1)
    expect(second.result?.outcome).toBe("success")

    const effective = await readEffective(config)
    expect(effective.activation.enabled).toBe(false)
    expect(effective.activation.mode).toBe("never")
  })
})

// =============================================================================
// (c) invalid advanced policy JSON → typed validation error, nothing committed
// =============================================================================
describe("Feature 024 (c) — an invalid advanced policy is a typed validation error, committing nothing", () => {
  test("a schema-invalid budgetPolicy is rejected and the routing document is unchanged", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const seedVersion = await seedProjectRouting(config)

    const v0 = await preflightVersion(tuiPort, "routing.configure")
    // A budgetPolicy missing required sub-structures fails RoutingConfig schema validation.
    const bad = await driveMutation(tuiPort, configureText({ enabled: true, mode: "auto", budgetPolicy: { limits: { max_turns: "lots" } } }), v0)
    expect(bad.handled).toBe(true)
    expect(bad.result?.outcome).not.toBe("success")
    expect(bad.display.variant).not.toBe("success")

    // Nothing committed: the seed document (disabled default) is intact, version unchanged.
    const effective = await readEffective(config)
    expect(effective.activation.enabled).toBe(false)
    const after = await tuiPort.preflightMutation({ commandId: "routing.configure", projectId: PROJECT })
    expect(after.ok && after.currentVersion).toBe(seedVersion)
  })

  test("an all-empty payload is rejected as invalid_argument (a Save must change a field)", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await seedProjectRouting(config)
    const v0 = await preflightVersion(tuiPort, "routing.configure")
    const empty = await driveMutation(tuiPort, configureText({}), v0)
    expect(empty.result?.outcome).not.toBe("success")
    expect(empty.display.variant).not.toBe("success")
  })
})

// =============================================================================
// (d) stale expected-version → conflict, nothing committed (CAS preserved)
// =============================================================================
describe("Feature 024 (d) — a stale expected-version is a CAS conflict, committing nothing", () => {
  test("a configure threading a stale token is rejected and the committed document is preserved", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    await seedProjectRouting(config)

    const v0 = await preflightVersion(tuiPort, "routing.configure")
    const good = await driveMutation(tuiPort, configureText({ enabled: true, mode: "auto" }), v0)
    expect(good.result?.outcome).toBe("success")
    const committed = good.result?.version

    const stale = await driveMutation(tuiPort, configureText({ enabled: false, mode: "never" }), "cas_stale_token")
    expect(stale.handled).toBe(true)
    expect(stale.result?.outcome).toBe("conflict")
    expect(stale.display.variant).not.toBe("success")

    // The rejected write persisted nothing — the committed state is untouched.
    const effective = await readEffective(config)
    expect(effective.activation.enabled).toBe(true)
    expect(effective.activation.mode).toBe("auto")
    const after = await tuiPort.preflightMutation({ commandId: "routing.configure", projectId: PROJECT })
    expect(after.ok && after.currentVersion).toBe(committed ?? null)
  })
})

// =============================================================================
// (b) THE COEXISTENCE PROOF — pools.set + smart.on + routing.configure share ONE
// routing document and none clobbers the others, verified on physical disk.
// =============================================================================
const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "op-024-"))
  roots.push(dir)
  return dir
}

describe("Feature 024 (b) — shared-authority coexistence: pools + smart + routing.configure never clobber", () => {
  test("role_pools (pools) + activation.enabled (smart) + mode/budget (routing) all survive on disk and a fresh re-read", async () => {
    const dir = tempRoot()
    const file = path.join(dir, "config.json")
    const store = createDurableOperatorStore({ config: createFileConfigService(file), lock: createProcessMutexLockPort() })
    const { tuiPort, config } = wiredStack(store)

    // 1) pools.set establishes the project "routing" document with a role pool.
    const pv = await preflightVersion(tuiPort, "pools.set")
    const pools = await driveMutation(tuiPort, `/op.pools.set ${JSON.stringify({ bindings: [{ role: "architect", models: ["gpt-5"] }] })}`, pv)
    expect(pools.result?.outcome).toBe("success")

    // 2) smart.on flips activation.enabled=true — merged over the SAME document.
    const sv = await preflightVersion(tuiPort, "smart.on")
    const smart = await driveMutation(tuiPort, `/op.smart.on ${JSON.stringify({})}`, sv)
    expect(smart.result?.outcome).toBe("success")

    // 3) routing.configure sets mode + advanced budget policy WITHOUT touching enabled —
    //    proving it partial-merges (preserving smart's enabled AND pools' role_pools).
    const rv = await preflightVersion(tuiPort, "routing.configure")
    const routing = await driveMutation(tuiPort, configureText({ mode: "auto", budgetPolicy: CUSTOM_BUDGET }), rv)
    expect(routing.result?.outcome).toBe("success")

    // In-memory effective view: every writer's field coexists.
    const effective = await readEffective(config)
    expect(effective.models.role_pools["architect"]).toEqual(["gpt-5"]) // pools.set — NOT clobbered
    expect(effective.activation.enabled).toBe(true) // smart.on — NOT clobbered
    expect(effective.activation.mode).toBe("auto") // routing.configure
    expect(effective.enforcement.budget.cost.cost_budget_usd).toBe(42) // routing.configure

    // PHYSICAL proof: the shared "routing" authority on disk holds ALL THREE contributions.
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
      operator: { authorities: Record<string, { payload: { activation: { enabled: boolean; mode: string }; models: { role_pools: Record<string, string[]> }; enforcement: { budget: { cost: { cost_budget_usd: number } } } } }> }
    }
    const doc = onDisk.operator.authorities["routing"].payload
    expect(doc.models.role_pools["architect"]).toEqual(["gpt-5"])
    expect(doc.activation.enabled).toBe(true)
    expect(doc.activation.mode).toBe("auto")
    expect(doc.enforcement.budget.cost.cost_budget_usd).toBe(42)

    // FRESH load over the SAME file re-reads from disk (no stale cache) — the decisive proof.
    const store2 = createDurableOperatorStore({ config: createFileConfigService(file), lock: createProcessMutexLockPort() })
    const reread = await createConfigAdapter({ config: store2.config }).resolveEffective()
    expect(reread.config.models.role_pools["architect"]).toEqual(["gpt-5"])
    expect(reread.config.activation.enabled).toBe(true)
    expect(reread.config.activation.mode).toBe("auto")
    expect(reread.config.enforcement.budget.cost.cost_budget_usd).toBe(42)
  })
})
