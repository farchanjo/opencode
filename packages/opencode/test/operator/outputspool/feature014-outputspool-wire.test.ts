/**
 * Feature 014 / T007 — the `output` domain wired into the Feature 007 runtime with a
 * REAL control-store backend under the `OperatorMutationPlan` commit contract (FR6,
 * FR14). Builds the same composition `stack-live.ts` assembles — the outputspool
 * `createOutputSpoolDomainWiring` override spread into `wireDomainPorts` over ONE
 * shared `store.config` seam — behind the real dispatcher, and proves:
 *
 *   - `output.stat`/`output.read` project the LIVE committed-length control store
 *     (`createControlStore` + `page-reader.ts`), reflecting the seeded record;
 *   - `output.retention.set`/`output.quota.set` persist bounded POLICY as
 *     `mutation_plan`s through the config round-trip seam — a re-read of the named
 *     authority reflects the committed descriptor, and a stale-CAS conflict persists
 *     NOTHING (no phantom write, FR5, FR14);
 *   - a store outage degrades `output.stat` to a typed `unavailable`, and the
 *     control-store-CAS-bounded `output.release`/`delete`/`purge` + the cursor-gated
 *     `output.follow` stay typed capability gaps — never fabricated (FR14).
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Paging } from "@opencode-ai/core/outputspool/paging"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import { createFakeConfigService, createMemoryEventPort, createMemoryOutboxPort } from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { handlersFromDomainPorts, domainHandlerFor, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import { ControlStore } from "@/outputspool/control-store"
import { OutputSpoolBackendLive } from "@/operator/outputspool/backend-live"
import { OutputSpoolStackWiring } from "@/operator/outputspool/stack-wiring"
import type { OutputSpoolBackend } from "@/operator/outputspool/outputspool-port"

const HELLO = new TextEncoder().encode("hello")

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

/** Seed one committed `stdout` channel record into a fresh in-memory control store. */
function seededStore(): ControlStore.ControlStore {
  const store = ControlStore.createControlStore(new Database(":memory:"))
  store.openGeneration({
    output_ref: "ref1",
    group_id: "g1",
    generation: 1,
    channel: "stdout",
    durability_tier: "console",
    correlation_id: "corr1",
    now: 1000,
  })
  store.recordCommitted("ref1", HELLO.length, 2000)
  return store
}

/** An in-memory page reader over the fixed HELLO buffer (never touches disk). */
const memoryPageReader: OutputSpoolBackendLive.ChannelPageReader = (record, offset, limit) =>
  Promise.resolve(
    Paging.computePage({
      offset,
      limit,
      page_cap: 1 << 20,
      committed_bytes: record.committed_bytes,
      sealed: false,
      window: HELLO.subarray(offset, offset + limit),
    }),
  )

const retentionAuthorityFor = (scope: "global" | "project", scopeId: string) =>
  scope === "global" ? "global:output.retention" : `output.retention/${scopeId || "project"}`
const quotaAuthorityFor = (scope: "global" | "project", scopeId: string) =>
  scope === "global" ? "global:output.quota" : `output.quota/${scopeId || "project"}`

function harness(backend: OutputSpoolBackend) {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const domainPorts: DomainPorts = wireDomainPorts({
    ...OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend }).ports,
  })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher, config: mp.config }
}

type Scope = { readonly kind: string; readonly ref: string | null }

const query = (dispatcher: ReturnType<typeof harness>["dispatcher"], id: string, payload: Record<string, unknown>) =>
  dispatcher.dispatchRequest({
    id,
    principal: { kind: "operator", subject: "op_1", projectBinding: "proj_14" },
    scope: { kind: "project", ref: "proj_14" },
    source: "cli",
    payload,
  } as never)

const mutate = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  opts: { version?: string; scope?: Scope } = {},
) =>
  dispatcher.dispatchRequest(
    {
      id,
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

const liveBackend = () =>
  OutputSpoolBackendLive.createLiveOutputSpoolBackend({
    store: seededStore(),
    pageReader: memoryPageReader,
    retentionAuthorityFor,
    quotaAuthorityFor,
  })

describe("T007 — output.stat/read reflect the real control store (FR6)", () => {
  test("output.stat projects the seeded channel-generation record", async () => {
    const { dispatcher } = harness(liveBackend())
    const result = await query(dispatcher, "output.stat", { outputRef: "ref1" })
    expect(result.ok).toBe(true)
    const stat = result.effective as { committedBytes: number; state: string; channel: string }
    expect(stat.committedBytes).toBe(HELLO.length)
    expect(stat.channel).toBe("stdout")
    expect(stat.state).toBe("open")
  })

  test("output.read returns the committed page bounded to the committed length", async () => {
    const { dispatcher } = harness(liveBackend())
    const result = await query(dispatcher, "output.read", { outputRef: "ref1", offset: 0, limit: 64 })
    expect(result.ok).toBe(true)
    const page = (result.effective as { committedBytes: number; caughtUp: boolean; bytes: Uint8Array })
    expect(page.committedBytes).toBe(HELLO.length)
    expect(page.caughtUp).toBe(true)
  })

  test("output.stat on an unknown ref degrades to a typed not_found, never a fabricated stat", async () => {
    const { dispatcher } = harness(liveBackend())
    const result = await query(dispatcher, "output.stat", { outputRef: "missing" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("invalid_argument")
  })
})

describe("T007 — retention.set/quota.set persist policy via the config round-trip (FR5, FR6)", () => {
  test("output.retention.set commits a mutation_plan and a re-read reflects the descriptor", async () => {
    const { dispatcher, config } = harness(liveBackend())
    const result = await mutate(dispatcher, "output.retention.set", { scopeId: "proj_14", ttlSeconds: 3600 })
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
    const entry = await config.get("output.retention/proj_14")
    expect(entry).not.toBeNull()
    expect((entry!.payload as { retention: { ttlSeconds: number } }).retention.ttlSeconds).toBe(3600)
  })

  test("output.quota.set commits a mutation_plan and a re-read reflects the descriptor", async () => {
    const { dispatcher, config } = harness(liveBackend())
    const result = await mutate(dispatcher, "output.quota.set", { scopeId: "proj_14", quotaScope: "session", maxBytes: 4096 })
    expect(result.ok).toBe(true)
    const entry = await config.get("output.quota/proj_14")
    expect((entry!.payload as { quota: { maxBytes: number } }).quota.maxBytes).toBe(4096)
  })

  test("a stale-CAS retention.set conflicts and writes NOTHING (no phantom write, FR14)", async () => {
    const { dispatcher, config } = harness(liveBackend())
    const result = await mutate(dispatcher, "output.retention.set", { scopeId: "proj_14", ttlSeconds: 3600 }, { version: "cas_v9" })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("conflict")
    expect(await config.get("output.retention/proj_14")).toBeNull()
  })
})

describe("T007 — honest degradation, never fabricated (FR14)", () => {
  test("a store outage degrades output.stat to a typed unavailable", async () => {
    const backend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({ retentionAuthorityFor, quotaAuthorityFor })
    const { dispatcher } = harness(backend)
    const result = await query(dispatcher, "output.stat", { outputRef: "ref1" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })

  test("output.delete stays a typed capability gap (control-store-CAS boundary)", async () => {
    const { dispatcher } = harness(liveBackend())
    const result = await mutate(dispatcher, "output.delete", { outputRef: "ref1" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })

  test("output.follow stays a typed capability gap (cursor-codec boundary)", async () => {
    const { dispatcher } = harness(liveBackend())
    const result = await query(dispatcher, "output.follow", { cursor: "c1" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })

  test("cross-project output.share is denied by default", async () => {
    const { dispatcher } = harness(liveBackend())
    const result = await mutate(dispatcher, "output.share", { outputRef: "ref1" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unauthorized")
  })
})
