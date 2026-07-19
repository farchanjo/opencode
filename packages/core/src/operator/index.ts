/**
 * Operator control plane shared domain (Feature 007).
 * Pure schemas, VOs, catalog, errors — no LLM/provider/session dependencies.
 */
export {
  PrincipalKind,
  PrincipalSubject,
  OperatorPrincipal,
  parsePrincipal,
  parsePrincipalKind,
  canMutate,
  isManagerView,
  isOperatorPrincipal,
  isSystemPrincipal,
  type PrincipalKind as PrincipalKindType,
  type OperatorPrincipal as OperatorPrincipalType,
  type ParseResult as PrincipalParseResult,
} from "./principal"

export {
  ScopeKind,
  OperatorScope,
  parseScope,
  parseScopeKind,
  isScopeAllowedForPrincipal,
  type ScopeKind as ScopeKindType,
  type OperatorScope as OperatorScopeType,
  type ScopeProjectContext,
} from "./scope"

export {
  CommandId,
  CommandIdPattern,
  parseCommandId,
  normalizeCommandIdInput,
  commandDomain,
  commandOperation,
  commandSegments,
  type CommandId as CommandIdType,
} from "./command-id"

export {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ErrorCode,
  OperatorError,
  isErrorCode,
  parseErrorCode,
  parseOperatorError,
  defaultRetryable,
  makeOperatorError,
  redactSecrets,
  type ErrorCode as ErrorCodeType,
  type OperatorError as OperatorErrorType,
} from "./error"

export {
  CONFIRM_OPERATION_LEAVES,
  requiresConfirmation,
  canAutoConfirm,
  confirmationDeniedReason,
  type ConfirmOperationLeaf,
} from "./confirmation"

export {
  CommandAuthority,
  OperatorCommandDescriptor,
  type CommandAuthority as CommandAuthorityType,
  type OperatorCommandDescriptor as OperatorCommandDescriptorType,
  type DescriptorDraft,
} from "./descriptor"

export {
  CommandSource,
  CommandRequest,
  CommandResult,
  Outcome,
  parseCommandRequest,
  parseCommandSource,
  successResult,
  failureResult,
  isAdminResult,
  isTranscriptLike,
  type CommandSource as CommandSourceType,
  type CommandRequest as CommandRequestType,
  type CommandResult as CommandResultType,
  type Outcome as OutcomeType,
} from "./envelope"

export { authorizeCommand, type CapabilityDecision } from "./capability"

export {
  RESERVED_CATALOG_VERSION,
  RESERVED_CATALOG,
  OPERATOR_DOMAINS,
  isReservedCommandId,
  getReservedEntry,
  listReservedIds,
  catalogVersion,
  reservedCatalogSnapshot,
  type OperatorDomain,
  type ReservedCatalogDocument,
} from "./catalog"

export {
  SecretBackend,
  SecretRef,
  parseSecretRef,
  isExactSecretRef,
  SECRET_FIELD_NAMES,
  isSecretFieldName,
  findPlaintextSecretFields,
  type SecretBackend as SecretBackendType,
  type SecretRef as SecretRefType,
} from "./secret"

export {
  SNAPSHOT_MAX_COUNT,
  SNAPSHOT_MAX_AGE_DAYS,
  AUDIT_RETENTION_DAYS,
  MS_PER_DAY,
  snapshotMaxAgeMs,
  auditRetentionMs,
  selectSnapshotsToPrune,
  selectAuditsToPrune,
} from "./retention"

export {
  AuditRecord,
  FORBIDDEN_AUDIT_KEYS,
  auditIsSecretFree,
  canonicalAuditRecord,
  stableAuditEventId,
  type AuditRecord as AuditRecordType,
} from "./audit"

export {
  OperatorAuditEvent,
  OPERATOR_AUDIT_EVENT_TYPE,
  OPERATOR_AUDIT_DURABLE_VERSION,
  EVENTV2_RETENTION_MODE,
  operatorAuditAggregateID,
  type OperatorAuditEventData,
} from "./event-definition"

export {
  OPERATOR_SLASH_PREFIX,
  parseOperatorSlash,
  isOperatorSlash,
  operatorSlashAlias,
  isReservedOperatorSlashId,
  type OperatorSlashParse,
} from "./slash"

export {
  resolveOperatorScope,
  resolveScopeForCommandId,
  resolveScopeForDescriptor,
  resolveOperatorScopeOrThrow,
  type OperatorScopeContext,
  type ScopeResolveInput,
  type ScopeResolveResult,
  type ScopeResolveOk,
  type ScopeResolveFail,
} from "./scope-resolve"

export {
  listOperatorPaletteEntries,
  listOperatorSuggestedEntries,
  listOperatorSettingsEntries,
  listAllOperatorSettingsDomains,
  buildOperatorPaletteCommands,
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  isOperatorSecretRelatedId,
  isOperatorSecretMutationId,
  OPERATOR_SETTINGS_DOMAINS,
  OPERATOR_PERSISTING_DOMAINS,
  OPERATOR_PERSISTING_VERBS,
  OPERATOR_INPUT_MODES,
  OPERATOR_TOP_TITLE,
  OPERATOR_TOP_SUBTITLE,
  type OperatorPaletteEntry,
  type OperatorDomainGroup,
  type OperatorDomainPanel,
  type OperatorVerbItem,
  type OperatorVerbSection,
  type OperatorVerbAvailability,
  type OperatorInputMode,
  type OperatorPersistenceClass,
} from "./palette"

export {
  OPERATOR_CONTROL_PLANE_FLAG,
  OPERATOR_CONTROL_PLANE_CONFIG_KEY,
  isOperatorControlPlaneEnabled,
  getOperatorFlagState,
  resolveOperatorControlPlaneFlag,
  readOperatorControlPlaneFromConfig,
  operatorUnavailableWhenFlagOff,
  type OperatorFlagState,
  type OperatorFlagSource,
  type ResolveOperatorFlagInput,
} from "./feature-flag"

export {
  checkReservedRegistrationName,
  classifyLegacyAdminName,
  dryRunLegacyMigration,
  normalizeRegistrationName,
  assertRegistrationNameAllowed,
  ReservedNameError,
  LEGACY_ADMIN_LIKE_NAMES,
  type RegistrationSource,
  type ReservedNameCheck,
  type LegacyClassification,
} from "./reserved-names"

export {
  checkOfflineCapability,
  isNetworkRequired,
  assertCatalogOfflineInvariants,
  resolveConnectivity,
  readOfflineFromConfig,
  type ConnectivityMode,
  type ResolveConnectivityInput,
} from "./offline"

export {
  validateOperatorUrl,
  validateRedirectUrl,
  validateRedirectChain,
  isBlockedIpv4,
  isBlockedIpv6,
  isBlockedAddress,
  expandIpv4Tricks,
  expandIpv6MappedIpv4,
  isValidPort,
  effectivePort,
  type SsrfProfile,
  type SsrfDecision,
  type DnsResolver,
  type ValidateUrlOptions,
} from "./ssrf"

export { createProductionDnsResolver, type LookupFn } from "./dns"

export {
  OPERATOR_OTEL_ALLOWED_KEYS,
  buildOperatorOtelAttributes,
  sanitizeOperatorOtelAttributes,
  createOperatorSpanRecorder,
  type OperatorOtelAttributes,
  type OperatorOtelKey,
  type OperatorSpanRecorder,
} from "./otel"

export * as Operator from "."
