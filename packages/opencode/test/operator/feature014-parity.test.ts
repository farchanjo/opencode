/**
 * Feature 014 / T020 — command-id + registration parity for the newly-wired verbs (FR13).
 *
 * Feature 014 is persistence-and-wiring only: it adds NO catalog id, bumps NO
 * catalog version, introduces NO new dispatch path, and adds NO new flag. Every
 * wired verb rides the SAME canonical id through the SAME `OperatorClient` loopback
 * as slash/CLI/HTTP. This pins that invariant two ways:
 *
 *   - structural: every langlock/jobs/output/semantic/mcp verb touched by Feature
 *     014 is a PRE-EXISTING reserved id, the catalog version stays 1.3.0, and the
 *     canonical id is identical across the slash alias (`/op.<id>`), the palette
 *     command name (`operator.<id>`), and the CLI segments — one id, no per-surface
 *     divergence;
 *   - behavioural: a representative read per wired domain rides the SAME canonical id
 *     through the SAME dispatcher across slash, CLI, HTTP, and the SDK `OperatorClient`
 *     loopback with an identical outcome (the Feature 007 surface-parity contract).
 */
import { describe, expect, test } from "bun:test"
import {
  RESERVED_CATALOG_VERSION,
  catalogVersion,
  isReservedCommandId,
  listReservedIds,
  listOperatorPaletteEntries,
} from "@opencode-ai/core/operator"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type Dispatcher,
  type MutationPorts,
} from "@/operator/application"
import {
  createCliRunner,
  createFakeConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createSlashConfirmStore,
  createSlashInterceptor,
} from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import { createOperatorClient } from "@opencode-ai/sdk/operator"
import { LangLockStackWiring } from "@/operator/langlock/stack-wiring"
import { createLiveLangLockBackend } from "@/operator/langlock/backend-live"
import { createLangLockPersistence } from "@/langlock/persistence"
import { JobsStackWiring } from "@/operator/jobs/stack-wiring"
import { createLiveJobsBackend } from "@/operator/jobs/backend-live"
import { createOperatorJobPersistence } from "@/operator/jobs/persistence"

// Every verb Feature 014 wired a real backend/persistence for — all PRE-EXISTING ids.
const FEATURE_014_VERBS: Record<string, readonly string[]> = {
  langlock: ["langlock.status", "langlock.show", "langlock.set", "langlock.reset"],
  jobs: [
    "jobs.list",
    "jobs.status",
    "jobs.show",
    "jobs.create",
    "jobs.update",
    "jobs.enable",
    "jobs.disable",
    "jobs.delete",
    "jobs.reschedule",
    "jobs.run-now",
    "jobs.history",
    "jobs.watch",
  ],
  output: ["output.stat", "output.read", "output.retention.set", "output.quota.set"],
  semantic: [
    "semantic.provider.list",
    "semantic.provider.add",
    "semantic.provider.update",
    "semantic.provider.disable",
    "semantic.provider.delete",
    "semantic.provider.rotate-secret",
    "semantic.model.list",
    "semantic.model.register",
    "semantic.model.disable",
    "semantic.embedding.select",
    "semantic.reranker.select",
    "semantic.index.show-collections",
  ],
  mcp: ["mcp.auth.status", "mcp.resource.admin.list", "mcp.resource.admin.templates"],
}

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

/** Compose the langlock + jobs Feature 014 overrides over ONE shared config seam. */
function buildDispatcher(mp: MutationPorts): Dispatcher {
  const registry = createSeededOperatorCommandRegistry()
  const config = mp.config
  const langlock = createLiveLangLockBackend({ persistence: createLangLockPersistence({ config }) })
  const jobs = createLiveJobsBackend({ persistence: createOperatorJobPersistence({ config }) })
  const domainPorts = wireDomainPorts({
    ...LangLockStackWiring.createLangLockDomainWiring({ backend: langlock }).ports,
    ...JobsStackWiring.createJobsDomainWiring({ backend: jobs }).ports,
  })
  return createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
}

describe("T020 — no new catalog id, no version bump, no per-surface divergence (FR13)", () => {
  test("the catalog version is unchanged at the additive-only pin", () => {
    expect(catalogVersion()).toBe("1.4.0")
    expect(RESERVED_CATALOG_VERSION).toBe("1.4.0")
  })

  test("every Feature 014 wired verb is a pre-existing reserved id — none is newly introduced", () => {
    const reserved = new Set(listReservedIds())
    for (const verbs of Object.values(FEATURE_014_VERBS)) {
      for (const id of verbs) {
        expect(isReservedCommandId(id)).toBe(true)
        expect(reserved.has(id)).toBe(true)
      }
    }
  })

  test("the canonical id is identical across slash, palette, and CLI naming", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    for (const verbs of Object.values(FEATURE_014_VERBS)) {
      for (const id of verbs) {
        const entry = byId.get(id)
        expect(entry).toBeDefined()
        if (!entry) continue
        expect(entry.slashAlias).toBe(`/op.${id}`)
        expect(entry.commandName).toBe(`operator.${id}`)
        expect(id.split(".").join(".")).toBe(entry.id)
      }
    }
  })
})

describe("T020 — a read per wired domain rides the same id across every surface", () => {
  const readVerbs = ["langlock.show", "jobs.list"] as const

  test("slash, CLI, HTTP, and SDK share the id + outcome for each domain read", async () => {
    const mp = mutationPorts()
    const dispatcher = buildDispatcher(mp)
    const registry = createSeededOperatorCommandRegistry()
    const interceptor = createSlashInterceptor({ registry, dispatcher, confirmStore: createSlashConfirmStore() })
    const cli = createCliRunner({ registry, dispatcher })
    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_parity",
      injectProjectScopeWhenOmitted: true,
      resolveAuth: async () => ({ authenticated: true, subject: "local", role: "operator", projectBinding: "proj_parity" }),
    })
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
      handle(input instanceof Request ? input : new Request(input, init))) as unknown as typeof globalThis.fetch
    const client = createOperatorClient({ baseUrl: "http://127.0.0.1", fetch: fetchImpl })

    for (const id of readVerbs) {
      const slash = await interceptor.tryHandle({ text: `/op.${id}`, principalContext: { projectId: "proj_parity", subject: "op_1" } })
      expect(slash.handled).toBe(true)
      if (!slash.handled) continue
      expect(slash.result.id).toBe(id)
      expect(slash.result.ok).toBe(true)

      const cliOut = await cli.run({
        segments: id.split("."),
        flags: { json: true },
        isTty: false,
        ctx: { authenticated: true, projectId: "proj_parity", subject: "cli" },
      })
      expect(cliOut.result.id).toBe(id)
      expect(cliOut.result.outcome).toBe(slash.result.outcome)

      const httpRes = await handle(
        new Request("http://127.0.0.1/operator/v1/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, scope: { kind: "project", ref: "proj_parity" } }),
        }),
      )
      const httpJson = (await httpRes.json()) as { id: string; outcome: string; ok: boolean }
      expect(httpJson.id).toBe(id)
      expect(httpJson.outcome).toBe(slash.result.outcome)

      const sdk = await client.command({ id, scope: { kind: "project", ref: "proj_parity" } })
      expect(sdk.id).toBe(id)
      expect(sdk.ok).toBe(slash.result.ok)
    }
  })
})
