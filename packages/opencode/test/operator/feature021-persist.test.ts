/**
 * Feature 021 — Operator config-backed saves must persist reliably and never silently zero.
 *
 * Root cause (reproduced, ground truth): `pools.set` commits to the shared `"routing"`
 * authority (`pools/backend-live.ts:44 PROJECT_AUTHORITY`), but the degraded preflight
 * fallback `authorityKeyForCommandId` returned the command-id PREFIX `"pools"` — an
 * authority never written. The wrong (empty) authority yields `currentVersion=null`, so no
 * CAS token is threaded, and the SECOND `pools.set` (or a FIRST on a config already holding
 * a routing document) hits the correct-by-design guard `mutations require version (CAS
 * token) when authority already exists` (`mutation.ts:224-233`) and commits nothing → the
 * pool re-opens empty ("fica zerado").
 *
 * This suite proves:
 *   - FR-A: `staticAuthorityForCommandId` is the ONE domain SSOT the wired resolver AND the
 *     degraded fallback share; `authorityKeyForCommandId("pools.set") === "routing"` even
 *     with NO resolver threaded (the stale-binary / mis-wired-port path is now safe).
 *   - FR-B: every production preflight port construction threads `stack.resolveAuthority`
 *     (a wiring-invariant guard; a future port that drops it fails the assertion), and the
 *     threaded resolver is actually load-bearing in a real preflight.
 *   - FR-E: over the REAL wired stack (createTuiOperatorSlashPort, NO hand-threaded
 *     authority) — (a) a SECOND pools.set persists both bindings; (b) a FIRST pools.set on a
 *     config already holding a routing document persists (no false `mutations require
 *     version`); (c) read-back returns the bindings; (d) the routing engine actually sees
 *     role_pools; and a genuinely rejected (stale-CAS) write returns a typed failure. Plus a
 *     REAL ON-DISK proof: pools.set through the real Config.update path physically writes the
 *     bindings to a temp config.json and a FRESH load reads them back (cache-invalidation).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import {
  createFakeConfigService,
  createMemoryConfigPort,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createSlashConfirmStore,
  createSlashInterceptor,
  createTuiOperatorSlashPort,
} from "@/operator/adapters"
import { createDurableOperatorStore, createFileConfigService } from "@/operator/adapters/outbound/config-service"
import {
  domainHandlerFor,
  handlersFromDomainPorts,
  wireDomainPorts,
} from "@/operator/adapters/outbound/domain-stubs"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import {
  createOperatorAuthorityResolver,
  staticAuthorityForCommandId,
} from "@/operator/application/command-authority"
import { authorityKeyForCommandId } from "@/operator/adapters/outbound/config-status"
import { SmartStackWiring } from "@/operator/smart/stack-wiring"
import { SmartBackendLive } from "@/operator/smart/backend-live"
import { PoolsStackWiring } from "@/operator/pools/stack-wiring"
import { PoolsBackendLive } from "@/operator/pools/backend-live"
import { createConfigAdapter, DEFAULT_ROUTING_CONFIG } from "@/routing/adapters/outbound/config-adapter"
import { resolveDecisionModelPool } from "@/routing/application/routing-service"

// =============================================================================
// FR-A — one SSOT: the static fallback resolves the authority a command commits to
// =============================================================================
describe("FR-A — the degraded fallback consults the same domain SSOT as the wired resolver", () => {
  test("staticAuthorityForCommandId resolves the scope-INDEPENDENT authorities from the domain constants", () => {
    // The reproduced bug: pools.set commits to "routing", not the prefix "pools".
    expect(staticAuthorityForCommandId("pools.set")).toBe("routing")
    expect(staticAuthorityForCommandId("pools.reset")).toBe("routing")
    expect(staticAuthorityForCommandId("telemetry.configure")).toBe("global:telemetry")
    expect(staticAuthorityForCommandId("telemetry.on")).toBe("global:telemetry")
    expect(staticAuthorityForCommandId("mcp.server.add")).toBe("global:mcp")
    expect(staticAuthorityForCommandId("mcp.server.connect")).toBe("global:mcp-connections")
    expect(staticAuthorityForCommandId("mcp.auth.remove")).toBe("global:mcp-auth")
    expect(staticAuthorityForCommandId("output.delete")).toBe("global:output-admin")
    // jobs / semantic already matched their prefix — unchanged.
    expect(staticAuthorityForCommandId("jobs.create")).toBe("jobs")
    expect(staticAuthorityForCommandId("semantic.binding.status")).toBe("semantic")
  })

  test("staticAuthorityForCommandId returns null for scope-DEPENDENT and unknown/non-mutating ids (prefix fallback preserved)", () => {
    // Scope-dependent: reachable only through the wired resolveAuthority in production.
    expect(staticAuthorityForCommandId("smart.on")).toBeNull()
    expect(staticAuthorityForCommandId("budget.set")).toBeNull()
    expect(staticAuthorityForCommandId("routing.configure")).toBeNull()
    expect(staticAuthorityForCommandId("langlock.set")).toBeNull()
    expect(staticAuthorityForCommandId("output.retention.set")).toBeNull()
    expect(staticAuthorityForCommandId("output.quota.set")).toBeNull()
    // Unknown / non-mutating → null → caller keeps the prefix (no regression).
    expect(staticAuthorityForCommandId("unknown.command")).toBeNull()
    expect(staticAuthorityForCommandId("mcp.server.status")).toBeNull()
  })

  test("authorityKeyForCommandId (NO resolver threaded) resolves the static authority, else the prefix", () => {
    // The stale-binary / mis-wired-port path: the fallback is now correct by construction.
    expect(authorityKeyForCommandId("pools.set")).toBe("routing")
    expect(authorityKeyForCommandId("telemetry.configure")).toBe("global:telemetry")
    expect(authorityKeyForCommandId("mcp.server.add")).toBe("global:mcp")
    // Scope-dependent / unknown keep the prefix — never a shared global misfire.
    expect(authorityKeyForCommandId("smart.on")).toBe("smart")
    expect(authorityKeyForCommandId("budget.set")).toBe("budget")
    expect(authorityKeyForCommandId("unknown.command")).toBe("unknown")
  })

  test("the wired resolver and the fallback agree on every static authority (no drift, ONE SSOT)", () => {
    const resolver = createOperatorAuthorityResolver()
    const scope = { scopeKind: "project", scopeRef: "proj_21" }
    for (const id of ["pools.set", "telemetry.configure", "mcp.server.add", "mcp.server.connect", "mcp.auth.remove", "output.delete", "jobs.create", "semantic.binding.status"]) {
      expect(resolver(id, scope)).toBe(authorityKeyForCommandId(id))
      expect(resolver(id, scope)).toBe(staticAuthorityForCommandId(id))
    }
  })
})

// =============================================================================
// FR-B — every production preflight port construction threads stack.resolveAuthority
// =============================================================================
describe("FR-B — production wiring invariant: every preflight port threads resolveAuthority", () => {
  const root = path.resolve(import.meta.dir, "../../src/operator")
  const src = (rel: string) => readFileSync(path.join(root, rel), "utf8")
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

  test("the trusted worker fetch + the worker-local slash port both thread stack.resolveAuthority", () => {
    // createTrustedWorkerOperatorFetch (worker-adapter.ts:49) and createWorkerLocalSlashPort
    // (worker-adapter.ts:72-74). A future port that drops either fails this count.
    expect(count(src("worker-adapter.ts"), "resolveAuthority: stack.resolveAuthority")).toBe(2)
  })

  test("the HTTP mount threads stack.resolveAuthority on BOTH the production and test branches", () => {
    // http/mount.ts:88 (production) + :149 (test-stack) — both must carry it.
    expect(count(src("http/mount.ts"), "resolveAuthority: stack.resolveAuthority")).toBe(2)
  })

  test("the threaded resolver is load-bearing: a preflight actually calls it (behavioral guard)", async () => {
    const config = createMemoryConfigPort()
    const seen: string[] = []
    const spyResolver = (commandId: string) => {
      seen.push(commandId)
      return "routing"
    }
    const handler = createOperatorHttpHandler({
      dispatcher: {} as never,
      registry: createSeededOperatorCommandRegistry(),
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_21",
      injectProjectScopeWhenOmitted: true,
      config,
      resolveAuthority: spyResolver,
      resolveAuth: async () => ({ authenticated: true, subject: "op", role: "operator", projectBinding: "proj_21" }),
    })
    const res = await handler(
      new Request("http://127.0.0.1/operator/v1/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "pools.set" }),
      }),
    )
    const json = (await res.json()) as { authority: string }
    expect(seen).toContain("pools.set")
    expect(json.authority).toBe("routing")
  })
})

// =============================================================================
// FR-E — reproduced scenarios persist over the REAL wired stack (no hand-threaded authority)
// =============================================================================
const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "op-021-"))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Build the real wired stack (pools + smart over ONE shared config seam), exactly as stack-live composes. */
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
  })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  const interceptor = createSlashInterceptor({ registry, dispatcher, confirmStore: createSlashConfirmStore() })
  // The REAL production TUI port — deliberately WITHOUT resolveAuthority, so the hardened
  // fallback (FR-A) is what must resolve pools.set → "routing". This is the stale-binary path.
  const tuiPort = createTuiOperatorSlashPort(interceptor, { config: mp.config })
  return { interceptor, dispatcher, tuiPort, config: mp.config }
}

function freshStore() {
  const lock = createProcessMutexLockPort()
  return createDurableOperatorStore({ config: createFakeConfigService(), lock })
}

type TuiPort = ReturnType<typeof wiredStack>["tuiPort"]
let idem = 0

/** Drive pools.set through the REAL TUI slash port (preflight version threaded by the caller). */
async function poolsSetViaPort(port: TuiPort, bindings: unknown, version?: string) {
  const text = `/op.pools.set ${JSON.stringify({ bindings })}`
  const idempotencyKey = `idem_pools_${idem++}`
  const first = await port.tryHandle({ text, projectId: "proj_21", version, idempotencyKey })
  if (!first.handled) throw new Error("pools.set was not handled")
  if (first.needsConfirmation) {
    const confirmed = await port.tryHandle({ text, projectId: "proj_21", version, idempotencyKey, confirmToken: first.needsConfirmation.token })
    if (!confirmed.handled) throw new Error("pools.set confirm was not handled")
    return confirmed
  }
  return first
}

/** Read the pools.status effective bindings through the real slash interceptor. */
async function readBindings(interceptor: ReturnType<typeof wiredStack>["interceptor"]) {
  const r = await interceptor.tryHandle({ text: "/op.pools.status", principalContext: { projectId: "proj_21", subject: "op_1" } })
  if (!r.handled) throw new Error("pools.status not handled")
  return (r.result.effective as { bindings: { role: string; models: string[] }[] }).bindings
}

describe("FR-E — reproduced pools.set scenarios persist over the real wired stack", () => {
  test("FR-E-a/c: the preflight (NO resolver) resolves 'routing', and the SECOND pools.set persists both bindings", async () => {
    const { interceptor, tuiPort } = wiredStack(freshStore())

    // (c) the stale-binary path: with the full resolver absent, preflight resolves the REAL
    // "routing" authority via the hardened fallback — not the prefix "pools".
    const pre0 = await tuiPort.preflightMutation({ commandId: "pools.set", projectId: "proj_21" })
    expect(pre0.ok).toBe(true)
    if (!pre0.ok) return
    expect(pre0.authority).toBe("routing")
    expect(pre0.configured).toBe(false)
    expect(pre0.currentVersion).toBeNull()

    // First write (create-if-absent): commits the routing document.
    const first = await poolsSetViaPort(tuiPort, [{ role: "reviewer", models: ["gpt-5"] }])
    expect(first.handled).toBe(true)
    if (!first.handled) return
    expect(first.result?.outcome).toBe("success")

    // Preflight again — the SAME "routing" authority now carries the committed version.
    const pre1 = await tuiPort.preflightMutation({ commandId: "pools.set", projectId: "proj_21" })
    expect(pre1.ok).toBe(true)
    if (!pre1.ok) return
    expect(pre1.authority).toBe("routing")
    expect(pre1.configured).toBe(true)
    expect(pre1.currentVersion).toBe(first.result?.version ?? null)

    // (a) the SECOND pools.set threads the resolved token and PERSISTS both bindings —
    // pre-021 this failed `mutations require version` and zeroed the pool.
    const second = await poolsSetViaPort(
      tuiPort,
      [{ role: "reviewer", models: ["gpt-5"] }, { role: "worker", models: ["claude-sonnet"] }],
      pre1.currentVersion ?? undefined,
    )
    expect(second.handled).toBe(true)
    if (!second.handled) return
    expect(second.result?.outcome).toBe("success")

    // (read-back) re-opening the pool shows BOTH saved bindings — never an empty pool.
    const bindings = await readBindings(interceptor)
    const byRole = new Map(bindings.map((b) => [b.role, b.models]))
    expect(byRole.get("reviewer")).toEqual(["gpt-5"])
    expect(byRole.get("worker")).toEqual(["claude-sonnet"])
  })

  test("FR-E-b: a FIRST pools.set on a config ALREADY holding a routing document persists (no false 'mutations require version')", async () => {
    const { interceptor, config, tuiPort } = wiredStack(freshStore())

    // A prior routing write already populated the project "routing" document (the SAME
    // authority pools.set commits to). This is the reproduced trap: the authority already
    // exists, so the first pools.set MUST thread the existing CAS token, not fail the guard.
    const seed = await createConfigAdapter({ config }).set("project", DEFAULT_ROUTING_CONFIG, null)
    expect(seed.ok).toBe(true)
    if (!seed.ok) return

    // The FIRST pools.set now preflights the EXISTING routing version and threads it.
    const pre = await tuiPort.preflightMutation({ commandId: "pools.set", projectId: "proj_21" })
    expect(pre.ok).toBe(true)
    if (!pre.ok) return
    expect(pre.authority).toBe("routing")
    expect(pre.configured).toBe(true)
    expect(pre.currentVersion).toBe(seed.version)

    const set = await poolsSetViaPort(tuiPort, [{ role: "reviewer", models: ["gpt-5"] }], pre.currentVersion ?? undefined)
    expect(set.handled).toBe(true)
    if (!set.handled) return
    expect(set.result?.outcome).toBe("success")

    const bindings = await readBindings(interceptor)
    expect(bindings.some((b) => b.role === "reviewer")).toBe(true)
  })

  test("FR-E-d: the routing engine actually SEES the persisted role_pools (config-adapter → resolveDecisionModelPool)", async () => {
    const { tuiPort, config } = wiredStack(freshStore())

    // Bind the decision-model role ("architect" is the default decision_model.pool member).
    const first = await poolsSetViaPort(tuiPort, [{ role: "architect", models: ["gpt-5"] }])
    expect(first.handled).toBe(true)
    if (!first.handled) return

    // The routing engine reads its config through the SAME "routing" authority (config-adapter.ts:114).
    const effective = await createConfigAdapter({ config }).resolveEffective()
    expect(effective.config.models.role_pools["architect"]).toEqual(["gpt-5"])
    // routing-service.ts:141 flattens the decision-model pool → the routing engine now sees the model.
    expect(resolveDecisionModelPool(effective.config)).toEqual(["gpt-5"])
  })

  test("FR-C/FR-D: a genuinely rejected (stale-CAS) pools.set returns a typed failure and persists NOTHING", async () => {
    const { interceptor, tuiPort } = wiredStack(freshStore())

    // Establish the routing document.
    const first = await poolsSetViaPort(tuiPort, [{ role: "reviewer", models: ["gpt-5"] }])
    expect(first.handled).toBe(true)
    if (!first.handled) return
    const committed = first.result?.version

    // A second write threading a STALE token — the CAS guard rejects it (no auto-resolve).
    const stale = await poolsSetViaPort(tuiPort, [{ role: "worker", models: ["claude"] }], "cas_stale_token")
    expect(stale.handled).toBe(true)
    if (!stale.handled) return
    expect(stale.result?.outcome).toBe("conflict")
    expect(stale.display.variant).not.toBe("success")

    // The rejected write persisted nothing: the pool still shows ONLY the committed binding.
    const bindings = await readBindings(interceptor)
    expect(bindings.map((b) => b.role)).toEqual(["reviewer"])
    // The committed version is unchanged by the rejected write.
    const pre = await tuiPort.preflightMutation({ commandId: "pools.set", projectId: "proj_21" })
    expect(pre.ok && pre.currentVersion).toBe(committed ?? null)
  })
})

// =============================================================================
// FR-E — the decisive "salva de verdade" proof: a REAL on-disk config.json round-trip
// =============================================================================
describe("FR-E — pools.set physically persists to config.json on disk and survives a fresh load", () => {
  test("the bindings are written to the temp config.json and read back after a fresh store load (cache-invalidation honored)", async () => {
    const dir = tempRoot()
    const file = path.join(dir, "config.json")
    const lock = createProcessMutexLockPort()

    // A store over the REAL file-backed Config.Service — Config.update writes to disk.
    const store = createDurableOperatorStore({ config: createFileConfigService(file), lock })
    const { tuiPort } = wiredStack(store)

    // First write.
    const first = await poolsSetViaPort(tuiPort, [{ role: "reviewer", models: ["gpt-5"] }])
    expect(first.handled && first.result?.outcome).toBe("success")

    // Second write threads the preflighted version and persists BOTH bindings.
    const pre = await tuiPort.preflightMutation({ commandId: "pools.set", projectId: "proj_21" })
    expect(pre.ok).toBe(true)
    if (!pre.ok) return
    const second = await poolsSetViaPort(
      tuiPort,
      [{ role: "reviewer", models: ["gpt-5"] }, { role: "worker", models: ["claude-sonnet"] }],
      pre.currentVersion ?? undefined,
    )
    expect(second.handled && second.result?.outcome).toBe("success")

    // PHYSICAL proof: the bindings are actually on disk under the operator "routing" authority.
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
      operator: { authorities: Record<string, { payload: { models: { role_pools: Record<string, string[]> } } }> }
    }
    const persistedRolePools = onDisk.operator.authorities["routing"].payload.models.role_pools
    expect(persistedRolePools["reviewer"]).toEqual(["gpt-5"])
    expect(persistedRolePools["worker"]).toEqual(["claude-sonnet"])

    // FRESH load: a brand-new store over the SAME file re-reads from disk (no stale cache) and
    // the routing engine sees both persisted bindings — the decisive "salva de verdade".
    const store2 = createDurableOperatorStore({ config: createFileConfigService(file), lock: createProcessMutexLockPort() })
    const reread = await createConfigAdapter({ config: store2.config }).resolveEffective()
    expect(reread.config.models.role_pools["reviewer"]).toEqual(["gpt-5"])
    expect(reread.config.models.role_pools["worker"]).toEqual(["claude-sonnet"])
  })
})
