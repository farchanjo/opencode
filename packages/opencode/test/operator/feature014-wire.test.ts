/**
 * Feature 014 / T005–T006 — the `langlock` and `jobs` domains wired into the Feature
 * 007 runtime under the `OperatorMutationPlan` commit contract (FR5, FR14). Builds the
 * same composition `stack-live.ts` assembles — the two `create*DomainWiring` overrides
 * spread into `wireDomainPorts` over ONE shared `store.config` seam — behind the real
 * dispatcher + slash interceptor, and proves:
 *
 *   - a `langlock.set` / `langlock.reset` mutation dispatched through the FULL pipeline
 *     (dispatchRequest → confirm → contract → handler plan → `mutateAuthority`) returns
 *     `outcome:"success"` and a re-read reflects the committed policy — the config
 *     round-trips through the same seam the reads use;
 *   - the langlock backend NEVER self-commits: a stale-CAS conflict and a fail-closed
 *     project-override denial each persist NOTHING (no phantom write) while the caller
 *     is honestly told it failed (FR5, FR14, Security 1);
 *   - the `jobs` mutating verbs ride the same `mutation_plan` path and honestly degrade
 *     to a typed capability gap (`not_implemented`/`unavailable`) with no phantom write —
 *     the durable-persistence transform is Feature 014 T010, the executor edge T011.
 *
 * Dispatch boundary: each mutating verb returns a validated `mutation_plan`, so the
 * Feature 007 `mutateAuthority` pipeline owns the single committed CAS write and emits
 * the audit correlation — the backend never self-commits (self-committing previously
 * made a `mutates` verb persist a write while the dispatcher rejected the `query` shape).
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
import { handlersFromDomainPorts, domainHandlerFor, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import { LangLockStackWiring } from "@/operator/langlock/stack-wiring"
import { createLiveLangLockBackend } from "@/operator/langlock/backend-live"
import { createLangLockPersistence } from "@/langlock/persistence"
import { JobsStackWiring } from "@/operator/jobs/stack-wiring"
import { createLiveJobsBackend } from "@/operator/jobs/backend-live"
import { createOperatorJobPersistence } from "@/operator/jobs/persistence"
import type { LangLockAuthorization } from "@/langlock/authorization"

const GRANT_ALL: LangLockAuthorization.OverridePermissionPort = { overrideGranted: () => true }

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

/** Compose the two Feature 014 domain overrides exactly as `stack-live.ts` does. */
function wireFeature014(mp: MutationPorts, permission?: LangLockAuthorization.OverridePermissionPort): DomainPorts {
  const config = mp.config
  const langlock = createLiveLangLockBackend({ persistence: createLangLockPersistence({ config }), permission })
  const jobs = createLiveJobsBackend({ persistence: createOperatorJobPersistence({ config }) })
  return wireDomainPorts({
    ...LangLockStackWiring.createLangLockDomainWiring({ backend: langlock }).ports,
    ...JobsStackWiring.createJobsDomainWiring({ backend: jobs }).ports,
  })
}

function harness(permission?: LangLockAuthorization.OverridePermissionPort) {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const domainPorts = wireFeature014(mp, permission)
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  const interceptor = createSlashInterceptor({ registry, dispatcher, confirmStore: createSlashConfirmStore() })
  return { interceptor, dispatcher, config: mp.config }
}

const read = async (interceptor: ReturnType<typeof harness>["interceptor"], id: string) => {
  const r = await interceptor.tryHandle({ text: `/op.${id}`, principalContext: { projectId: "proj_14", subject: "op_1" } })
  if (!r.handled) throw new Error(`unhandled ${id}`)
  return r.result
}

type Scope = { readonly kind: string; readonly ref: string | null }

/** Dispatch a mutating verb through the FULL Feature 007 pipeline. */
const mutate = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  opts: { version?: string; scope?: Scope } = {},
) =>
  dispatcher.dispatchRequest(
    {
      id,
      // A project-bound principal may not target global scope, so bind to the project
      // only when the request scope is a project (the operator CLI resolves this too).
      principal: {
        kind: "operator",
        subject: "op_1",
        projectBinding: (opts.scope ?? { kind: "project", ref: "proj_14" }).kind === "global" ? null : "proj_14",
      },
      scope: opts.scope ?? { kind: "project", ref: "proj_14" },
      source: "cli",
      payload,
      version: opts.version,
      idempotencyKey: `idem_${id}_${opts.version ?? "create"}_${Math.random().toString(36).slice(2)}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

const GLOBAL: Scope = { kind: "global", ref: null }

describe("T005 — langlock.set/reset commit end-to-end through mutateAuthority (FR5)", () => {
  test("a global langlock.set commits and a re-read reflects the committed tag", async () => {
    const { interceptor, dispatcher } = harness()
    const before = (await read(interceptor, "langlock.show")).effective as { tag: string }
    expect(before.tag).toBe("en-US")

    const set = await mutate(dispatcher, "langlock.set", { tag: "pt-BR", scope: "global" }, { scope: GLOBAL })
    expect(set.ok).toBe(true)
    expect(set.outcome).toBe("success")

    const after = (await read(interceptor, "langlock.show")).effective as { tag: string }
    expect(after.tag).toBe("pt-BR")
  })

  test("a committed langlock.reset reverts the global tag to en-US under CAS", async () => {
    const { interceptor, dispatcher } = harness()
    const set = await mutate(dispatcher, "langlock.set", { tag: "pt-BR", scope: "global" }, { scope: GLOBAL })
    expect(set.ok).toBe(true)
    const reset = await mutate(dispatcher, "langlock.reset", { scope: "global" }, { scope: GLOBAL, version: set.version })
    expect(reset.ok).toBe(true)
    expect(reset.outcome).toBe("success")
    const after = (await read(interceptor, "langlock.show")).effective as { tag: string }
    expect(after.tag).toBe("en-US")
  })

  test("a project override commits when the langlock.override grant is present", async () => {
    const { interceptor, dispatcher } = harness(GRANT_ALL)
    const set = await mutate(dispatcher, "langlock.set", { tag: "pt-BR" }, {})
    expect(set.ok).toBe(true)
    const after = (await read(interceptor, "langlock.show")).effective as { tag: string; origin: string }
    expect(after.tag).toBe("pt-BR")
    expect(after.origin).toBe("project")
  })
})

describe("T005 — no self-commit: a rejected langlock mutation persists NOTHING (FR5, FR14)", () => {
  test("a stale-CAS langlock.set on an absent authority conflicts and writes nothing", async () => {
    const { interceptor, dispatcher, config } = harness()
    const result = await mutate(dispatcher, "langlock.set", { tag: "pt-BR", scope: "global" }, { scope: GLOBAL, version: "cas_v9" })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("conflict")
    expect(await config.get("langlock/global")).toBeNull()
    const after = (await read(interceptor, "langlock.show")).effective as { tag: string }
    expect(after.tag).toBe("en-US")
  })

  test("a fail-closed project override is denied at plan time with no phantom write (Security 1)", async () => {
    const { dispatcher, config } = harness() // no override grant → DENY
    const result = await mutate(dispatcher, "langlock.set", { tag: "pt-BR" }, {})
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unauthorized")
    expect(await config.get("langlock/project/proj_14")).toBeNull()
  })
})

const CREATE_PAYLOAD = {
  name: "nightly",
  schedule: { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
  actionType: "native_maintenance",
  payloadRef: "secretref_keychain_1",
}

/** Extract the created definition id from a committed jobs.create envelope payload. */
const idOf = (result: { effective?: unknown }): string => {
  const doc = result.effective as { definitions?: Record<string, unknown> }
  return Object.keys(doc.definitions ?? {})[0] ?? ""
}

type JobRow = { readonly name: string; readonly enabled: boolean; readonly jobDefinitionId: string }
const rows = async (interceptor: ReturnType<typeof harness>["interceptor"]): Promise<readonly JobRow[]> =>
  ((await read(interceptor, "jobs.list")).effective as { definitions: JobRow[] }).definitions

describe("T010 — jobs mutations persist over the config seam and round-trip (FR9, FR14)", () => {
  test("jobs.create commits through mutateAuthority and a re-read reflects the persisted definition", async () => {
    const { interceptor, dispatcher } = harness()
    const created = await mutate(dispatcher, "jobs.create", CREATE_PAYLOAD)
    expect(created.ok).toBe(true)
    expect(created.outcome).toBe("success")
    const list = await rows(interceptor)
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe("nightly")
    expect(list[0]!.enabled).toBe(true)
  })

  test("a committed jobs.disable round-trips under CAS and the re-read shows enabled:false", async () => {
    const { interceptor, dispatcher } = harness()
    const created = await mutate(dispatcher, "jobs.create", CREATE_PAYLOAD)
    const disabled = await mutate(dispatcher, "jobs.disable", { jobDefinitionId: idOf(created) }, { version: created.version })
    expect(disabled.ok).toBe(true)
    expect(disabled.outcome).toBe("success")
    expect((await rows(interceptor))[0]!.enabled).toBe(false)
  })

  test("jobs.enable on an absent definition is a typed not_found with no phantom write", async () => {
    const { interceptor, dispatcher } = harness()
    const result = await mutate(dispatcher, "jobs.enable", { jobDefinitionId: "job_absent", expectedVersion: 1 })
    expect(result.ok).toBe(false)
    expect(await rows(interceptor)).toHaveLength(0)
  })

  test("a stale-CAS jobs.create conflicts and writes nothing (no phantom write, FR14)", async () => {
    const { interceptor, dispatcher } = harness()
    await mutate(dispatcher, "jobs.create", CREATE_PAYLOAD)
    const stale = await mutate(dispatcher, "jobs.create", { ...CREATE_PAYLOAD, name: "second" }, { version: "cas_v9" })
    expect(stale.ok).toBe(false)
    expect(stale.outcome).toBe("conflict")
    expect((await rows(interceptor)).map((d) => d.name)).toEqual(["nightly"])
  })

  test("jobs.run-now stays a typed unavailable capability gap (T011)", async () => {
    const { dispatcher } = harness()
    const created = await mutate(dispatcher, "jobs.create", CREATE_PAYLOAD)
    const result = await mutate(dispatcher, "jobs.run-now", { jobDefinitionId: idOf(created) })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})
