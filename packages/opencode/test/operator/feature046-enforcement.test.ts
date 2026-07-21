/**
 * Feature 046 — expose the hierarchy/capability/budget enforcement config leaves
 * through the op command surface (read + write), scope-aware and CAS-versioned.
 *
 * Drives the REAL wired dispatcher through the TUI slash port (the same
 * construction stack-live composes — smart + budget + pools + enforcement over ONE
 * shared `store.config`, production authority resolver threaded) and proves:
 *   - (a) hierarchy.set persists ONLY the leaf the operator set, on the PROJECT
 *     routing authority; the sibling hierarchy/activation leaves are preserved;
 *   - (b) capability.set round-trips enum + boolean leaves;
 *   - (c) budget.configure partial-writes a single budget leaf, preserving every
 *     other budget leaf + activation (the F035 "persist only what was set" lesson);
 *   - (d) an out-of-bounds value is rejected with a typed error, NOTHING persisted;
 *   - (e) an unknown enum member is rejected, NOTHING persisted;
 *   - (f) a global-scope write lands on `global:routing`, project `routing` stays
 *     null (the F032/F034/F035 scope-authority rule);
 *   - (g) hierarchy/capability/budget coexist on ONE routing document — none
 *     clobbers the others.
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
import { EnforcementStackWiring } from "@/operator/enforcement/stack-wiring"
import { EnforcementLeafBackend } from "@/operator/enforcement/leaf-backend"
import { createConfigAdapter } from "@/routing/adapters/outbound/config-adapter"

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
  const enforcementBackend = EnforcementLeafBackend.createLiveEnforcementBackend({ config: mp.config })
  const domainPorts = wireDomainPorts({
    ...SmartStackWiring.createSmartDomainWiring({ backend: SmartBackendLive.createLiveSmartBackend({ config: mp.config }) }).ports,
    ...BudgetStackWiring.createBudgetDomainWiring({ backend: BudgetBackendLive.createLiveBudgetBackend({ config: mp.config }), enforcement: enforcementBackend }).ports,
    ...EnforcementStackWiring.createEnforcementDomainWiring({ backend: enforcementBackend }).ports,
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

const PROJECT = "proj_46"
type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
let idem = 0

type Scope = "global" | "project"

async function preflight(port: TuiPort, commandId: string, requestedScope?: Scope) {
  const pre = await port.preflightMutation({ commandId, projectId: PROJECT, requestedScope })
  if (!pre.ok) throw new Error(`preflight ${commandId} failed: ${pre.message}`)
  return pre
}

async function drive(port: TuiPort, text: string, version?: string, requestedScope?: Scope) {
  const idempotencyKey = `idem_${idem++}`
  const first = await port.tryHandle({ text, projectId: PROJECT, version, idempotencyKey, requestedScope })
  if (!first.handled) throw new Error(`${text} was not handled`)
  if (first.needsConfirmation) {
    const confirmed = await port.tryHandle({ text, projectId: PROJECT, version, idempotencyKey, requestedScope, confirmToken: first.needsConfirmation.token })
    if (!confirmed.handled) throw new Error(`${text} confirm was not handled`)
    return confirmed
  }
  return first
}

/** Preflight + drive a mutating enforcement command through the real TUI port. */
async function setLeaves(port: TuiPort, commandId: string, values: Record<string, unknown>, requestedScope?: Scope) {
  const pre = await preflight(port, commandId, requestedScope)
  return drive(port, `/op.${commandId} ${JSON.stringify({ values })}`, pre.currentVersion ?? undefined, requestedScope)
}

async function readEffective(config: MutationPorts["config"]) {
  return (await createConfigAdapter({ config }).resolveEffective()).config
}

// =============================================================================
describe("Feature 046 (a) — hierarchy.set persists only the set leaf on the project authority", () => {
  test("set max_depth=1 leaves orchestration_only + activation untouched, global:routing null", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const res = await setLeaves(tuiPort, "hierarchy.set", { maxDepth: 1 })
    expect(res.result?.outcome).toBe("success")

    const eff = await readEffective(config)
    expect(eff.enforcement.hierarchy.max_depth).toBe(1)
    expect(eff.enforcement.hierarchy.orchestration_only).toBe(true) // default preserved
    expect(await config.get("routing")).not.toBe(null)
    expect(await config.get("global:routing")).toBe(null)
  })
})

describe("Feature 048 — hierarchy.set round-trips the orchestrationMode leaf", () => {
  test("set orchestrationMode=force_manager, absent by default, round-trips back to heuristic", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const before = await readEffective(config)
    expect(before.enforcement.hierarchy.orchestration_mode).toBeUndefined()

    const res = await setLeaves(tuiPort, "hierarchy.set", { orchestrationMode: "force_manager" })
    expect(res.result?.outcome).toBe("success")

    const eff = await readEffective(config)
    expect(eff.enforcement.hierarchy.orchestration_mode).toBe("force_manager")
    expect(eff.enforcement.hierarchy.max_depth).toBe(2) // default preserved
    expect(eff.enforcement.hierarchy.orchestration_only).toBe(true) // default preserved

    const back = await setLeaves(tuiPort, "hierarchy.set", { orchestrationMode: "heuristic" })
    expect(back.result?.outcome).toBe("success")
    expect((await readEffective(config)).enforcement.hierarchy.orchestration_mode).toBe("heuristic")
  })

  test("hierarchy.set orchestrationMode=bogus → typed rejection, no write", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const res = await setLeaves(tuiPort, "hierarchy.set", { orchestrationMode: "bogus" })
    expect(res.result?.outcome).not.toBe("success")
    expect(await config.get("routing")).toBe(null)
    expect(await config.get("global:routing")).toBe(null)
  })
})

describe("Feature 046 (b) — capability.set round-trips enum + boolean leaves", () => {
  test("set metadataSource=observed, unknownPolicy=allow, probingEnabled=true", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const res = await setLeaves(tuiPort, "capability.set", { metadataSource: "observed", unknownPolicy: "allow", probingEnabled: true })
    expect(res.result?.outcome).toBe("success")

    const cap = (await readEffective(config)).enforcement.capability
    expect(cap.metadata_source).toBe("observed")
    expect(cap.unknown_policy).toBe("allow")
    expect(cap.probing_enabled).toBe(true)
  })
})

describe("Feature 046 (c) — budget.configure partial-writes one budget leaf", () => {
  test("set cost_budget_usd only; every other budget leaf + activation preserved", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const before = await readEffective(config)
    const res = await setLeaves(tuiPort, "budget.configure", { costBudgetUsd: 3.5 })
    expect(res.result?.outcome).toBe("success")

    const budget = (await readEffective(config)).enforcement.budget
    expect(budget.cost.cost_budget_usd).toBe(3.5)
    expect(budget.limits.max_turns).toBe(before.enforcement.budget.limits.max_turns) // untouched
    expect(budget.cost.token_budget).toBe(before.enforcement.budget.cost.token_budget) // untouched
  })
})

describe("Feature 046 (d) — an out-of-bounds value is rejected, nothing persisted", () => {
  test("hierarchy.set max_depth=5 (allowed 1..2) → typed rejection, no write", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const res = await setLeaves(tuiPort, "hierarchy.set", { maxDepth: 5 })
    expect(res.result?.outcome).not.toBe("success")
    expect(await config.get("routing")).toBe(null)
    expect(await config.get("global:routing")).toBe(null)
  })
})

describe("Feature 046 (e) — an unknown enum member is rejected", () => {
  test("capability.set unknownPolicy=maybe → typed rejection, no write", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const res = await setLeaves(tuiPort, "capability.set", { unknownPolicy: "maybe" })
    expect(res.result?.outcome).not.toBe("success")
    expect(await config.get("routing")).toBe(null)
  })
})

describe("Feature 046 (f) — a global-scope write lands on global:routing, project stays null", () => {
  test("hierarchy.set --scope global writes global:routing only", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const scope: Scope = "global"
    const pre = await preflight(tuiPort, "hierarchy.set", scope)
    expect(pre.authority).toBe("global:routing")
    const res = await drive(tuiPort, `/op.hierarchy.set ${JSON.stringify({ values: { maxDepth: 1 } })}`, pre.currentVersion ?? undefined, scope)
    expect(res.result?.outcome).toBe("success")

    expect(await config.get("global:routing")).not.toBe(null)
    expect(await config.get("routing")).toBe(null)
  })
})

describe("Feature 046 (g) — hierarchy/capability/budget coexist on one routing document", () => {
  test("three enforcement writes in sequence; none clobbers the others", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    expect((await setLeaves(tuiPort, "hierarchy.set", { orchestrationOnly: false })).result?.outcome).toBe("success")
    expect((await setLeaves(tuiPort, "capability.set", { probingEnabled: true })).result?.outcome).toBe("success")
    // maxWorkers 2 is at-or-below the hard ceiling (3) — an in-bounds tighten.
    expect((await setLeaves(tuiPort, "budget.configure", { maxWorkers: 2 })).result?.outcome).toBe("success")

    const eff = await readEffective(config)
    expect(eff.enforcement.hierarchy.orchestration_only).toBe(false)
    expect(eff.enforcement.capability.probing_enabled).toBe(true)
    expect(eff.enforcement.budget.concurrency.max_workers).toBe(2)
    // Legacy budget leaves + defaults intact.
    expect(eff.enforcement.budget.limits.max_turns).toBeGreaterThan(0)
  })
})

describe("Feature 046 (h) — budget.configure never relaxes the FR4 hard ceiling", () => {
  test("an over-ceiling budget leaf is rejected (parity with budget.set), nothing persisted", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    // maxWorkers 1000 exceeds the DEFAULT_ROUTING_BUDGET ceiling (3) budget.set guards.
    const res = await setLeaves(tuiPort, "budget.configure", { maxWorkers: 1000 })
    expect(res.result?.outcome).not.toBe("success")
    expect(await config.get("routing")).toBe(null)
    expect(await config.get("global:routing")).toBe(null)
  })

  test("an over-ceiling max_turns is likewise rejected", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const res = await setLeaves(tuiPort, "budget.configure", { maxTurns: 100 })
    expect(res.result?.outcome).not.toBe("success")
    expect(await config.get("routing")).toBe(null)
  })
})
