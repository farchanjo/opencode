/**
 * Operator application layer (Feature 007).
 * Registry, dispatcher, confirmation, ports orchestration, zero-LLM.
 */
export {
  guardOperatorRegistrationName,
  withReservedNameGuard,
  dryRunLegacyMigration,
  classifyLegacyAdminName,
  checkReservedRegistrationName,
} from "./registration-guard"

export {
  createOperatorCommandRegistry,
  createSeededOperatorCommandRegistry,
  seedReservedCatalog,
  generateAliases,
  getCatalogEntryAsDraft,
  type OperatorCommandRegistry,
  type RegisterResult,
  type AliasSet,
} from "./registry"

export {
  reconcileOperatorAuditOutbox,
  runOperatorAuditMaintenance,
  startOperatorAuditMaintenance,
  DEFAULT_AUDIT_RECONCILE_INTERVAL_MS,
  DEFAULT_AUDIT_PRUNE_INTERVAL_MS,
  DEFAULT_AUDIT_RECONCILE_BUDGET,
  type AuditMaintenanceHandle,
  type MaintenanceRunResult,
  type MaintenanceError,
  type MaintenanceErrorPhase,
  type ReconcileResult,
  type StartOperatorAuditMaintenanceInput,
} from "./audit-reconcile"
export {
  createDispatcher,
  type Dispatcher,
  type DispatchOptions,
  type DispatchRequestOptions,
} from "./dispatcher"

export {
  evaluateConfirmation,
  confirmationMetadata,
  confirmationRequiredError,
  type ConfirmationDecision,
} from "./confirmation"

export {
  notImplementedHandler,
  fixtureStatusHandler,
  createHandlerMap,
  handlerResultToCommandResult,
  type OperatorCommandHandler,
  type HandlerContext,
  type HandlerMap,
  type HandlerResult,
  type MutationPlanHandlerResult,
  type QueryHandlerResult,
  type FailureHandlerResult,
} from "./handler"

export {
  FORBIDDEN_ADMIN_MODULES,
  createZeroLlmProbe,
  createForbiddenLlmPort,
  findForbiddenImports,
  assertAdminResultShape,
  type ZeroLlmProbe,
  type ForbiddenProbe,
} from "./zero-llm"

export {
  mutateAuthority,
  pruneSnapshotsForAuthority,
  requireMutationContract,
  auditOnly,
  type MutationPorts,
  type MutateAuthorityInput,
} from "./mutation"

export { createMutex, type Mutex } from "./mutex"

export {
  createFlockLockPort,
  createProcessMutexLockPort,
  type LockPort,
  type LockTryResult,
  type LockPortOptions,
} from "./ports/lock-port"

export { rejectPlaintextSecrets } from "./plaintext"

export {
  type ConfigPort,
  type ConfigEntry,
  type ConfigSnapshot,
  type CasResult,
  type SecretPort,
  type EventPort,
  type OutboxPort,
  type IdempotencyPort,
  type RollbackPort,
  type DomainPorts,
  type DomainPortName,
  DOMAIN_PORT_NAMES,
  principalRef,
  redactResultForIdempotency,
  nextConfigVersion,
  INITIAL_CONFIG_VERSION,
} from "./ports"

export * as OperatorApplication from "."
