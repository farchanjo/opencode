/** TEST-ONLY ConfigPort — live uses createDurableOperatorStore. */
export { createMemoryConfigPort, type MemoryConfigPort, type MemoryAuditIntent } from "./config-memory"
export {
  createConfigServiceAdapter,
  createDurableOperatorStore,
  createFakeConfigService,
  createFileConfigService,
  contentHash,
  allocateVersion,
  type ConfigServiceLike,
  type ConfigServiceAdapterOptions,
  type DurableOperatorBundle,
} from "./config-service"
export {
  createConfigServiceLikeFromConfig,
  createLiveConfigServiceLike,
  type ConfigServiceEffect,
  type EffectRunner,
} from "./config-live"
export { createMemoryIdempotencyPort } from "./idempotency-memory"
export { createMemoryRollbackPort } from "./rollback-memory"
/** Test-only memory EventPort — do not use in live composition. */
export { createMemoryEventPort } from "./event-memory"
export {
  createLiveEventV2AuditPort,
  createLiveEventV2AuditPortFromUse,
  stableOperatorAuditEventIdFromRecord,
  type EventV2ServiceLike,
} from "./event-v2-live"
export { createMemoryOutboxPort, createBrokenLocalOutboxPort } from "./outbox-memory"
// Legacy non-atomic createDurableAuditOutboxPort removed; live uses store.outbox only.
export {
  createMemorySecretPort,
  createKeychainSecretPort,
  createEnvRefSecretPort,
  createCompositeSecretPort,
  createMemoryKeychainBackend,
  selectKeychainBackend,
  createMockDarwinSecurityFfi,
  createDurableKeychainSecretPort,
  SECRETS_AUTHORITY,
  KEYCHAIN_SERVICE,
  keychainAccountForVersion,
  allocateKeychainAccount,
  assertSecretName,
  isNotFoundStatus,
  isAuthFailedStatus,
  mapOsStatus,
  OSSTATUS,
  type KeychainBackend,
  type DarwinSecurityFfi,
} from "./secret-memory"
export {
  tryLoadDarwinSecurityFfi,
  createDarwinNativeKeychainBackend,
  probeDarwinSecuritySymbolsPresent,
  loadDarwinSecuritySymbols,
  createDarwinSecurityFfiFromSymbols,
  createBunPointerIO,
  createMockPointerIO,
  type DarwinSecuritySymbols,
  type PointerIO,
} from "./keychain-darwin"
export {
  createDarwinKeychainBackend,
  createUnavailableKeychainBackend,
} from "./keychain-backend"
export {
  createDomainStubs,
  domainHandlerFor,
  wireDomainPorts,
  handlersFromDomainPorts,
} from "./domain-stubs"
export {
  createConfigStatusHandler,
  configStatusHandlersFromPort,
  authorityKeyForCommandId,
} from "./config-status"
export { createLiveOperatorOtelRecorder, type LiveOperatorOtel } from "./otel-live"

export * as OperatorOutbound from "."
