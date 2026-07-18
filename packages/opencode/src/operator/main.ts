/**
 * Operator control-plane composition root (no transport).
 *
 * Live mode (sandbox=false): requires real Config.Service-like + real EventV2 EventPort +
 * Darwin keychain backend selection. Fail closed if audit missing.
 * Sandbox/test mode: explicit fakes allowed; keychain unavailable.
 */
import type { ConfigServiceLike } from "./adapters/outbound/config-service"
import { createDurableOperatorStore } from "./adapters/outbound/config-service"
import { createKeychainSecretPort, createEnvRefSecretPort, createCompositeSecretPort } from "./adapters/outbound/secret-memory"
import { createDarwinNativeKeychainBackend } from "./adapters/outbound/keychain-darwin"
import { createMemoryOutboxPort } from "./adapters/outbound/outbox-memory"
import { createFlockLockPort } from "./application/ports/lock-port"
import { createDispatcher } from "./application/dispatcher"
import { createSeededOperatorCommandRegistry } from "./application/registry"
import { domainHandlerFor, createDomainStubs, handlersFromDomainPorts } from "./adapters/outbound/domain-stubs"
import type { MutationPorts } from "./application/mutation"
import type { EventPort } from "./application/ports/event-port"
import type { SecretPort } from "./application/ports/secret-port"
import type { DarwinSecurityFfi } from "./adapters/outbound/keychain-backend"

export type OperatorCompositionMode = "live" | "sandbox" | "test"

export type OperatorCompositionInput = {
  readonly mode: OperatorCompositionMode
  /** Required: Config.Service-like. Live must be createLiveConfigServiceLike(...). */
  readonly config: ConfigServiceLike
  readonly lockDir: string
  readonly projectKey?: string
  /**
   * Live mode: REQUIRED EventPort from createLiveEventV2AuditPort / real EventV2.
   * Test/sandbox: optional (memory fake).
   */
  readonly events?: EventPort
  /** Test-only FFI mock. Live uses tryLoadDarwinSecurityFfi unless sandbox. */
  readonly keychainFfi?: DarwinSecurityFfi | null
  readonly nowMs?: () => number
}

export type OperatorComposition = {
  readonly mode: OperatorCompositionMode
  readonly registry: ReturnType<typeof createSeededOperatorCommandRegistry>
  readonly dispatcher: ReturnType<typeof createDispatcher>
  readonly mutationPorts: MutationPorts
  readonly store: ReturnType<typeof createDurableOperatorStore>
  readonly secrets: SecretPort
}

/**
 * Compose operator stack.
 * - live: requireAudit=true, real keychain selection, events required
 * - sandbox/test: keychain unavailable; events optional (memory)
 */
export async function composeOperatorControlPlane(input: OperatorCompositionInput): Promise<OperatorComposition> {
  const mode = input.mode
  const lock = await createFlockLockPort({ dir: input.lockDir })
  const store = createDurableOperatorStore({
    config: input.config,
    lock,
    projectKey: input.projectKey ?? "project",
  })

  if (mode === "live" && !input.events) {
    throw new Error("composeOperatorControlPlane(live): EventPort required (real EventV2 adapter)")
  }

  const sandbox = mode !== "live"
  const keychainBackend =
    mode === "live"
      ? createDarwinNativeKeychainBackend({ sandbox: false, ffi: input.keychainFfi })
      : createDarwinNativeKeychainBackend({ sandbox: true })

  // M4: live always durable Config+Flock+projectKey — no process Map fallback
  const secrets = createCompositeSecretPort({
    keychain: createKeychainSecretPort({
      backend: keychainBackend,
      sandbox,
      config: store.config,
      projectKey: input.projectKey ?? "project",
    }),
    envRef: createEnvRefSecretPort(),
  })

  const mutationPorts: MutationPorts = {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: input.events,
    requireAudit: mode === "live",
    // Live: durable outbox from store (atomic with CAS); test: memory
    outbox: mode === "live" ? store.outbox : createMemoryOutboxPort(),
    nowMs: input.nowMs,
  }

  const registry = createSeededOperatorCommandRegistry()
  const ports = createDomainStubs()
  const dispatcher = createDispatcher({
    registry,
    mutationPorts,
    // T040: Config-backed status/show when store config is available
    handlers: handlersFromDomainPorts(ports, { config: store.config }),
    defaultHandler: domainHandlerFor(ports),
    nowMs: input.nowMs,
  })

  return { mode, registry, dispatcher, mutationPorts, store, secrets }
}

export * as OperatorMain from "./main"
