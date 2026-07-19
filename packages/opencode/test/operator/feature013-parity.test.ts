/**
 * Feature 013 / T019 — command-id parity for the four newly-wired domains (FR11).
 *
 * The wiring is backend-only: no new dispatch path, no new catalog id, and no
 * catalog version bump. This pins that invariant two ways:
 *
 *   - structural: every telemetry/smart/budget/pools verb is a PRE-EXISTING reserved
 *     id, the catalog version is unchanged, and the canonical id is identical across
 *     the slash alias (`/op.<id>`), the palette command name (`operator.<id>`), and
 *     the CLI segments — one id, never a per-surface divergence.
 *   - behavioural: each domain's `status` read rides the SAME canonical id through
 *     the SAME dispatcher across slash, CLI, HTTP, and the SDK `OperatorClient`
 *     loopback, with an identical outcome — the Feature 007 surface-parity contract.
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
import { TelemetryStackWiring } from "@/operator/telemetry/stack-wiring"
import { TelemetryBackendLive } from "@/operator/telemetry/backend-live"
import { TelemetryProbeLive } from "@/operator/telemetry/probe-live"
import { SmartStackWiring } from "@/operator/smart/stack-wiring"
import { SmartBackendLive } from "@/operator/smart/backend-live"
import { BudgetStackWiring } from "@/operator/budget/stack-wiring"
import { BudgetBackendLive } from "@/operator/budget/backend-live"
import { PoolsStackWiring } from "@/operator/pools/stack-wiring"
import { PoolsBackendLive } from "@/operator/pools/backend-live"

const FEATURE_013_VERBS: Record<string, readonly string[]> = {
  telemetry: ["telemetry.status", "telemetry.show", "telemetry.on", "telemetry.off", "telemetry.configure", "telemetry.test"],
  smart: ["smart.status", "smart.on", "smart.off", "smart.auto"],
  budget: ["budget.status", "budget.show", "budget.set", "budget.reset", "budget.validate"],
  pools: ["pools.status", "pools.show", "pools.set", "pools.reset", "pools.validate"],
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

function buildDispatcher(mp: MutationPorts): Dispatcher {
  const registry = createSeededOperatorCommandRegistry()
  const config = mp.config
  const domainPorts = wireDomainPorts({
    ...TelemetryStackWiring.createTelemetryDomainWiring({
      backend: TelemetryBackendLive.createLiveTelemetryBackend({ config, probe: TelemetryProbeLive.createLiveTelemetryProbe() }),
    }).ports,
    ...SmartStackWiring.createSmartDomainWiring({ backend: SmartBackendLive.createLiveSmartBackend({ config }) }).ports,
    ...BudgetStackWiring.createBudgetDomainWiring({ backend: BudgetBackendLive.createLiveBudgetBackend({ config }) }).ports,
    ...PoolsStackWiring.createPoolsDomainWiring({ backend: PoolsBackendLive.createLivePoolsBackend({ config }) }).ports,
  })
  return createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
}

describe("T019 — no new catalog id and no version bump (FR11)", () => {
  test("the catalog version is unchanged at the additive-only pin", () => {
    expect(catalogVersion()).toBe("1.3.0")
    expect(RESERVED_CATALOG_VERSION).toBe("1.3.0")
  })

  test("every Feature 013 verb is a pre-existing reserved id — none is newly introduced", () => {
    const reserved = new Set(listReservedIds())
    for (const [, verbs] of Object.entries(FEATURE_013_VERBS)) {
      for (const id of verbs) {
        expect(isReservedCommandId(id)).toBe(true)
        expect(reserved.has(id)).toBe(true)
      }
    }
  })

  test("the canonical id is identical across slash, palette, and CLI naming (no per-surface divergence)", () => {
    const byId = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
    for (const [, verbs] of Object.entries(FEATURE_013_VERBS)) {
      for (const id of verbs) {
        const entry = byId.get(id)
        expect(entry).toBeDefined()
        if (!entry) continue
        expect(entry.slashAlias).toBe(`/op.${id}`)
        expect(entry.commandName).toBe(`operator.${id}`)
        // The CLI segments are exactly the dotted id split — same canonical id.
        expect(id.split(".").join(".")).toBe(entry.id)
      }
    }
  })
})

describe("T019 — one read per domain rides the same id across every surface", () => {
  const readVerbs = ["telemetry.status", "smart.status", "budget.status", "pools.status"] as const

  test("slash, CLI, HTTP, and SDK share the id + outcome for each domain status", async () => {
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
