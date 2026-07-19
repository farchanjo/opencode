/**
 * LIVE operator stack — real Config.Service + Flock + EventV2 (production/worker).
 * No createFakeConfigService.
 * T041: feature flag re-evaluated per dispatch from Config (no stale cache).
 * T044: connectivity re-evaluated per dispatch.
 * T045: production DNS resolver injected for SSRF.
 * T046: live OTEL recorder (process tracer when available).
 */
import path from "path"
import { mkdir } from "fs/promises"
import { Database as BunDatabase } from "bun:sqlite"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import {
  createProductionDnsResolver,
  readOfflineFromConfig,
  readOperatorControlPlaneFromConfig,
  resolveConnectivity,
  resolveOperatorControlPlaneFlag,
  type DnsResolver,
} from "@opencode-ai/core/operator"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { InstanceRuntime } from "@/project/instance-runtime"
import { createLiveConfigServiceLike } from "./adapters/outbound/config-live"
import { createLiveEventV2AuditPortFromUse } from "./adapters/outbound/event-v2-live"
import { createDomainStubs, domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "./adapters/outbound/domain-stubs"
import { createRoutingService } from "@/routing/application/routing-service"
import { createRoutingDomainPort } from "@/routing/adapters/inbound/routing-command-port"
import { createConfigAdapter, toRoutingConfigSource } from "@/routing/adapters/outbound/config-adapter"
import {
  createCandidateSource,
  createCatalogAdapter,
  type AgentResolver,
  type CatalogCandidateService,
} from "@/routing/adapters/outbound/catalog-adapter"
import { createDomainDecisionStore } from "@/routing/application/decision-store"
import { createFsDecisionStorePort } from "@/routing/adapters/outbound/decision-store-fs"
import { createTaskAnalyzer } from "@/routing/application/task-analyzer"
import { createOtlpAdapter, createRoutingDecisionTelemetry } from "@/routing/adapters/outbound/otlp-adapter"
import { resolveEffectiveTelemetryConfig } from "@/routing/application/telemetry-service"
import { createLiveOperatorOtelRecorder } from "./adapters/outbound/otel-live"
import { LifecycleStackWiring } from "./lifecycle/stack-wiring"
import { JobsStackWiring } from "./jobs/stack-wiring"
import { JobsBackendLive } from "./jobs/backend-live"
import { OperatorJobPersistence } from "./jobs/persistence"
import { LangLockStackWiring } from "./langlock/stack-wiring"
import { LangLockBackendLive } from "./langlock/backend-live"
import { LangLockPersistence } from "@/langlock/persistence"
import { OutputSpoolStackWiring } from "./outputspool/stack-wiring"
import { OutputSpoolBackendLive } from "./outputspool/backend-live"
import { ControlStore } from "@/outputspool/control-store"
import { SemanticStackWiring } from "./semantic/stack-wiring"
import { SemanticBackendLive } from "./semantic/backend-live"
import { McpStackWiring } from "./mcp/stack-wiring"
import { McpBackendLive } from "./mcp/backend-live"
import { TelemetryStackWiring } from "./telemetry/stack-wiring"
import { TelemetryBackendLive } from "./telemetry/backend-live"
import { TelemetryProbeLive } from "./telemetry/probe-live"
import { SmartStackWiring } from "./smart/stack-wiring"
import { SmartBackendLive } from "./smart/backend-live"
import { BudgetStackWiring } from "./budget/stack-wiring"
import { BudgetBackendLive } from "./budget/backend-live"
import { PoolsStackWiring } from "./pools/stack-wiring"
import { PoolsBackendLive } from "./pools/backend-live"
import { createDispatcher, type Dispatcher } from "./application/dispatcher"
import type { MutationPorts } from "./application/mutation"
import { createFlockLockPort } from "./application/ports/lock-port"
import { createSeededOperatorCommandRegistry, type OperatorCommandRegistry } from "./application/registry"
import { createDurableOperatorStore } from "./adapters/outbound/config-service"
import { startOperatorAuditMaintenance, type AuditMaintenanceHandle } from "./application/audit-reconcile"
import { createDarwinNativeKeychainBackend } from "./adapters/outbound/keychain-darwin"
import { createKeychainSecretPort, createEnvRefSecretPort, createCompositeSecretPort } from "./adapters/outbound/secret-memory"
import { createSlashInterceptor, type SlashInterceptor } from "./adapters/inbound/slash"
import { createSlashConfirmStore } from "./adapters/inbound/slash-confirm"
import type { SecretPort } from "./application/ports/secret-port"
import type { OperatorSpanRecorder } from "@opencode-ai/core/operator"
import type { ConfigServiceLike } from "./adapters/outbound/config-service"

export type LiveOperatorStack = {
  readonly kind: "live"
  readonly directory: string
  readonly registry: OperatorCommandRegistry
  readonly dispatcher: Dispatcher
  readonly mutationPorts: MutationPorts
  readonly interceptor: SlashInterceptor
  readonly secrets: SecretPort
  /** True when composition forced unavailable keychain (OPENCODE_DEV_OPERATOR_=1). */
  readonly sandboxKeychain: boolean
  /** Snapshot at create time only — prefer resolveFeatureEnabled() for current. */
  readonly featureEnabled: boolean
  readonly connectivity: "online" | "offline"
  readonly otel: OperatorSpanRecorder
  readonly config: ConfigServiceLike
  /** Fresh flag from Config+env (same-process enable/disable). */
  readonly resolveFeatureEnabled: () => Promise<boolean>
  readonly resolveConnectivity: () => Promise<"online" | "offline">
  readonly dispose: () => void
}

export type CreateLiveOperatorStackInput = {
  /** Project directory — loads Instance for Config.Service scope. */
  readonly directory: string
  readonly projectKey?: string
  readonly nowMs?: () => number
  /** When true (sandbox worker tests), keychain unavailable. Default false for live. */
  readonly sandboxKeychain?: boolean
  /** Injected DNS resolver for SSRF (tests). Default: production node:dns lookup. */
  readonly dnsResolver?: DnsResolver
}

const liveByDirectory = new Map<string, Promise<LiveOperatorStack>>()

/**
 * Create or reuse live stack for a project directory.
 * Uses AppRuntime Config.Service + EventV2Bridge + Flock under Global.Path.state.
 * Flag/connectivity are NOT frozen — dispatcher re-reads Config each dispatch.
 */
export function getOrCreateLiveOperatorStack(input: CreateLiveOperatorStackInput): Promise<LiveOperatorStack> {
  const key = path.resolve(input.directory)
  const existing = liveByDirectory.get(key)
  if (existing) return existing
  const created = createLiveOperatorStack(input).catch((error) => {
    liveByDirectory.delete(key)
    throw error
  })
  liveByDirectory.set(key, created)
  return created
}

export async function createLiveOperatorStack(input: CreateLiveOperatorStackInput): Promise<LiveOperatorStack> {
  // Capture the loaded InstanceContext so the config seam below can bind it onto
  // every AppRuntime.runPromise. Without it, Config.get/update (InstanceState-backed,
  // project-scoped authorities: routing/langlock/idempotency) run on a runtime fiber
  // with no InstanceRef and Effect.die("InstanceRef not provided") — which escapes a
  // Promise-boundary caller (CLI `op`) as a hard crash. getGlobal has no InstanceState
  // dependency, so global:* reads survived while any mutation (idempotency claim →
  // project Config.get) died. Binding InstanceRef here makes CLI mutations really
  // persist (bug fix, Feature 013 residual).
  const instance = await InstanceRuntime.load({ directory: input.directory })

  const lockDir = path.join(Global.Path.state, "operator-locks")
  await mkdir(lockDir, { recursive: true })

  const config = createLiveConfigServiceLike({
    useConfig: (fn) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* Config.Service
          return yield* fn({
            get: () => svc.get() as Effect.Effect<Record<string, unknown>>,
            getGlobal: () => svc.getGlobal() as Effect.Effect<Record<string, unknown>>,
            update: (patch) => svc.update(patch as never),
            updateGlobal: (patch) => svc.updateGlobal(patch as never),
          })
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  })

  async function resolveFeatureEnabled(): Promise<boolean> {
    let configEnabled: boolean | undefined
    try {
      const cfg = await config.get()
      configEnabled = readOperatorControlPlaneFromConfig(cfg)
    } catch {
      configEnabled = undefined
    }
    return resolveOperatorControlPlaneFlag({ configEnabled }).enabled
  }

  async function resolveConnectivityLive(): Promise<"online" | "offline"> {
    let configOffline: boolean | undefined
    try {
      const cfg = await config.get()
      configOffline = readOfflineFromConfig(cfg)
    } catch {
      configOffline = undefined
    }
    return resolveConnectivity({ configOffline })
  }

  const featureEnabled = await resolveFeatureEnabled()
  const connectivity = await resolveConnectivityLive()

  const events = createLiveEventV2AuditPortFromUse({
    projectKey: input.projectKey ?? "project",
    useEvents: (fn) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* EventV2Bridge.Service
          return yield* fn({
            publish: (definition, data, options) =>
              svc.publish(definition as never, data as never, {
                id: options?.id as never,
              }).pipe(
                Effect.map((payload) => ({
                  id: payload.id,
                  type: String(payload.type),
                  data: payload.data as unknown,
                })),
              ),
            readDurablePage: (q) =>
              svc.readDurablePage(q).pipe(
                Effect.map((page) => ({
                  events: page.events.map((payload) => ({
                    id: payload.id,
                    type: String(payload.type),
                    data: payload.data as unknown,
                    durable: payload.durable
                      ? { seq: payload.durable.seq }
                      : undefined,
                  })),
                  hasMore: page.hasMore,
                  lastSeq: page.lastSeq,
                })),
              ),
            pruneDurable: (q) => svc.pruneDurable(q),
          })
        }),
      ),
  })

  const lock = await createFlockLockPort({ dir: lockDir })
  const store = createDurableOperatorStore({
    config,
    lock,
    projectKey: input.projectKey ?? "project",
  })

  const sandboxKeychain = input.sandboxKeychain ?? false
  // T019: sandbox → unavailable (zero FFI ops). Non-sandbox darwin → native FFI.
  // Non-darwin → unavailable. Durable version metadata via Config under Flock.
  const keychainBackend = createDarwinNativeKeychainBackend({
    sandbox: sandboxKeychain,
    // Live may load real FFI; tests inject stack with sandboxKeychain=true
  })
  const secrets = createCompositeSecretPort({
    keychain: createKeychainSecretPort({
      backend: keychainBackend,
      sandbox: sandboxKeychain,
      // Production: durable metadata under same Config+Flock document
      config: store.config,
      projectKey: input.projectKey ?? "project",
    }),
    envRef: createEnvRefSecretPort(),
  })

  // T024: durable audit outbox from store (same document/Flock as CAS)
  const outbox = store.outbox

  const mutationPorts: MutationPorts = {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events,
    requireAudit: true,
    outbox,
    nowMs: input.nowMs,
  }

  // H4: startup + unref periodic maintenance (reconcile cadence + daily prune),
  // cross-process Flock single-run, dispose clears timer.
  const maintenance: AuditMaintenanceHandle = startOperatorAuditMaintenance({
    outbox,
    events,
    lock,
    projectKey: input.projectKey ?? "project",
    nowMs: input.nowMs,
  })

  const otel = createLiveOperatorOtelRecorder()
  const registry = createSeededOperatorCommandRegistry()
  const dnsResolver = input.dnsResolver ?? createProductionDnsResolver()

  // === Feature 001 — routing domain port composition ========================
  // Real dependencies, resolved through the same AppRuntime services the rest
  // of the live stack uses. The routing domain stays framework-free behind
  // these outbound seams; only the DomainInvoke override is registered here —
  // Feature 007 remains the sole command-registration authority (the adapter
  // replaces the not_implemented stub, it adds no ids).
  const routingConfigSource = toRoutingConfigSource(createConfigAdapter({ config: store.config }))

  // Catalog seam: the live provider catalog (Provider.Service) is the sole
  // model source — never a hardcoded model id. Health/status classification is
  // owned by createCatalogAdapter.
  const catalogCandidates: CatalogCandidateService = {
    listModels: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          return Object.values(providers).flatMap((p) =>
            Object.values(p.models).map((m) => ({
              modelId: m.id,
              providerId: m.providerID,
              status: m.status,
              // A model present in the live provider catalog is enabled; the
              // adapter demotes deprecated ones separately.
              enabled: true,
              tools: m.capabilities.toolcall,
            })),
          )
        }),
      ),
  }

  // Agent seam: the canonical, config-composed specialist registry (AgentV2,
  // T031). resolveSpecialist gates hidden internal agents out; listSpecialists
  // is that same filter over the whole pool. Routing never fabricates agent
  // identity. Skill/effort metadata is not yet carried on Agent.Info, so the
  // pool exposes empty skills + neutral effort defaults — hard gates + ranking
  // still apply; documented in data-model.md.
  const agentResolver: AgentResolver = {
    resolveAgents: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const specialists = yield* agent.listSpecialists()
          return specialists.map((a) => ({
            agentId: a.name,
            skills: [] as ReadonlyArray<string>,
            effort: "medium" as const,
            reasoningEffort: "medium" as const,
          }))
        }),
      ),
  }

  const candidateSource = createCandidateSource({
    catalog: createCatalogAdapter({ catalog: catalogCandidates }),
    agents: agentResolver,
  })

  const decisionsBaseDir = path.join(Global.Path.state, "routing-decisions")
  await mkdir(decisionsBaseDir, { recursive: true })
  const decisionStore = createDomainDecisionStore(createFsDecisionStorePort(), decisionsBaseDir)

  // Telemetry sink: routing decisions feed the bounded OTLP export queue built
  // from the effective telemetry config (disabled by default → signal-gated
  // no-op). No network transport is wired here (the process-wide Flag-driven
  // OTLP Layers own real export); the sink stays offline-safe.
  const telemetryConfig = await resolveEffectiveTelemetryConfig(store.config)
  const routingTelemetry = createRoutingDecisionTelemetry(
    createOtlpAdapter({ config: telemetryConfig, secret: secrets }),
  )

  const routingService = createRoutingService({
    config: routingConfigSource,
    candidates: candidateSource,
    analyzer: createTaskAnalyzer(),
    decisions: decisionStore,
    telemetry: routingTelemetry,
  })

  // === Feature 002 — lifecycle domain port composition ======================
  // Real seams over the single EventV2 authority: a live runtime ProcessTable
  // fed by a bounded EventBus.subscribeBounded subscription + EventV2 durable
  // read/prune, the real AdmissionController and shared Watchdog cadence, native
  // root cancel over the canonical Session.Service.interrupt seam (C17), handoff
  // over the emit seam (C16), and observation over the live subscription (C14).
  // Feature 007 stays the sole command-registration authority — these overrides
  // replace the not_implemented process/task stubs and add no ids.
  const lifecycleWiring = await LifecycleStackWiring.createLifecycleDomainWiring()

  // === Feature 003 — jobs domain port composition ===========================
  // The typed `jobs.*` operator port over the real Config.Service durable
  // persistence (T022), reusing the same ConfigPort the rest of the live stack
  // binds. Reads (list/status) are honestly backed; the occurrence-history,
  // observation, create-input assembler, and Feature 002 executor seams are not
  // reachable from the operator AppRuntime, so those methods return the port's
  // typed capability gap rather than fabricated data (see backend-live.ts and the
  // Feature 003 tasks.md Residuals note). Feature 007 stays the sole
  // command-registration authority — this override replaces the not_implemented
  // stub and adds no ids.
  const jobsBackend = JobsBackendLive.createLiveJobsBackend({
    persistence: OperatorJobPersistence.createOperatorJobPersistence({ config: store.config }),
  })
  const jobsWiring = JobsStackWiring.createJobsDomainWiring({ backend: jobsBackend })

  // === Feature 004 — langlock domain port composition =======================
  // The typed `langlock.*` operator port over the real Config.Service durable
  // persistence (T025), reusing the same ConfigPort the rest of the live stack
  // binds. Lang Lock policy is a simple content-free document, so resolve/set/
  // reset are honestly backed (no external assembler). The `langlock.override`
  // gate defaults to fail-closed DENY until a real Feature 007 Permission/Policy
  // gate is bound (Security 1). Feature 007 stays the sole command-registration
  // authority — this override replaces the not_implemented stub and adds no ids
  // (the reserved langlock.* ids already live in the catalog).
  const langLockBackend = LangLockBackendLive.createLiveLangLockBackend({
    persistence: LangLockPersistence.createLangLockPersistence({ config: store.config }),
  })
  const langLockWiring = LangLockStackWiring.createLangLockDomainWiring({ backend: langLockBackend })

  // === Feature 005 / 014 — outputspool domain port composition (FR6) ========
  // The typed `output.*` operator port over the Feature 005 application adapters,
  // now backed by the real control store. `stat`/`read` project the live
  // committed-length authority through `createControlStore` + `page-reader.ts`;
  // `retention.set`/`quota.set` persist bounded POLICY as `mutation_plan`s through
  // the config round-trip seam. The AppLayer `Database` is an EffectDrizzle client
  // (incompatible with the `bun:sqlite` `createControlStore` surface), so the
  // operator binds the outputspool subsystem's own control-store database under the
  // managed data root; a failure to open it degrades every read to a typed
  // `unavailable` (FR14) — never a crash. `follow` + `release`/`delete`/`purge` stay
  // typed capability gaps (cursor-codec / control-store-CAS boundaries, FR14).
  // Feature 007 stays the sole command-registration authority — this override
  // replaces the not_implemented stub and adds no ids (the reserved output.* ids
  // already live in the catalog at 1.3.0).
  const spoolRoot = path.join(Global.Path.data, "outputspool")
  let outputControlStore: ReturnType<typeof ControlStore.createControlStore> | undefined
  try {
    await mkdir(spoolRoot, { recursive: true })
    outputControlStore = ControlStore.createControlStore(new BunDatabase(path.join(spoolRoot, "operator-control.db")))
  } catch {
    outputControlStore = undefined
  }
  const outputSpoolBackend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({
    store: outputControlStore,
    spoolRoot,
    retentionAuthorityFor: (scope, scopeId) =>
      scope === "global" ? "global:output.retention" : `output.retention/${scopeId || "project"}`,
    quotaAuthorityFor: (scope, scopeId) =>
      scope === "global" ? "global:output.quota" : `output.quota/${scopeId || "project"}`,
  })
  const outputSpoolWiring = OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend: outputSpoolBackend })

  // === Feature 006 / 014 — semantic domain port composition =================
  // The typed 30 `semantic.*` operator ports. Feature 014 (T009) wires the
  // config-backed HALF of the registry — provider/model/binding reads + CAS
  // round-trip plans — over the SAME `store.config` seam the other config
  // domains use, so `provider.add`/`model.register`/`embedding.select` persist and
  // re-read under CAS (FR8). The Milvus/provider-probe HALF (`provider.test`,
  // `model.discover`/`validate`, `embedding`/`reranker` `validate`/`reindex`/
  // `cutover`/`rollback`, every `index.*`) stays the typed capability gap
  // (`unavailable`/`milvus_unavailable`) — never fabricated (FR8, FR14). Feature
  // 007 stays the sole command-registration authority — this override replaces the
  // not_implemented stub and adds no ids (the reserved 30 semantic.* ids live at 1.3.0).
  const semanticBackend = SemanticBackendLive.createLiveSemanticBackend({ config: store.config })
  const semanticWiring = SemanticStackWiring.createSemanticDomainWiring({ backend: semanticBackend })

  // === Feature 008 / 014 T008 — mcp domain port composition =================
  // The typed 30 `mcp.*` operator ports over the Feature 008 application host. The
  // live `MCP.Service` + `McpAuth` are now resolved through the SAME `AppRuntime`
  // the routing/provider seams use (FR7): the faithful, content-free live-host reads
  // — `mcp.auth.status`, `mcp.resource.admin.list`/`templates` — reflect the live
  // client, while every other read (server-profile projections needing SSOT metadata
  // the host config lacks) and every mutating verb stay typed capability gaps rather
  // than fabricated data or an FR5 phantom write (the `mcp.*` command port returns
  // `kind:"query"`, which the dispatcher rejects for a `mutates` descriptor after any
  // side effect; see backend-live.ts + tasks.md T008). No secret/token/path crosses
  // the seam (FR11, FR14). Feature 007 stays the sole command-registration authority —
  // this override replaces the not_implemented stub and adds no ids.
  const mcpHostReader: McpBackendLive.McpHostReader = {
    authStatus: (serverId) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          return yield* svc.getAuthStatus(serverId)
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
    listResources: (serverId) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const clients = yield* svc.clients()
          const subscribable = clients[serverId]?.getServerCapabilities()?.resources?.subscribe === true
          const resources = yield* svc.resources(serverId)
          return Object.values(resources).map((r) => ({
            serverId,
            uri: r.uri,
            name: r.name,
            mimeType: r.mimeType,
            subscribable,
          }))
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
    listResourceTemplates: (serverId) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const templates = yield* svc.resourceTemplates(serverId)
          return Object.values(templates).map((t) => ({
            serverId,
            uriTemplate: t.uriTemplate,
            name: t.name,
            mimeType: t.mimeType,
          }))
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }
  const mcpBackend = McpBackendLive.createLiveMcpBackend({
    override: McpBackendLive.createMcpServiceOverride(mcpHostReader),
  })
  const mcpWiring = McpStackWiring.createMcpDomainWiring({ backend: mcpBackend })

  // === Feature 013 — telemetry/smart/budget/pools domain port composition ======
  // The four remaining config-backed domains, each a typed operator port over the
  // SAME `store.config` seam the routing/telemetry runtime already binds (FR2–FR5).
  // Reads project the reused effective config; on/off/configure/set/reset are
  // optimistic CAS writes that honest-degrade to typed envelopes (FR7, FR8);
  // telemetry adds the bounded, test-signal-only OTLP reachability probe (FR6). No
  // parallel store is opened — smart/budget/pools project routing config, telemetry
  // the effective telemetry config. Feature 007 stays the sole command-registration
  // authority — these overrides replace the not_implemented stubs and add no ids
  // (the reserved telemetry/smart/budget/pools ids already live in the catalog).
  const telemetryWiring = TelemetryStackWiring.createTelemetryDomainWiring({
    backend: TelemetryBackendLive.createLiveTelemetryBackend({
      config: store.config,
      probe: TelemetryProbeLive.createLiveTelemetryProbe(),
    }),
  })
  const smartWiring = SmartStackWiring.createSmartDomainWiring({
    backend: SmartBackendLive.createLiveSmartBackend({ config: store.config }),
  })
  const budgetWiring = BudgetStackWiring.createBudgetDomainWiring({
    backend: BudgetBackendLive.createLiveBudgetBackend({ config: store.config }),
  })
  const poolsWiring = PoolsStackWiring.createPoolsDomainWiring({
    backend: PoolsBackendLive.createLivePoolsBackend({ config: store.config }),
  })

  const domainPorts = wireDomainPorts(
    {
      ...lifecycleWiring.ports,
      ...jobsWiring.ports,
      ...langLockWiring.ports,
      ...outputSpoolWiring.ports,
      ...semanticWiring.ports,
      ...mcpWiring.ports,
      ...telemetryWiring.ports,
      ...smartWiring.ports,
      ...budgetWiring.ports,
      ...poolsWiring.ports,
      routing: createRoutingDomainPort(routingService),
    },
    { dnsResolver },
  )
  const dispatcher = createDispatcher({
    registry,
    mutationPorts,
    // T040: Config-backed status/show (version+configured), not domain stubs
    handlers: handlersFromDomainPorts(domainPorts, { config: store.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    nowMs: input.nowMs,
    // Per-dispatch resolvers — enable/disable observed without stack restart (R3)
    featureEnabled: () => resolveFeatureEnabled(),
    connectivity: () => resolveConnectivityLive(),
    otel,
    surface: "live",
  })

  const interceptor = createSlashInterceptor({
    registry,
    dispatcher,
    confirmStore: createSlashConfirmStore({ nowMs: input.nowMs }),
    nowMs: input.nowMs,
  })

  return {
    kind: "live",
    directory: path.resolve(input.directory),
    registry,
    dispatcher,
    mutationPorts,
    interceptor,
    secrets,
    sandboxKeychain,
    featureEnabled,
    connectivity,
    otel,
    config,
    resolveFeatureEnabled,
    resolveConnectivity: resolveConnectivityLive,
    dispose: () => {
      lifecycleWiring.dispose()
      jobsWiring.dispose()
      outputSpoolWiring.dispose()
      semanticWiring.dispose()
      mcpWiring.dispose()
      telemetryWiring.dispose()
      smartWiring.dispose()
      budgetWiring.dispose()
      poolsWiring.dispose()
      maintenance.dispose()
    },
  }
}

export function clearLiveOperatorStackCache(directory?: string) {
  if (!directory) {
    liveByDirectory.clear()
    return
  }
  liveByDirectory.delete(path.resolve(directory))
}

export * as OperatorLiveStack from "./stack-live"
