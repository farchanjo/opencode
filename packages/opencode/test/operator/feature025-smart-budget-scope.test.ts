/**
 * Feature 025 — smart.* / budget.* write authority follows the REQUEST scope.
 *
 * Root cause (reproduced, same class Feature 024 fixed for routing.configure): the
 * `smart` and `budget` operator config Saves derived their WRITE authority from the
 * effective-config ORIGIN, not the REQUEST scope, while the mutation preflight/CAS
 * token comes from the request scope (`command-authority.ts` — case "smart"/"budget"
 * → `SMART_AUTHORITY`/`BUDGET_AUTHORITY[norm(scope.kind)]`, where `norm` maps
 * everything but "global" to "project"):
 *   - `smart/backend-live.ts` used `scopeForOrigin(effective.origin)` — on a FRESH
 *     project (no project routing doc) the effective origin is "default"/"global", so
 *     SAVE#1 silently persisted to `global:routing` (preflight expected project
 *     `routing`, version null) and SAVE#2 hard-failed `invalid_argument`
 *     ("mutations require version").
 *   - `budget-command-port.ts` passed a payload-or-request scope straight through
 *     WITHOUT normalization, so a non-global, non-project scope kind (or a
 *     payload-supplied scope the preflight never sees) diverged from the preflight's
 *     normalized authority.
 *
 * This suite drives the REAL wired dispatcher (the same construction the TUI uses —
 * smart + budget + pools + routing over ONE shared `store.config`, with the
 * production authority resolver threaded) and proves:
 *   - (a) two consecutive project-scope smart.on then smart.off on a FRESH (unseeded)
 *     project BOTH succeed and land on the PROJECT `routing` authority
 *     (`global:routing` stays null), and the CAS version bumps — NO masking seed;
 *   - (b) two consecutive project-scope budget.set on a FRESH project BOTH succeed and
 *     land on the PROJECT `routing` authority, version bumps;
 *   - (c) a global-scope smart.on / budget.set writes `global:routing`;
 *   - (d) THE FULL COEXISTENCE PROOF — pools.set + smart.on + budget.set +
 *     routing.configure in sequence, and NONE clobbers the others in the final
 *     on-disk `config.json` (physical round-trip + fresh-store re-read);
 *   - (e) an invalid payload → typed error, NOTHING committed;
 *   - (f) a stale expected-version → conflict, NOTHING committed (CAS preserved).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
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
import { createDurableOperatorStore, createFileConfigService } from "@/operator/adapters/outbound/config-service"
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

// A limits view strictly tighter than the default ceiling — provably NOT the default,
// so an on-disk read confirms the operator's budget actually persisted.
const TIGHTER = { maxTurns: 5, maxContextTokens: 100_000, maxOutputTokens: 4_000, maxWorkers: 2, tokenBudget: 500_000 } as const

// A minimal read-only RoutingPort — the smart/budget/configure mutation paths never
// call it, so every method fails loudly if the wiring ever routes a read through here.
function fakeRouting(): RoutingPort {
  const nyi = Effect.fail({ type: "not_implemented" as const })
  return { evaluate: () => nyi, explain: () => nyi, test: () => nyi, capabilityInspect: () => nyi, status: () => nyi }
}

// =============================================================================
// The REAL wired stack — smart + budget + pools + routing over ONE shared config
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

const PROJECT = "proj_25"
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

/** Preflight the CAS token for a command's resolved authority. */
async function preflight(port: TuiPort, commandId: string, projectId: string | null = PROJECT) {
  const pre = await port.preflightMutation({ commandId, projectId })
  if (!pre.ok) throw new Error(`preflight ${commandId} failed: ${pre.message}`)
  return pre
}

const smartText = (verb: "on" | "off" | "auto") => `/op.smart.${verb} ${JSON.stringify({})}`
const budgetText = (limits: unknown) => `/op.budget.set ${JSON.stringify({ limits })}`
const poolsText = (bindings: unknown) => `/op.pools.set ${JSON.stringify({ bindings })}`
const configureText = (payload: unknown) => `/op.routing.configure ${JSON.stringify(payload)}`

/** Read the effective routing config back through the SAME config-adapter the engine uses. */
async function readEffective(config: MutationPorts["config"]) {
  return (await createConfigAdapter({ config }).resolveEffective()).config
}

// =============================================================================
// (a) smart.* — two consecutive project-scope Saves on a FRESH project both persist
//     to the PROJECT authority (the exact reproduced RED failure, un-masked).
// =============================================================================
describe("Feature 025 (a) — smart write authority follows the REQUEST scope, not the effective origin", () => {
  test("smart.on then smart.off on a FRESH project BOTH succeed and land on the PROJECT routing authority", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    // No seed: config resolves via default. The preflight targets the PROJECT "routing"
    // doc (create-if-absent, currentVersion null), never global:routing.
    const pre0 = await preflight(tuiPort, "smart.on")
    expect(pre0.authority).toBe("routing")
    expect(pre0.currentVersion).toBe(null)

    const first = await driveMutation(tuiPort, smartText("on"), pre0.currentVersion ?? undefined)
    expect(first.result?.outcome).toBe("success")
    expect(first.result?.version).not.toBe(null)

    // The write landed on the PROJECT authority — `global:routing` stays absent.
    expect(await config.get("routing")).not.toBe(null)
    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).activation.enabled).toBe(true)

    // SECOND save threads the bumped PROJECT token — must NOT fail 'mutations require version'.
    const pre1 = await preflight(tuiPort, "smart.off")
    expect(pre1.authority).toBe("routing")
    expect(pre1.currentVersion).toBe(first.result?.version ?? null)
    const second = await driveMutation(tuiPort, smartText("off"), pre1.currentVersion ?? undefined)
    expect(second.result?.outcome).toBe("success")
    expect(second.result?.version ?? null).not.toBe(first.result?.version ?? null)

    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).activation.enabled).toBe(false)
  })
})

// =============================================================================
// (b) budget.set — two consecutive project-scope Saves on a FRESH project persist.
// =============================================================================
describe("Feature 025 (b) — budget write authority follows the REQUEST scope", () => {
  test("budget.set twice on a FRESH project BOTH succeed and land on the PROJECT routing authority", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre0 = await preflight(tuiPort, "budget.set")
    expect(pre0.authority).toBe("routing")
    expect(pre0.currentVersion).toBe(null)

    const first = await driveMutation(tuiPort, budgetText(TIGHTER), pre0.currentVersion ?? undefined)
    expect(first.result?.outcome).toBe("success")
    expect(await config.get("routing")).not.toBe(null)
    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).enforcement.budget.limits.max_turns).toBe(TIGHTER.maxTurns)

    const pre1 = await preflight(tuiPort, "budget.set")
    expect(pre1.currentVersion).toBe(first.result?.version ?? null)
    const tighterStill = { ...TIGHTER, maxTurns: 4 }
    const second = await driveMutation(tuiPort, budgetText(tighterStill), pre1.currentVersion ?? undefined)
    expect(second.result?.outcome).toBe("success")
    expect(second.result?.version ?? null).not.toBe(first.result?.version ?? null)

    expect(await config.get("global:routing")).toBe(null)
    expect((await readEffective(config)).enforcement.budget.limits.max_turns).toBe(4)
  })
})

// =============================================================================
// (c) global-scope Saves write the GLOBAL routing authority.
// =============================================================================
describe("Feature 025 (c) — a global-scope smart/budget Save writes global:routing", () => {
  test("a global-scope smart.on targets global:routing (project 'routing' untouched)", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const pre = await preflight(tuiPort, "smart.on", null)
    expect(pre.authority).toBe("global:routing")

    const res = await driveMutation(tuiPort, smartText("on"), pre.currentVersion ?? undefined, null)
    expect(res.result?.outcome).toBe("success")
    expect(await config.get("global:routing")).not.toBe(null)
    expect(await config.get("routing")).toBe(null)
  })

  test("a global-scope budget.set targets global:routing", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    const pre = await preflight(tuiPort, "budget.set", null)
    expect(pre.authority).toBe("global:routing")

    const res = await driveMutation(tuiPort, budgetText(TIGHTER), pre.currentVersion ?? undefined, null)
    expect(res.result?.outcome).toBe("success")
    expect(await config.get("global:routing")).not.toBe(null)
    expect(await config.get("routing")).toBe(null)
  })
})

// =============================================================================
// (e) invalid payload → typed error, nothing committed.
// =============================================================================
describe("Feature 025 (e) — an invalid budget payload is a typed error, committing nothing", () => {
  test("a budget.set that exceeds the hard ceiling is rejected and the routing document is unchanged", async () => {
    const { tuiPort, config } = wiredStack(freshStore())
    // Seed a known committed version so we can prove nothing changed.
    const seed = await createConfigAdapter({ config }).set("project", (await readEffective(config)), null)
    if (!seed.ok) throw new Error("seed failed")

    const pre = await preflight(tuiPort, "budget.set")
    const relaxed = { ...TIGHTER, maxTurns: 999 } // above the default ceiling (10)
    const bad = await driveMutation(tuiPort, budgetText(relaxed), pre.currentVersion ?? undefined)
    expect(bad.handled).toBe(true)
    expect(bad.result?.outcome).not.toBe("success")
    expect(bad.display.variant).not.toBe("success")

    // Nothing committed: the seed document's version is unchanged.
    const after = await preflight(tuiPort, "budget.set")
    expect(after.currentVersion).toBe(seed.version)
  })
})

// =============================================================================
// (f) stale expected-version → conflict, nothing committed (CAS preserved).
// =============================================================================
describe("Feature 025 (f) — a stale expected-version is a CAS conflict, committing nothing", () => {
  test("a smart.on threading a stale token is rejected and the committed document is preserved", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    const pre = await preflight(tuiPort, "smart.on")
    const good = await driveMutation(tuiPort, smartText("on"), pre.currentVersion ?? undefined)
    expect(good.result?.outcome).toBe("success")
    const committed = good.result?.version

    const stale = await driveMutation(tuiPort, smartText("off"), "cas_stale_token")
    expect(stale.handled).toBe(true)
    expect(stale.result?.outcome).toBe("conflict")
    expect(stale.display.variant).not.toBe("success")

    // The rejected write persisted nothing — the committed state is untouched.
    expect((await readEffective(config)).activation.enabled).toBe(true)
    const after = await preflight(tuiPort, "smart.on")
    expect(after.currentVersion).toBe(committed ?? null)
  })
})

// =============================================================================
// (d) THE FULL COEXISTENCE PROOF — pools + smart + budget + routing.configure share
// ONE routing document and none clobbers the others, verified on physical disk.
// =============================================================================
const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "op-025-"))
  roots.push(dir)
  return dir
}

describe("Feature 025 (d) — full coexistence: pools + smart + budget + routing.configure never clobber", () => {
  test("role_pools + activation.enabled + enforcement.budget + mode all survive on disk and a fresh re-read", async () => {
    const dir = tempRoot()
    const file = path.join(dir, "config.json")
    const store = createDurableOperatorStore({ config: createFileConfigService(file), lock: createProcessMutexLockPort() })
    const { tuiPort, config } = wiredStack(store)

    // 1) pools.set establishes the project "routing" document with a role pool.
    const pv = await preflight(tuiPort, "pools.set")
    const pools = await driveMutation(tuiPort, poolsText([{ role: "architect", models: ["gpt-5"] }]), pv.currentVersion ?? undefined)
    expect(pools.result?.outcome).toBe("success")

    // 2) smart.on flips activation.enabled=true — merged over the SAME document.
    const sv = await preflight(tuiPort, "smart.on")
    const smart = await driveMutation(tuiPort, smartText("on"), sv.currentVersion ?? undefined)
    expect(smart.result?.outcome).toBe("success")

    // 3) budget.set tightens enforcement.budget — merged over the SAME document.
    const bv = await preflight(tuiPort, "budget.set")
    const budget = await driveMutation(tuiPort, budgetText(TIGHTER), bv.currentVersion ?? undefined)
    expect(budget.result?.outcome).toBe("success")

    // 4) routing.configure sets mode WITHOUT touching enabled/pools/budget —
    //    proving every writer partial-merges over the shared document.
    const rv = await preflight(tuiPort, "routing.configure")
    const routing = await driveMutation(tuiPort, configureText({ mode: "auto" }), rv.currentVersion ?? undefined)
    expect(routing.result?.outcome).toBe("success")

    // In-memory effective view: every writer's field coexists.
    const effective = await readEffective(config)
    expect(effective.models.role_pools["architect"]).toEqual(["gpt-5"]) // pools.set
    expect(effective.activation.enabled).toBe(true) // smart.on
    expect(effective.enforcement.budget.limits.max_turns).toBe(TIGHTER.maxTurns) // budget.set
    expect(effective.activation.mode).toBe("auto") // routing.configure

    // PHYSICAL proof: the shared "routing" authority on disk holds ALL FOUR contributions.
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
      operator: {
        authorities: Record<
          string,
          {
            payload: {
              activation: { enabled: boolean; mode: string }
              models: { role_pools: Record<string, string[]> }
              enforcement: { budget: { limits: { max_turns: number } } }
            }
          }
        >
      }
    }
    const doc = onDisk.operator.authorities["routing"].payload
    expect(doc.models.role_pools["architect"]).toEqual(["gpt-5"])
    expect(doc.activation.enabled).toBe(true)
    expect(doc.enforcement.budget.limits.max_turns).toBe(TIGHTER.maxTurns)
    expect(doc.activation.mode).toBe("auto")
    expect(onDisk.operator.authorities["global:routing"]).toBeUndefined()

    // FRESH load over the SAME file re-reads from disk (no stale cache) — the decisive proof.
    const store2 = createDurableOperatorStore({ config: createFileConfigService(file), lock: createProcessMutexLockPort() })
    const reread = await createConfigAdapter({ config: store2.config }).resolveEffective()
    expect(reread.config.models.role_pools["architect"]).toEqual(["gpt-5"])
    expect(reread.config.activation.enabled).toBe(true)
    expect(reread.config.enforcement.budget.limits.max_turns).toBe(TIGHTER.maxTurns)
    expect(reread.config.activation.mode).toBe("auto")
  })
})
