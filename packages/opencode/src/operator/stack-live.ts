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
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceRuntime } from "@/project/instance-runtime"
import { createLiveConfigServiceLike } from "./adapters/outbound/config-live"
import { createLiveEventV2AuditPortFromUse } from "./adapters/outbound/event-v2-live"
import { createDomainStubs, domainHandlerFor, handlersFromDomainPorts } from "./adapters/outbound/domain-stubs"
import { createLiveOperatorOtelRecorder } from "./adapters/outbound/otel-live"
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
  await InstanceRuntime.load({ directory: input.directory })

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
        }),
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
  const domainPorts = createDomainStubs({
    dnsResolver,
  })
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
    dispose: () => maintenance.dispose(),
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
