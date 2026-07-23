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
import { ToolRegistry } from "@/tool/registry"
import { InstanceRuntime } from "@/project/instance-runtime"
import { createLiveConfigServiceLike } from "./adapters/outbound/config-live"
import { createLiveEventV2AuditPortFromUse } from "./adapters/outbound/event-v2-live"
import { createDomainStubs, domainHandlerFor, handlersFromDomainPorts, wireDomainPorts } from "./adapters/outbound/domain-stubs"
import { createRoutingService } from "@/routing/application/routing-service"
import { createRoutingDomainPort } from "@/routing/adapters/inbound/routing-command-port"
import { createConfigAdapter, toRoutingConfigSource } from "@/routing/adapters/outbound/config-adapter"
import { createRoutingConfigureBackend } from "@/routing/adapters/outbound/configure-backend"
import {
  createCandidateSource,
  createCatalogAdapter,
  createCatalogModelValidator,
  type AgentResolver,
  type CatalogCandidateService,
} from "@/routing/adapters/outbound/catalog-adapter"
import { createDomainDecisionStore } from "@/routing/application/decision-store"
import { createFsDecisionStorePort } from "@/routing/adapters/outbound/decision-store-fs"
import { createTaskAnalyzer } from "@/routing/application/task-analyzer"
import { createOtlpAdapter, createRoutingDecisionTelemetry } from "@/routing/adapters/outbound/otlp-adapter"
import { resolveEffectiveTelemetryConfig } from "@/routing/application/telemetry-service"
import { TelemetryExport } from "@/routing/telemetry-export"
import { createLiveOperatorOtelRecorder } from "./adapters/outbound/otel-live"
import { LifecycleStackWiring } from "./lifecycle/stack-wiring"
import { JobsStackWiring } from "./jobs/stack-wiring"
import { JobsBackendLive } from "./jobs/backend-live"
import { OperatorJobPersistence } from "./jobs/persistence"
import { JobOccurrenceProjection } from "./jobs/occurrence-projection"
import { EventBus } from "@opencode-ai/core/lifecycle/event-bus"
import { LangLockStackWiring } from "./langlock/stack-wiring"
import { LangLockBackendLive } from "./langlock/backend-live"
import { LangLockPersistence } from "@/langlock/persistence"
import { OutputSpoolStackWiring } from "./outputspool/stack-wiring"
import { OutputSpoolBackendLive } from "./outputspool/backend-live"
import { SpoolProcessWriter } from "@/outputspool/spool-process-writer"
import { ExecutorComposition } from "@/jobs/executor-composition"
import { ExecutorReconcile } from "@/jobs/executor-reconcile"
import { createOperatorAuthorityResolver } from "./application/command-authority"
import { SemanticStackWiring } from "./semantic/stack-wiring"
import { SemanticBackendLive } from "./semantic/backend-live"
import { RerankProbe } from "./semantic/rerank-probe"
import { MilvusBinding } from "./semantic/milvus-binding"
import { SemanticRegistryBackend } from "./semantic/registry-backend"
import { MilvusComposition } from "@/semantic/milvus-composition"
import { LiveDocSource } from "@/semantic/live-doc-source"
import { OutputSpoolStore } from "@/semantic/output-spool-store"
import { SessionSpoolWriter } from "@/session/output-spool-writer"
import { ReconcileLock } from "@/semantic/reconcile-lock"
import { EmbeddingsHttpClient } from "@/semantic/embeddings-http-client"
import { EmbeddingClient } from "@/semantic/embedding-client"
import { BindingRuntime } from "@/semantic/binding-runtime"
import { DimensionProbe } from "@/semantic/dimension-probe"
import { AgentDocBuilder } from "@opencode-ai/core/semantic/agent-doc"
import { DEFAULT_ROUTING_BUDGET } from "@/routing/adapters/outbound/config-adapter"
import type { IndexPort } from "@opencode-ai/protocol/semantic/ports"
import type { CollectionKind, IndexError } from "@opencode-ai/protocol/semantic/commands"
import { Skill } from "@/skill"
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
import { EnforcementStackWiring } from "./enforcement/stack-wiring"
import { EnforcementLeafBackend } from "./enforcement/leaf-backend"
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
  /** Preflight authority resolution — the authority a command's plan will commit to (command-authority.ts). */
  readonly resolveAuthority: (
    commandId: string,
    scope: { readonly scopeKind: string; readonly scopeRef: string | null },
  ) => string | null
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
            update: (patch, options) => svc.update(patch as never, options),
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
  // Feature 026 (FR2) — expose the internal-material path on the keychain part so the reranker
  // validation probe (below) can resolve a provider's SecretRef to an Authorization header for a
  // real provider call. Redaction is intact: the public `resolveMaterial` still returns
  // `__redacted__`, and the internal material is only ever handed to the probe transport, never
  // crossing the CommandResult/audit/config seam.
  const keychainSecrets = createKeychainSecretPort({
    backend: keychainBackend,
    sandbox: sandboxKeychain,
    // Production: durable metadata under same Config+Flock document
    config: store.config,
    projectKey: input.projectKey ?? "project",
    exposeInternalMaterial: true,
  }) as SecretPort & { readonly resolveSecretMaterial?: (ref: { backend: "keychain" | "env-ref"; name: string; version: number }) => Promise<string | null> }
  const secrets = createCompositeSecretPort({
    keychain: keychainSecrets,
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
  // owned by createCatalogAdapter. Provider.list() is InstanceState-backed, so
  // the seam MUST bind InstanceRef (mirrors the config seam above) — Feature 039
  // fixed the missing bind that died `InstanceRef not provided` and broke
  // `routing.test`, `capability inspect`, and (via F038) `pools.set`.
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
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }

  // Agent seam: the canonical, config-composed specialist registry (AgentV2,
  // T031). resolveSpecialist gates hidden internal agents out; listSpecialists
  // is that same filter over the whole pool. Routing never fabricates agent
  // identity. Skill/effort metadata is not yet carried on Agent.Info, so the
  // pool exposes empty skills + neutral effort defaults — hard gates + ranking
  // still apply; documented in data-model.md. Agent.Service is InstanceState-backed,
  // so this seam MUST bind InstanceRef too (Feature 039, same defect as the catalog
  // seam above).
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
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }

  const catalogAdapter = createCatalogAdapter({ catalog: catalogCandidates })
  const candidateSource = createCandidateSource({
    catalog: catalogAdapter,
    agents: agentResolver,
  })
  // Feature 038 — the same catalog resolution backs the pools.set write-time
  // validator, so a role-pool id is accepted iff it would resolve to a candidate.
  const poolsCatalogValidator = createCatalogModelValidator(catalogAdapter)

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
  // Feature 017 / T015 (FR11, FR12) — the jobs occurrence projection over the durable
  // EventV2Bridge seam, closing GAP F. The one resolved `EventV2Bridge.Service`
  // singleton (the same the lifecycle wiring taps) backs `readAggregate`
  // (`readDurablePage`) and the bounded live `subscribe` (`EventBus.subscribeBounded`)
  // so `jobs.history` / `jobs.show` occurrences / `jobs.watch` project real `job.*`
  // durable events. An unbound bridge degrades every read to a typed `unavailable`.
  const jobsBridge = await AppRuntime.runPromise(
    Effect.gen(function* () {
      return yield* EventV2Bridge.Service
    }),
  )
  const jobOccurrenceSource: JobOccurrenceProjection.JobOccurrenceSource = {
    readAggregate: (input) =>
      Effect.tryPromise({
        try: () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const svc = yield* EventV2Bridge.Service
              return yield* svc.readDurablePage(input)
            }),
          ),
        catch: (cause) => ({ type: "unavailable", reason: String(cause) }),
      }),
    subscribe: () =>
      EventBus.subscribeBounded(jobsBridge, { capacity: 1024, overflow: "backpressure" }).pipe(
        Effect.mapError((cause) => ({ type: "unavailable", reason: String(cause) })),
      ),
  }
  // Feature 018 / T008 — bind run-now to the eager executor's `enqueueImmediate`
  // seam (armed at server start, or lazily here for CLI `op` contexts). A disarmed
  // executor degrades run-now to a typed `unavailable`; never a fabricated occurrence.
  const jobsRunNow: JobsBackendLive.RunNowEnqueuePort = (request) =>
    // Feature 022 (ADR-0022): `ensureExecutorComposition` is now async (its live
    // deps load via a dynamic import for `bun build --compile`); chain through the
    // resolved composition. A disarmed executor still degrades run-now to a typed
    // `unavailable` — the fail-open contract is unchanged, only load timing.
    ExecutorComposition.ensureExecutorComposition().then((composition) =>
      composition.enqueueImmediate({
        jobDefinitionId: request.jobDefinitionId,
        scheduleId: request.scheduleId,
        overlapPolicy: request.overlapPolicy,
        overlapCapabilities: ExecutorReconcile.IN_PROCESS_OVERLAP,
        // Definition-keyed durable aggregate: a run-now occurrence roots on its
        // definition, so its events land under the `jobDefinitionId` aggregate the
        // occurrence projection reads (Group C).
        rootSessionId: request.jobDefinitionId,
        generation: 0,
      }),
    )
  const jobsBackend = JobsBackendLive.createLiveJobsBackend({
    persistence: OperatorJobPersistence.createOperatorJobPersistence({ config: store.config }),
    occurrences: JobOccurrenceProjection.createJobOccurrenceProjection(jobOccurrenceSource),
    runNow: jobsRunNow,
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
  const langLockPersistence = LangLockPersistence.createLangLockPersistence({ config: store.config })
  const langLockBackend = LangLockBackendLive.createLiveLangLockBackend({
    persistence: langLockPersistence,
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
  // Feature 017 fix-round (ADR-0017): REUSE the process-wide production writer + control store
  // (armed eagerly at server start, or on demand here for non-server contexts like CLI `op`).
  // The operator reads the SAME populated `operator-control.db` and never opens a second
  // connection or a duplicate GlobalBus subscription. Fail-open: an unopenable store leaves the
  // reads a typed capability gap (FR6, FR10, FR14).
  const sharedSpool = SpoolProcessWriter.ensureProcessSpoolWriter()
  const outputControlStore = sharedSpool?.store
  const spoolRoot = sharedSpool?.spoolRoot ?? path.join(Global.Path.data, "outputspool")
  const retentionAuthorityFor = (scope: "global" | "project", scopeId: string) =>
    scope === "global" ? "global:output.retention" : `output.retention/${scopeId || "project"}`
  const quotaAuthorityFor = (scope: "global" | "project", scopeId: string) =>
    scope === "global" ? "global:output.quota" : `output.quota/${scopeId || "project"}`
  const outputSpoolBackend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({
    store: outputControlStore,
    spoolRoot,
    retentionAuthorityFor,
    quotaAuthorityFor,
    // Feature 017 / T013, T014 — the store is populated by the process-wide production writer,
    // so `follow` binds its cursor codec and `release`/`delete`/`purge` commit through the
    // store-scoped admin authority (FR8, FR9). Both stay typed gaps when the store is unbound.
    enableFollow: outputControlStore !== undefined,
    adminAuthority: OutputSpoolBackendLive.OUTPUT_ADMIN_AUTHORITY,
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
  // Feature 017 / T016 (FR13, FR14) — bind the Milvus index override WHEN an endpoint
  // is configured. The endpoint (host:port) is resolved from the operator environment;
  // when present the `index.*` verbs bind over the shipped `milvus-adapter` under a
  // BOUNDED probe (a probe-seam outage or an unreachable endpoint → typed
  // `milvus_unavailable`), and when absent every index verb degrades to the exact same
  // typed `milvus_unavailable` gap as today. The endpoint/credential never cross the
  // result seam — only a bounded reachability finding or a typed gap (FR14, FR18).
  // Feature 019 / T004 (FR4) — bind a REAL Milvus client over the shipped REST v2 adapter
  // when `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is configured. TLS is on by default; an explicit
  // `http://` address (or `OPENCODE_SEMANTIC_MILVUS_INSECURE=1`) opts out for a local profile.
  // The bound port lets the `index.*` maintenance verbs probe live and lets the config-backed
  // registry physically build a generation + swap the alias for an embedding cutover. The
  // endpoint/credential never cross the result seam — only a bounded finding or a typed gap.
  // When unconfigured, NO port is bound and every index/binding verb degrades to the EXACT
  // same typed `milvus_unavailable` floor as today.
  // Feature 019 (FR3, FR32) — `semantic.embedding.validate`/`reranker.validate` now route through the
  // config-backed registry as PERSISTED transitions that promote a staged candidate to `validated`
  // (the only producer of a validated candidate a cutover may activate). Embedding validate is
  // Milvus-conditional (reindex-first).
  // Feature 026 (FR2) — the reranker validation probe is now COMPOSED (no Milvus): it drives the
  // Feature 006 rerank client (`/v1/rerank` profile A / structured-chat profile B) against the
  // staged candidate's provider endpoint, with the Authorization header resolved from the
  // provider's SecretRef through the keychain internal-material path (redaction intact — the secret
  // is never logged or returned). A required-but-unresolvable secret, an unreachable endpoint, or a
  // non-passing probe fails HONESTLY (`validation_failed` / nothing committed), never a fabricated
  // `validated`.
  // Feature 050 / T023 (FR4) — the SecretRef -> Authorization header resolver, extracted so
  // BOTH the reranker validation probe and the new production embeddings client (below) share
  // ONE resolution path over the SAME keychain internal-material seam — never a third inline
  // copy (plan.md "Reuse contract" #1).
  const resolveProviderAuthHeader = async (secretRef: string): Promise<string | null> => {
    const colon = secretRef.indexOf(":")
    if (colon <= 0) return null
    const backend = secretRef.slice(0, colon)
    if (backend !== "keychain" && backend !== "env-ref") return null
    const rest = secretRef.slice(colon + 1)
    const at = rest.lastIndexOf("@v")
    const name = at >= 0 ? rest.slice(0, at) : rest
    const version = at >= 0 ? Number(rest.slice(at + 2)) : 1
    if (name.length === 0 || !Number.isInteger(version) || version < 1) return null
    const material = await keychainSecrets.resolveSecretMaterial?.({ backend, name, version })
    return material ? `Bearer ${material}` : null
  }
  const rerankProbe = RerankProbe.createRerankValidationProbe({
    http: RerankProbe.createFetchRerankHttpClient(),
    resolveAuthHeader: resolveProviderAuthHeader,
  })
  const milvusAddress = process.env["OPENCODE_SEMANTIC_MILVUS_ADDRESS"]?.trim()
  const insecureMilvus = process.env["OPENCODE_SEMANTIC_MILVUS_INSECURE"] === "1"
  // Feature 050 (FR4) — the ONE shared Milvus-port composition; the runner uses the same helper.
  const milvusPort = MilvusComposition.composeMilvusPort({
    address: milvusAddress,
    insecure: insecureMilvus,
    token: process.env["OPENCODE_SEMANTIC_MILVUS_TOKEN"] || undefined,
  })
  // Feature 050 / T023 (FR9) — read the active embedding binding for both the data-plane
  // embed client and the reconcile projection context's pinned binding version. A structural
  // (duck-typed) read over the SAME persisted `semantic` authority document
  // `registry-backend.ts`'s private `readDoc` decodes — this composition root never re-derives
  // that schema, it only reads the same field names `BindingRuntime.resolveActiveBinding`
  // (Wave 1) already joins provider/model back through (FR4, mirrors `planValidateReranker`'s
  // inline join, `registry-backend.ts:1005`, rather than re-deriving the shape).
  const semanticProjectId = process.env["OPENCODE_SEMANTIC_PROJECT_ID"] ?? "opencodedev"
  const readActiveEmbeddingBinding = async (): Promise<BindingRuntime.ActiveBinding | undefined> => {
    const entry = await store.config.get(SemanticRegistryBackend.AUTHORITY)
    if (!entry) return undefined
    return BindingRuntime.resolveActiveBinding(entry.payload as BindingRuntime.RegistryDocumentView, "embedding")
  }

  // Feature 050 / T023 (FR5) — the data-plane embed closure the LiveDocSource embeds
  // agent/skill/skill-chunk ranking text through, bound to the ACTIVE embedding binding (never
  // a hardcoded provider). A missing active binding rejects rather than fabricating a vector
  // (mirrors the honest-gap comment at `milvus-binding.ts:76-77`).
  const DATA_PLANE_EMBED_BATCH_SIZE = 32
  const embedForLiveDocSource = async (texts: readonly string[]): Promise<ReadonlyArray<readonly number[]>> => {
    const active = await readActiveEmbeddingBinding()
    if (!active) throw new Error("createLiveDocSource: no active embedding binding configured")
    const http = EmbeddingsHttpClient.createFetchEmbeddingsHttpClient({
      secretRef: active.secretRef || null,
      resolveAuthHeader: resolveProviderAuthHeader,
    })
    return EmbeddingClient.embed(
      { http },
      { baseUrl: active.baseUrl, model: active.modelRef, texts, maxBatchSize: DATA_PLANE_EMBED_BATCH_SIZE },
    )
  }

  // Feature 050 / T021 (FR6) — the model-driven dimension probe the config-backed registry's
  // `generationVectorSpace` calls instead of a hardcoded default, AND the collection-bootstrap
  // uses to size a fresh generation. Resolves over the SAME embeddings transport + provider-auth
  // resolver as the data-plane embed closure. A probe failure fails CLOSED — never a default.
  const embeddingProbe = (input: { baseUrl: string; modelRef: string; secretRef: string }) =>
    DimensionProbe.probeVectorSpace(
      {
        http: EmbeddingsHttpClient.createFetchEmbeddingsHttpClient({
          secretRef: input.secretRef || null,
          resolveAuthHeader: resolveProviderAuthHeader,
        }),
      },
      { baseUrl: input.baseUrl, modelRef: input.modelRef },
    )

  // Feature 050 (FR9) — ensure a collection physically exists before a FULL rebuild upserts into it.
  // On a fresh Milvus (no generation ever built) this builds a generation at the ACTIVE binding's
  // PROBED dimension (2560 for Qwen3-Embedding-4B, never a default) and points the alias at it, so
  // `index reindex` produces a real, correctly-sized, queryable index (AC1, AC2). Idempotent: a
  // collection that already enumerates is left untouched.
  const ensureSemanticCollection = async (collection: CollectionKind): Promise<void> => {
    if (milvusPort === undefined) throw new Error("no milvus port bound")
    const present = await AppRuntime.runPromise(
      milvusPort
        .enumerateIndexed({ collection, projectId: semanticProjectId })
        .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
    )
    if (present) return
    const active = await readActiveEmbeddingBinding()
    if (!active) throw new Error("no active embedding binding to size the collection")
    const space = await embeddingProbe({ baseUrl: active.baseUrl, modelRef: active.modelRef, secretRef: active.secretRef })
    if ("type" in space) throw new Error(`dimension probe failed: ${space.detail}`)
    const generationId = `gen_bootstrap_${Date.now()}`
    await AppRuntime.runPromise(
      milvusPort.buildGeneration({ collections: [collection], generationId, dimension: space.dimension, metric: space.metric }),
    )
    await AppRuntime.runPromise(milvusPort.swapAliases({ targets: [{ collection, generationId }], casToken: "" }))
  }

  // Feature 050 / T023 (FR9) — the live agent/skill readers, mirroring the SAME AppRuntime +
  // InstanceRef pattern the MCP/agent reads above already use (~L601, L627-637): `Agent.Info`
  // (`id: name`, `permission` singular) and `Skill.Info` (`name`/`description`/`content`) are
  // mapped onto the Wave-1 builders' minimal structural input shapes.
  const readLiveAgents = (): Promise<readonly AgentDocBuilder.AgentInfoLike[]> =>
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Agent.Service
        const agents = yield* svc.list()
        return agents.map((a) => ({
          id: a.name,
          description: a.description,
          mode: a.mode,
          hidden: a.hidden ?? false,
          color: a.color,
          permissions: a.permission,
        }))
      }).pipe(Effect.provideService(InstanceRef, instance)),
    )
  const readLiveSkills = (): Promise<readonly LiveDocSource.SkillSourceInput[]> =>
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Skill.Service
        const skills = yield* svc.all()
        return skills.map((s) => ({ name: s.name, description: s.description, content: s.content }))
      }).pipe(Effect.provideService(InstanceRef, instance)),
    )

  // Feature 050 / T031 (FR11) — the live tool descriptors for the `tools` collection, keyed by their
  // EXACT runtime id (`registry.all()` item id for native/plugin/custom; `mcp.tools()` record key,
  // already `McpCatalog.toolName(client, name)`, for MCP) — the `feature050-tool-id-equality` invariant.
  // `rawParameterSchema` is the native `tool.jsonSchema` / MCP `inputSchema`; `ToolProjection.project`
  // sanitizes it before anything reaches the index. Mirrors the SAME AppRuntime + InstanceRef pattern
  // `readLiveAgents`/`readLiveSkills` use: the registry + MCP surfaces enumerate cleanly under the
  // provided `InstanceRef` (the earlier "uncontainable fork defect" was the `SemanticRetrieval` layer
  // reading config at build time — fixed in `effect/app-runtime.ts` — not a tool-enumeration escape).
  const readLiveTools = (): Promise<readonly LiveDocSource.ToolSourceInput[]> =>
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const mcp = yield* MCP.Service
        const native = yield* registry.all()
        const mcpTools = yield* mcp.tools()
        const nativeInputs = native.map(
          (tool): LiveDocSource.ToolSourceInput => ({
            toolId: tool.id,
            displayName: tool.id,
            rawDescription: tool.description ?? "",
            rawParameterSchema: tool.jsonSchema ?? {},
            source: "native",
          }),
        )
        const mcpInputs = Object.entries(mcpTools).map(
          ([toolId, tool]): LiveDocSource.ToolSourceInput => ({
            toolId,
            displayName: tool.def.name ?? toolId,
            rawDescription: tool.def.description ?? "",
            rawParameterSchema: tool.def.inputSchema ?? {},
            source: "mcp",
          }),
        )
        return [...nativeInputs, ...mcpInputs]
      }).pipe(Effect.provideService(InstanceRef, instance)),
    )

  // Feature 050 / T023 (FR9) — the mandatory scalar partition filters for `skills`/`skill_chunks`
  // (they carry no `DocScope` of their own, `data-model.md` "SkillDoc field mapping"); mirrors the
  // SAME `project`/`project` scope `AgentDocBuilder.build` stamps for agents.
  const semanticFilters = (projectId: string) => ({ projectId, scope: "project", visibility: "project" })

  // Feature 050 / T023 (FR8) — the real chunk-body spool store, replacing the non-resolvable
  // `boundedSpool` stub, over the SAME shared process-wide control store + spool root the
  // outputspool domain already reads (never a second connection). Absent (fail-open store) ->
  // no `LiveDocSource` is composed, keeping the honest `milvus_unavailable` floor.
  const liveDocSource =
    outputControlStore !== undefined
      ? LiveDocSource.createLiveDocSource({
          agents: readLiveAgents,
          skills: readLiveSkills,
          // The `tools` collection's live enumeration walks the tool registry (native/plugin/custom)
          // plus the connected MCP catalog. Both surfaces resolve cleanly under the provided
          // `InstanceRef` (see `readLiveTools`), so `collectTools` → `ToolProjection` → `toolLiveDoc`
          // upserts the live tool docs from the operator CLI, no session context required.
          tools: readLiveTools,
          embed: embedForLiveDocSource,
          spool: OutputSpoolStore.createOutputSpoolStore({
            writer: SessionSpoolWriter.createSessionSpoolWriter({ store: outputControlStore, spoolRoot }),
            reader: outputSpoolBackend,
          }),
          // Embed-skip (FR9): a fresh read of the currently indexed hashes per collection, over
          // the SAME bound MilvusPort `runMaintenance` already calls `enumerateIndexed` on
          // (`milvus-binding.ts:172-175`) — never a second `LiveDocSource.collect` parameter.
          indexedHashes: milvusPort
            ? async (collection) => {
                const result = await AppRuntime.runPromise(
                  milvusPort
                    .enumerateIndexed({ collection, projectId: semanticProjectId })
                    .pipe(Effect.match({ onFailure: () => ({ docs: [] }), onSuccess: (r) => r })),
                )
                return new Map(result.docs.map((doc) => [doc.canonicalId, doc.contentHash]))
              }
            : undefined,
          chunking: {
            maxChunks: DEFAULT_ROUTING_BUDGET.retrieval.max_skill_chunks,
            chunkSizeTokens: 512,
            overlapTokens: 64,
          },
          filters: semanticFilters,
        })
      : undefined

  const milvus: MilvusBinding.MilvusIndexBindingDeps | undefined =
    milvusAddress && milvusAddress.length > 0 && milvusPort !== undefined
      ? {
          endpoint: {
            address: milvusAddress,
            ssl: !insecureMilvus,
            secretRef: process.env["OPENCODE_SEMANTIC_MILVUS_SECRET_REF"] || undefined,
          },
          port: milvusPort,
          // The live probe runs the bound client's health call; an unreachable endpoint resolves
          // an honest `reachable:false` finding rather than rejecting (never leaks the endpoint).
          probe: async () => {
            const started = Date.now()
            const health = await AppRuntime.runPromise(
              milvusPort.health().pipe(Effect.match({ onFailure: () => null, onSuccess: (h) => h })),
            )
            return health === null
              ? { reachable: false, latencyMs: Date.now() - started }
              : { reachable: health.reachable, latencyMs: health.latencyMs }
          },
          // Feature 050 / T023 (FR9, FR10) — the live-doc source + reconcile projection context
          // (the P0 canonical project id plus the currently pinned embedding binding version,
          // carried UNCHANGED across a reconcile). The job-summary spool sink is left at its
          // `boundedSpool` default (`milvus-binding.ts:116-118`) — that log sink is NOT the chunk
          // store `liveDocSource` already wires above.
          source: liveDocSource,
          context: liveDocSource
            ? async () => {
                const active = await readActiveEmbeddingBinding()
                return { projectId: semanticProjectId, bindingVersion: active?.bindingVersion ?? 0 }
              }
            : undefined,
          // A full rebuild bootstraps the collection at the probed dimension before upsert (AC1, AC2).
          ensure: liveDocSource ? ensureSemanticCollection : undefined,
        }
      : undefined

  // Feature 050 / T023 (FR10) — serialize an incremental reconcile against a full reindex for
  // this profile via the Wave-1 `ReconcileLock`, so an in-flight alias-swap can never orphan a
  // concurrent reconcile's upserts. Keyed on the profile root (`OPENCODE_CONFIG_DIR`, or the
  // default config path when unset) so distinct profiles never contend on the same lock file.
  const semanticReconcileLock = ReconcileLock.createReconcileLock({
    lockRoot: path.join(Global.Path.state, "semantic-index-locks"),
  })
  const withSemanticReconcileLock = <A>(effect: Effect.Effect<A, IndexError>, holder: string): Effect.Effect<A, IndexError> =>
    Effect.gen(function* () {
      const handle = yield* semanticReconcileLock.acquire({ profileId: Global.Path.config, holder }).pipe(
        Effect.mapError((cause): IndexError => ({ type: "milvus_unavailable", reason: `semantic index lock ${cause.type}` })),
      )
      return yield* effect.pipe(Effect.ensuring(handle.release()))
    })
  const withLockedMaintenance = (port: IndexPort): IndexPort => ({
    ...port,
    reindex: (input) => withSemanticReconcileLock(port.reindex(input), "reindex"),
    reconcile: (input) => withSemanticReconcileLock(port.reconcile(input), "reconcile"),
  })
  const semanticIndexPort = milvus
    ? withLockedMaintenance(MilvusBinding.createMilvusIndexPort(milvus))
    : undefined
  const semanticBackend = SemanticBackendLive.createLiveSemanticBackend({
    config: store.config,
    milvus,
    milvusPort,
    rerankProbe,
    embeddingProbe,
    override: semanticIndexPort ? { index: semanticIndexPort } : undefined,
  })
  const semanticWiring = SemanticStackWiring.createSemanticDomainWiring({ backend: semanticBackend })

  // Feature 058 — when OpenCode opens with a live index port, dispatch background
  // skills + skill_chunks reconcile/reindex so semantic ranking is not stuck on
  // passthrough. Fail-open; never blocks stack construction.
  if (semanticIndexPort) {
    void import("@/semantic/startup-index")
      .then(({ dispatchStartupSemanticIndex }) => dispatchStartupSemanticIndex(semanticIndexPort))
      .catch(() => {})
  }

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
  // Feature 017 / T007 — the live-host server reads back `mcp.server.list`/`status`/
  // `capabilities` over `MCP.Service.status()` + `clients()`, projecting ONLY the real
  // connection status + transport/capabilities presence — never a fabricated SSOT field
  // (CAS version, auditId, trust profile, timestamps) (FR1, FR2).
  const mcpLiveServers: McpBackendLive.McpLiveServerSource = {
    statuses: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const statuses = yield* svc.status()
          return Object.fromEntries(Object.entries(statuses).map(([id, s]) => [id, s.status]))
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
    clients: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const clients = yield* svc.clients()
          return Object.fromEntries(
            Object.entries(clients).map(([id, client]) => [
              id,
              { transportPresent: client.transport != null, capabilitiesPresent: client.getServerCapabilities() != null },
            ]),
          )
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }

  // Feature 017 / T009 — the live `MCP.Service` connection actions. `connect`/`disconnect`/
  // `reconnect` perform the real op and read back the resulting status; a missing server is
  // a typed `not_found` gap (never a fabricated success) (FR4, FR5).
  const mcpConnectAction = (serverId: string, op: (svc: MCP.Interface) => Effect.Effect<void, MCP.NotFoundError>, fallback: string) =>
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* MCP.Service
        yield* op(svc)
        const statuses = yield* svc.status()
        return { kind: "ok" as const, status: statuses[serverId]?.status ?? fallback }
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", () => Effect.succeed({ kind: "not_found" as const })),
        Effect.provideService(InstanceRef, instance),
      ),
    )
  const mcpLiveActions: McpBackendLive.McpLiveActions = {
    connect: (serverId) => mcpConnectAction(serverId, (svc) => svc.connect(serverId), "connected"),
    disconnect: (serverId) => mcpConnectAction(serverId, (svc) => svc.disconnect(serverId), "disabled"),
    reconnect: (serverId) =>
      mcpConnectAction(serverId, (svc) => svc.disconnect(serverId).pipe(Effect.andThen(svc.connect(serverId))), "connected"),
  }

  // Feature 017 / T010 — the local credential clear backing `mcp.auth.remove`
  // (`MCP.Service.removeAuth` → `McpAuth.remove`).
  const mcpAuthClear: McpBackendLive.McpAuthClear = {
    remove: (serverId) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          yield* svc.removeAuth(serverId)
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }

  // Feature 019 / T010 (FR8) — the interactive-OAuth delegate over `MCP.Service`
  // (`startAuth` returns the authorize URL + starts the loopback callback listener;
  // `finishAuth` completes the exchange). Reached ONLY for an interactive TUI surface
  // (the command port gates on the request source); a headless surface keeps the typed
  // gap (ADR-0019 decision 5). The authorize URL is not a secret; no token or code
  // verifier crosses the seam. `startAuth` may `die` for a non-OAuth server — the plan
  // effect catches it and degrades to a typed `unavailable`.
  const mcpAuthDelegate: McpBackendLive.McpAuthDelegate = {
    start: (serverId) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const result = yield* svc
            .startAuth(serverId)
            .pipe(Effect.catchTag("MCP.NotFoundError", () => Effect.succeed(null)))
          if (!result) return { kind: "not_found" as const }
          return { kind: "ok" as const, authorizationUrl: result.authorizationUrl, oauthState: result.oauthState }
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
    finish: (serverId, input) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          // The opaque callback query string carries the CSRF `state` + the authorization
          // `code`; validate the state against the flow nonce before completing the exchange.
          const params = new URLSearchParams(input.callbackParams.replace(/^\?/, ""))
          const returnedState = params.get("state")
          if (input.oauthState && returnedState && returnedState !== input.oauthState) {
            return { kind: "state_mismatch" as const }
          }
          const code = params.get("code") ?? ""
          const status = yield* svc
            .finishAuth(serverId, code)
            .pipe(Effect.catchTag("MCP.NotFoundError", () => Effect.succeed(null)))
          if (!status) return { kind: "not_found" as const }
          return { kind: "ok" as const, status: status.status }
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }

  // Feature 019 / T011 (FR9) — the subscribe-capable live client over the SDK
  // `subscribeResource`/`unsubscribeResource`. `capability` reports the negotiated
  // `resources.subscribe` capability (absent → fail-closed `capability_absent`; no
  // connected client → typed unavailable); the pure dual-authority machine gates the op.
  const mcpSubscriptionClient: McpBackendLive.McpSubscriptionClient = {
    capability: (serverId) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const clients = yield* svc.clients()
          const client = clients[serverId]
          if (!client) return { kind: "no_client" as const }
          return client.getServerCapabilities()?.resources?.subscribe === true
            ? { kind: "capable" as const }
            : { kind: "capability_absent" as const }
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
    subscribe: (serverId, uri) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const clients = yield* svc.clients()
          const client = clients[serverId]
          if (client) yield* Effect.promise(() => client.subscribeResource({ uri }))
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
    unsubscribe: (serverId, uri) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* MCP.Service
          const clients = yield* svc.clients()
          const client = clients[serverId]
          if (client) yield* Effect.promise(() => client.unsubscribeResource({ uri }))
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  }

  const mcpBackend = McpBackendLive.createLiveMcpBackend({
    override: McpBackendLive.createMcpServiceOverride(mcpHostReader, {
      servers: mcpLiveServers,
      mutations: {
        config: store.config,
        actions: mcpLiveActions,
        authClear: mcpAuthClear,
        auth: mcpAuthDelegate,
        subscription: mcpSubscriptionClient,
      },
    }),
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
  // Feature 046 — one shared enforcement-leaf backend over the SAME routing document
  // budget/smart/pools project; it powers hierarchy.*/capability.* AND budget.configure
  // + the leaf-enriched budget.show. No parallel store.
  const enforcementBackend = EnforcementLeafBackend.createLiveEnforcementBackend({ config: store.config })
  const budgetWiring = BudgetStackWiring.createBudgetDomainWiring({
    backend: BudgetBackendLive.createLiveBudgetBackend({ config: store.config }),
    enforcement: enforcementBackend,
  })
  const poolsWiring = PoolsStackWiring.createPoolsDomainWiring({
    backend: PoolsBackendLive.createLivePoolsBackend({ config: store.config, catalog: poolsCatalogValidator }),
  })
  const enforcementWiring = EnforcementStackWiring.createEnforcementDomainWiring({
    backend: enforcementBackend,
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
      ...enforcementWiring.ports,
      // Feature 024 — a write-capable configure backend over the SAME committed
      // store.config seam smart/budget/pools project. routing.configure now persists
      // via a CAS mutation_plan (partial-merged to preserve role_pools + activation),
      // replacing the not_implemented stub. No parallel store, no new command id.
      routing: createRoutingDomainPort(routingService, createRoutingConfigureBackend({ config: store.config })),
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
    // Feature 019 / T016 — pull-based telemetry export reactivity. Every committed
    // operator mutation bumps the content-free mutation counter; a `telemetry.*`
    // commit re-resolves the effective config and re-arms/stops the export pipeline
    // (enabling arms a real transport, disabling goes silent). Fail-open.
    onCommitted: (descriptor) => {
      TelemetryExport.recordOperatorMutation()
      if (descriptor.domain === "telemetry") void TelemetryExport.rearmTelemetryExport().catch(() => {})
    },
  })

  // Feature 017 fix-round (ADR-0017): the preflight authority resolver, sourced from the SAME
  // domain authorities/resolvers the backends commit under — so preflight returns the version of
  // the authority the command actually writes (the shared globals no longer alias the id prefix).
  const resolveAuthority = createOperatorAuthorityResolver({
    langlockAuthorityFor: (scope, scopeId) => langLockPersistence.authorityFor(scope, scopeId),
    retentionAuthorityFor,
    quotaAuthorityFor,
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
    resolveAuthority,
    dispose: () => {
      lifecycleWiring.dispose()
      jobsWiring.dispose()
      // The OutputSpool writer subscription is process-wide (SpoolProcessWriter), not owned by
      // this stack — disposing the stack must not tear it down; a session keeps spooling.
      outputSpoolWiring.dispose()
      semanticWiring.dispose()
      mcpWiring.dispose()
      telemetryWiring.dispose()
      smartWiring.dispose()
      budgetWiring.dispose()
      poolsWiring.dispose()
      enforcementWiring.dispose()
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
