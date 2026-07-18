/**
 * TEST-ONLY operator stack (memory Config + memory EventPort).
 * Production/worker/TUI local must use createLiveOperatorStack / worker adapter.
 * Not re-exported from production `stack.ts` barrel (R4/R7).
 */
import { createFakeConfigService, createMemoryEventPort, createMemoryOutboxPort } from "./adapters"
import { createDurableOperatorStore } from "./adapters/outbound/config-service"
import { createDomainStubs, domainHandlerFor, handlersFromDomainPorts } from "./adapters/outbound/domain-stubs"
import { createDispatcher, type Dispatcher } from "./application/dispatcher"
import type { MutationPorts } from "./application/mutation"
import { createProcessMutexLockPort } from "./application/ports/lock-port"
import { createSeededOperatorCommandRegistry, type OperatorCommandRegistry } from "./application/registry"
import { createSlashInterceptor, type SlashInterceptor } from "./adapters/inbound/slash"
import { createSlashConfirmStore } from "./adapters/inbound/slash-confirm"
import { createTuiOperatorSlashPort, type TuiOperatorSlashPort } from "./adapters/inbound/tui-port"

export type OperatorStack = {
  readonly registry: OperatorCommandRegistry
  readonly dispatcher: Dispatcher
  readonly mutationPorts: MutationPorts
  readonly interceptor: SlashInterceptor
  readonly kind: "test"
  readonly featureEnabled: boolean
  readonly resolveFeatureEnabled: () => boolean | Promise<boolean>
}

export type CreateTestOperatorStackOptions = {
  readonly nowMs?: () => number
  readonly registry?: OperatorCommandRegistry
  readonly dispatcher?: Dispatcher
  readonly mutationPorts?: MutationPorts
  /** Override flag (default true for unit tests). Supports dynamic resolver. */
  readonly featureEnabled?: boolean | (() => boolean | Promise<boolean>)
  /** Override connectivity (default online). */
  readonly connectivity?: "online" | "offline"
}

/** Explicit test factory — never call from production mount/worker paths. */
export function createTestOperatorStack(options: CreateTestOperatorStackOptions = {}): OperatorStack {
  const registry = options.registry ?? createSeededOperatorCommandRegistry()
  const mutationPorts =
    options.mutationPorts ??
    (() => {
      const lock = createProcessMutexLockPort()
      const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
      return {
        config: store.config,
        idempotency: store.idempotency,
        rollback: store.rollback,
        events: createMemoryEventPort(),
        requireAudit: false,
        outbox: createMemoryOutboxPort(),
        nowMs: options.nowMs,
      } satisfies MutationPorts
    })()

  const ports = createDomainStubs()
  const featureOpt = options.featureEnabled
  const resolveFeatureEnabled = (): boolean | Promise<boolean> => {
    if (typeof featureOpt === "function") return featureOpt()
    if (typeof featureOpt === "boolean") return featureOpt
    return true
  }
  const featureEnabledSnapshot =
    typeof featureOpt === "function" ? true : (featureOpt ?? true)

  const dispatcher =
    options.dispatcher ??
    createDispatcher({
      registry,
      mutationPorts,
      // T040: Config-backed status/show for tests too
      handlers: handlersFromDomainPorts(ports, { config: mutationPorts.config }),
      defaultHandler: domainHandlerFor(ports),
      nowMs: options.nowMs,
      featureEnabled: resolveFeatureEnabled,
      connectivity: options.connectivity ?? "online",
    })

  const interceptor = createSlashInterceptor({
    registry,
    dispatcher,
    confirmStore: createSlashConfirmStore({ nowMs: options.nowMs }),
    nowMs: options.nowMs,
  })

  return {
    registry,
    dispatcher,
    mutationPorts,
    interceptor,
    kind: "test",
    featureEnabled: featureEnabledSnapshot,
    resolveFeatureEnabled,
  }
}

/** @deprecated Use createTestOperatorStack — alias for migration. */
export const createOperatorStack = createTestOperatorStack

let testProcessStack: OperatorStack | undefined

/** Test-only process singleton — not for production TUI/HTTP. */
export function getTestProcessOperatorStack(): OperatorStack {
  if (!testProcessStack) testProcessStack = createTestOperatorStack()
  return testProcessStack
}

export function setTestProcessOperatorStack(stack: OperatorStack | undefined) {
  testProcessStack = stack
}

export function resetTestProcessOperatorStack() {
  testProcessStack = undefined
}

/** @deprecated */
export const getProcessOperatorStack = getTestProcessOperatorStack
/** @deprecated */
export const setProcessOperatorStack = setTestProcessOperatorStack
/** @deprecated */
export const resetProcessOperatorStack = resetTestProcessOperatorStack

export function createLocalTuiOperatorSlashPort(stack?: OperatorStack): TuiOperatorSlashPort {
  const s = stack ?? getTestProcessOperatorStack()
  return createTuiOperatorSlashPort(s.interceptor, { config: s.mutationPorts.config })
}

export * as OperatorTestStack from "./stack-test"
