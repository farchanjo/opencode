/**
 * Feature 008 — MCP protocol payloads (T013).
 *
 * TypeScript mirror of the shared identifiers, the reconciled closed enums (SOURCED
 * from `@opencode-ai/schema/mcp/*`), the closed 15-member `mcp.*` event vocabulary
 * (10 durable / 5 live), the operator-plane wire read models, the 30 `mcp.*` operator
 * command/query payloads across `mcp.server.*` (11), `mcp.auth.*` (4),
 * `mcp.resource.admin.*` (7), `mcp.logging.level.*` (2), `mcp.experimental.*` (3) and
 * `mcp.extension.*` (3), the `OperatorPrincipal` shape, and the typed operator error
 * unions from
 * doc/arch/sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/contracts/ports.ts.
 * The injected dependency ports (`TransportPort`/`ClockPort`/…/`SecretResolvePort`) and
 * the operator/runtime inbound port interfaces live in ./ports — this file defines only
 * the payload shapes.
 *
 * RECONCILIATION (T012/T013). The CUE corpus (`doc/arch/schemas/mcp/*.cue`), mirrored by
 * `packages/schema/src/mcp/*`, is the authority. An earlier `contracts/ports.ts` draft
 * diverged — an underscore-spelled `streamable_http`/`content_stream`, a 4-member
 * `DegradationGapCode`, a `notify_cache_only`/`semantic_reindex`/`admission_wake` policy
 * ladder, and a 16-member (12-durable/4-live) event surface with an extra
 * `mcp.subscription.fail_closed` durable member. This mirror is reconciled to CUE and
 * SOURCES every reconciled enum from `@opencode-ai/schema/mcp/*` rather than re-declaring
 * it, so the transport contract can never diverge from the wire shape: the hyphen-spelled
 * `TransportKind`/`ExperimentalFlag`, the `CapabilityGap` degradation ladder, the
 * `notify_cache`/`conditional_reread`/`reindex`/`wake` policy set, and the closed
 * 15-member vocabulary (10 durable / 5 live) with `mcp.call.cancel_requested` classified
 * **live** (its durable audit is the `mcp.call.cancelled` settlement member whose
 * `CancelOutcome` records `cancel_requested`/`unknown_remote`) and **no**
 * `mcp.subscription.fail_closed` event member (the `fail_closed` posture is a
 * `SubscriptionState` value). No payload carries a secret, token, filesystem path, or
 * unbounded body (FR32, FR34, FR48, C15, C16, C25).
 */

import type {
  CancelWirePath as SchemaCancelWirePath,
  CapabilityGap as SchemaCapabilityGap,
  ContentKind as SchemaContentKind,
  LogLevel as SchemaLogLevel,
  OutputSchemaMode as SchemaOutputSchemaMode,
  ProvenanceClass as SchemaProvenanceClass,
  TransportKind as SchemaTransportKind,
  TrustProfile as SchemaTrustProfile,
} from "@opencode-ai/schema/mcp/enums"
import type {
  CallOutcome as SchemaCallOutcome,
  CancelOutcome as SchemaCancelOutcome,
  ConnectionState as SchemaConnectionState,
  ResourceUpdatePolicy as SchemaResourceUpdatePolicy,
  ServerStatus as SchemaServerStatus,
  SubscriptionState as SchemaSubscriptionState,
  TaskStatus as SchemaTaskStatus,
  TerminalBranch as SchemaTerminalBranch,
} from "@opencode-ai/schema/mcp/enums-state"
import type { McpEventType as SchemaMcpEventType } from "@opencode-ai/schema/mcp/event-types"
import type { ExperimentalFlag as SchemaExperimentalFlag } from "@opencode-ai/schema/mcp/experimental"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/mcp/ids.cue, refs.cue)
// =============================================================================

export type ServerId = string
export type ConnectionId = string
export type SubscriptionId = string
export type ProgressToken = string
export type RequestId = string
export type TaskId = string
/** Feature 002 Process Table child id correlated on a call/task; never an OS PID (FR39). */
export type McpCallId = string
export type AuditId = string

/** Opaque secret reference minted by Feature 007 SecretPort; OAuth tokens/headers never inline plaintext (FR32, C15). */
export type SecretRef = string

/** Opaque bounded token minted by Feature 005 OutputSpool for every call/read result; never a filesystem path (FR33, C16). */
export type OutputRef = string

/** Compare-and-swap token required for version-guarded operator mutations (C25). */
export type CasToken = string

// =============================================================================
// Closed enums — SOURCED from @opencode-ai/schema/mcp/* (single vocabulary, T012)
// =============================================================================

/** Reserved-catalog command scope; mirrors `ScopeKind` in `packages/core/src/operator/catalog.ts` (C25). */
export type Scope = "project" | "global"

/** Transport kind; Streamable HTTP is preferred, legacy SSE is deprecation-labeled (FR29, FR31, C14). */
export type TransportKind = SchemaTransportKind

/**
 * The connection-lifecycle sequence plus additive terminal branches (C2). The finer
 * domain `ConnectionState` machine and the `TerminalBranch` set combine into the coarse
 * operator-facing state; the existing `Status` union stays the compatibility surface and
 * extends only additively (C2, C27).
 */
export type ConnectionState = SchemaConnectionState | SchemaTerminalBranch

/** Authoritative additive server-status union recorded on the connection (FR7, C2, C27). */
export type ServerStatus = SchemaServerStatus

/** Typed capability-gap code; `mcp_unavailable` never hard-fails the session (FR7, C1, C2). */
export type DegradationGapCode = SchemaCapabilityGap

/** Tool-annotation trust posture; `untrusted` by default, `elevated` only by operator grant (FR13a, C6). */
export type TrustProfile = SchemaTrustProfile

/** `outputSchema` validation posture; tolerant is the default, strict is a per-server opt-in (FR12, C5). */
export type OutputSchemaValidationMode = SchemaOutputSchemaMode

/** The resource-update policy ladder; `notify_cache` is the fixed default rung (FR23, FR24, C9). */
export type ResourceUpdatePolicy = SchemaResourceUpdatePolicy

/** The resource-subscription machine; `fail_closed` on lost authority (FR21, C10). */
export type SubscriptionState = SchemaSubscriptionState

/** The four per-server experimental flags, disabled by default (FR41, FR45, C18). */
export type ExperimentalFlag = SchemaExperimentalFlag

/** The standard vs task cancellation wire path selected per child (FR17, FR18, C8). */
export type CancelWirePath = SchemaCancelWirePath

/** Local cancel-settlement outcome when the remote does not acknowledge (FR17, C8). */
export type CancelOutcome = SchemaCancelOutcome

/** Tool-execution vs protocol settlement outcome (FR12, C5). */
export type CallOutcome = SchemaCallOutcome

/** Experimental Tasks lifecycle status including `input_required` (FR42, C18, C20). */
export type TaskStatus = SchemaTaskStatus

/** MCP content-envelope kind per `tools/call` / `resources/read` (FR12, FR26). */
export type ContentKind = SchemaContentKind

/** Untrusted-content provenance label applied at the context boundary (FR27, C24). */
export type ContentProvenance = SchemaProvenanceClass

/** MCP syslog-derived logging-notification level (FR28, C23). */
export type McpLogLevel = SchemaLogLevel

/** Server-initiated sampling gate outcome under per-agent `mcp:<server>:sampling` Permission (FR46, C19). */
export type SamplingDecision = "approved" | "denied" | "timeout"

// =============================================================================
// Reserved mcp.* catalog mirror (wire shape: packages/core/src/operator/catalog.ts)
// =============================================================================

/**
 * Documentation-only mirror of the 30 reserved `mcp.*` IDs at
 * `RESERVED_CATALOG_VERSION = "1.3.0"` (C25). `packages/core/src/operator/catalog.ts` is
 * the sole registration authority; this array never re-registers or diverges from it and
 * exists only to trace each operator-plane payload back to its canonical command ID
 * (11 + 4 + 7 + 2 + 3 + 3 = 30).
 */
export const RESERVED_MCP_COMMAND_IDS = [
  "mcp.server.list",
  "mcp.server.add",
  "mcp.server.update",
  "mcp.server.test",
  "mcp.server.connect",
  "mcp.server.disconnect",
  "mcp.server.reconnect",
  "mcp.server.disable",
  "mcp.server.delete",
  "mcp.server.status",
  "mcp.server.capabilities",
  "mcp.auth.start",
  "mcp.auth.finish",
  "mcp.auth.remove",
  "mcp.auth.status",
  "mcp.resource.admin.list",
  "mcp.resource.admin.templates",
  "mcp.resource.admin.read",
  "mcp.resource.admin.subscribe",
  "mcp.resource.admin.unsubscribe",
  "mcp.resource.admin.policy.show",
  "mcp.resource.admin.policy.set",
  "mcp.logging.level.show",
  "mcp.logging.level.set",
  "mcp.experimental.status",
  "mcp.experimental.enable",
  "mcp.experimental.disable",
  "mcp.extension.status",
  "mcp.extension.enable",
  "mcp.extension.disable",
] as const

export type ReservedMcpCommandId = (typeof RESERVED_MCP_COMMAND_IDS)[number]

// =============================================================================
// mcp.* event vocabulary — reconciled to CUE (15 members, 10 durable / 5 live)
// =============================================================================

/**
 * The ten durable members carry the EventV2 `durable {version, aggregate}` annotation
 * and persist for reindex/audit correlation (FR38, C3). `mcp.call.cancelled` is the
 * durable audit of a cancel outcome (its {@link CancelOutcome} records
 * `cancel_requested`/`unknown_remote`), so the live `mcp.call.cancel_requested` signal
 * loses no audit trail. `mcp.subscription.*` is exactly the two durable transitions
 * `subscribed`/`unsubscribed`; the subscription `fail_closed` posture is a
 * {@link SubscriptionState} value, not a persisted event member.
 */
export const DURABLE_MCP_EVENT_TYPES = [
  "mcp.server.status",
  "mcp.server.capabilities_changed",
  "mcp.tools_changed",
  "mcp.resources_changed",
  "mcp.resource_updated",
  "mcp.call.settled",
  "mcp.call.cancelled",
  "mcp.task.settled",
  "mcp.subscription.subscribed",
  "mcp.subscription.unsubscribed",
] as const satisfies ReadonlyArray<SchemaMcpEventType>

/**
 * The five live members omit `durable` (no sequence, no replay); MAY be dropped under
 * `allBounded` load without affecting durable connection/catalog/subscription state (C3).
 * `mcp.call.cancel_requested` is the live pre-settlement cancel signal.
 */
export const LIVE_MCP_EVENT_TYPES = [
  "mcp.call.started",
  "mcp.call.progress",
  "mcp.call.cancel_requested",
  "mcp.task.status",
  "mcp.log",
] as const satisfies ReadonlyArray<SchemaMcpEventType>

export type DurableMcpEventType = (typeof DURABLE_MCP_EVENT_TYPES)[number]
export type LiveMcpEventType = (typeof LIVE_MCP_EVENT_TYPES)[number]

/** The closed 15-member `mcp.*` event vocabulary (FR38, C3). No event carries content, URIs, or paths. */
export type McpEventType = SchemaMcpEventType

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to authorize `mcp.*` admin-plane actions (FR48, C25). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// Wire read models — server profile, negotiated capabilities, content
// =============================================================================

/** SSOT server record; never embeds a secret — `secretRef` is opaque (FR32, C15, C27). */
export interface McpServerProfile {
  readonly id: ServerId
  readonly version: number
  readonly name: string
  readonly transportKind: TransportKind
  readonly endpoint: string // URL for remote, command for stdio; never a raw credential
  readonly scope: Scope
  readonly trustProfile: TrustProfile
  readonly connectionState: ConnectionState
  readonly secretRef?: SecretRef
  readonly enabled: boolean
  readonly sseDeprecationLabel: boolean // true when this connection fell back to legacy SSE (C14)
  readonly createdAt: string // ISO-8601
  readonly updatedAt: string // ISO-8601
  readonly auditId: AuditId
}

/** Recorded negotiated server capabilities; an unadvertised capability is never exercised (FR7, FR8, C2). */
export interface NegotiatedCapabilitySet {
  readonly serverId: ServerId
  readonly protocolVersion: string // e.g. "2025-11-25"; negotiated downgrade recorded verbatim (C1)
  readonly tools: boolean
  readonly toolsListChanged: boolean
  readonly resources: boolean
  readonly resourcesSubscribe: boolean
  readonly resourcesListChanged: boolean
  readonly prompts: boolean
  readonly promptsListChanged: boolean
  readonly logging: boolean
  readonly roots: boolean
  readonly experimentalTasks: boolean // advertised only when mcp.experimental "tasks" is operator-enabled (C18)
  readonly experimentalContentStream: boolean // `experimental/opencode.contentStream` (C18)
  readonly recordedAt: string // ISO-8601
}

/** One typed degradation-gap observation attached to a status/capabilities query (FR7, C1, C2). */
export interface DegradationGap {
  readonly code: DegradationGapCode
  readonly reason: string
}

/** One paginated `tools/list` entry; `defs[server]` shape preserved by the catalog walker (FR10, C4, C6). */
export interface McpToolCatalogEntry {
  readonly serverId: ServerId
  readonly name: string
  readonly description?: string
  readonly outputSchemaValidationMode: OutputSchemaValidationMode
  readonly annotationsTrust: TrustProfile
}

/** Runtime resource descriptor surfaced through the canonical adapter under Permission (FR19, C10, C12). */
export interface McpResourceDescriptor {
  readonly serverId: ServerId
  readonly uri: string
  readonly name?: string
  readonly mimeType?: string
  readonly subscribable: boolean // server declares `resources.subscribe` (C10)
}

/** Runtime resource-template descriptor mirrored the same way as {@link McpResourceDescriptor} (FR19). */
export interface McpResourceTemplateDescriptor {
  readonly serverId: ServerId
  readonly uriTemplate: string
  readonly name?: string
  readonly mimeType?: string
}

/** Per-server resource-update policy settings; `notify_cache` is the fixed default rung (FR23, FR24, C9). */
export interface ResourceUpdatePolicySettings {
  readonly serverId: ServerId
  readonly rung: ResourceUpdatePolicy
  readonly semanticReindexOptIn: boolean // requires a Feature 006 classification decision (C21)
  readonly wakeAdmissionOptIn: boolean // gated by Feature 001/002/003 admission at runtime (C22)
}

/**
 * Every `tools/call` / `resources/read` result mirror. UI and LLM receive a bounded
 * preview plus {@link OutputRef} only; `previewBytes` is never a filesystem path (FR33,
 * FR34, C16, C17). A `resource_link` stays a reference until an explicit
 * policy/Permission/budget-gated fetch (C11).
 */
export interface McpContentEnvelope {
  readonly kind: ContentKind
  readonly outputRef: OutputRef
  readonly previewBytes: number
  readonly mimeType?: string
  readonly provenance: ContentProvenance
  readonly ramSpillApplied: boolean // true once the SDK's in-RAM final parse is spilled post-parse (C16)
}

/** Bounded progress metadata; wire `progress` MUST increase per {@link ProgressToken} (FR14, FR15, C7). */
export interface McpProgressEvent {
  readonly progressToken: ProgressToken
  readonly progress: number
  readonly total?: number
  readonly message?: string
  readonly mcpCallId: McpCallId
}

/** Server-initiated sampling request gated behind `mcp:<server>:sampling` Permission (FR46, C19). */
export interface McpSamplingRequest {
  readonly serverId: ServerId
  readonly requestId: RequestId
  readonly agentId: string
  readonly modelRef: string
}

/** Sampling gate outcome; approval passes unchanged through Feature 001 Smart/budget/LangLock/privacy (FR46, C19). */
export interface McpSamplingResult {
  readonly decision: SamplingDecision
  readonly outputRef?: OutputRef
  readonly auditId: AuditId
}

/** Elicitation request; always operator-surfaced, never silently answered by the model (FR47, C20). */
export interface McpElicitationRequest {
  readonly serverId: ServerId
  readonly requestId: RequestId
  readonly promptSummary: string // content-free summary safe for UI/audit
  readonly sensitiveMode: boolean // blocks model-mediated answers outright when true (C20)
}

/** Operator elicitation response; `input_required` is a lifecycle prompt, never partial content (FR47, C20). */
export interface McpElicitationResult {
  readonly requestId: RequestId
  readonly operatorAnswered: boolean
  readonly auditId: AuditId
}

// =============================================================================
// mcp.server.* payloads (11 IDs) (FR29-FR31, FR48-FR50, C2, C14, C25)
// =============================================================================

export interface ListServersInput {
  readonly scope: Scope
  readonly scopeId: string
}
export interface ListServersOutput {
  readonly servers: readonly McpServerProfile[]
}

export interface AddServerInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly name: string
  readonly transportKind: TransportKind
  readonly endpoint: string
  readonly secretRef?: SecretRef
  readonly principal: OperatorPrincipal
}
export interface AddServerOutput {
  readonly server: McpServerProfile
  readonly auditId: AuditId
}

export interface UpdateServerInput {
  readonly id: ServerId
  readonly expectedVersion: number
  readonly patch: Partial<Pick<McpServerProfile, "name" | "endpoint" | "trustProfile" | "enabled">>
  readonly casToken: CasToken
  readonly principal: OperatorPrincipal
}
export interface UpdateServerOutput {
  readonly server: McpServerProfile
  readonly auditId: AuditId
}

export interface TestServerInput {
  readonly id: ServerId
  readonly principal: OperatorPrincipal
}
export interface TestServerOutput {
  readonly reachable: boolean
  readonly latencyMs: number
  readonly transportKind: TransportKind
}

export interface ConnectServerInput {
  readonly id: ServerId
  readonly principal: OperatorPrincipal
}
export interface ConnectServerOutput {
  readonly server: McpServerProfile
  readonly capabilities?: NegotiatedCapabilitySet
  readonly degradationGap?: DegradationGap
  readonly auditId: AuditId
}

export interface DisconnectServerInput {
  readonly id: ServerId
  readonly principal: OperatorPrincipal
}
export interface DisconnectServerOutput {
  readonly server: McpServerProfile
  readonly auditId: AuditId
}

export interface ReconnectServerInput {
  readonly id: ServerId
  readonly principal: OperatorPrincipal
}
export interface ReconnectServerOutput {
  readonly server: McpServerProfile
  readonly capabilitiesChanged: boolean // emits `mcp.server.capabilities_changed` on a recorded-set diff (C2)
  readonly auditId: AuditId
}

export interface DisableServerInput {
  readonly id: ServerId
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}
export interface DisableServerOutput {
  readonly server: McpServerProfile
  readonly auditId: AuditId
}

export interface DeleteServerInput {
  readonly id: ServerId
  readonly expectedVersion: number
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}
export interface DeleteServerOutput {
  readonly id: ServerId
  readonly auditId: AuditId
}

export interface ServerStatusInput {
  readonly id: ServerId
}
export interface ServerStatusOutput {
  readonly server?: McpServerProfile
  readonly degradationGap?: DegradationGap
}

export interface ServerCapabilitiesInput {
  readonly id: ServerId
}
export interface ServerCapabilitiesOutput {
  readonly capabilities?: NegotiatedCapabilitySet
}

export type ServerError =
  | { readonly type: "not_found"; readonly id: ServerId }
  | { readonly type: "mcp_unavailable"; readonly reason: string }
  | { readonly type: "version_conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly type: "confirmation_required" }
  | { readonly type: "stdio_command_not_allowlisted"; readonly command: string }
  | { readonly type: "ssrf_blocked"; readonly host: string }
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// mcp.auth.* payloads (4 IDs) (FR32, C15)
// =============================================================================

export interface AuthStartInput {
  readonly serverId: ServerId
  readonly principal: OperatorPrincipal
}
export interface AuthStartOutput {
  readonly authorizationUrl: string
  readonly oauthState: string
}

export interface AuthFinishInput {
  readonly serverId: ServerId
  readonly oauthState: string
  readonly callbackParams: string // opaque callback query string; never logged verbatim
  readonly principal: OperatorPrincipal
}
export interface AuthFinishOutput {
  readonly secretRef: SecretRef
  readonly auditId: AuditId
}

export interface AuthRemoveInput {
  readonly serverId: ServerId
  readonly principal: OperatorPrincipal
}
export interface AuthRemoveOutput {
  readonly serverId: ServerId
  readonly auditId: AuditId
}

export interface AuthStatusInput {
  readonly serverId: ServerId
}
export type McpAuthStatus = "authenticated" | "expired" | "not_authenticated"
export interface AuthStatusOutput {
  readonly authStatus: McpAuthStatus
}

export type AuthError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "oauth_state_mismatch" }
  | { readonly type: "secret_backend_unavailable" }
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// mcp.resource.admin.* payloads (7 IDs) (FR20-FR26, C9, C10, C12, C25)
// =============================================================================

export interface ResourceAdminListInput {
  readonly serverId: ServerId
  readonly principal: OperatorPrincipal
}
export interface ResourceAdminListOutput {
  readonly resources: readonly McpResourceDescriptor[]
}
export interface ResourceAdminTemplatesOutput {
  readonly templates: readonly McpResourceTemplateDescriptor[]
}

export interface ResourceAdminReadInput {
  readonly serverId: ServerId
  readonly uri: string
  readonly principal: OperatorPrincipal
}
export interface ResourceAdminReadOutput {
  readonly content: McpContentEnvelope
  readonly auditId: AuditId // operator-plane read creates an admin audit record, unlike the runtime plane (AC29)
}

export interface ResourceSubscribeInput {
  readonly serverId: ServerId
  readonly uri: string
  readonly principal: OperatorPrincipal
}
export interface ResourceSubscribeOutput {
  readonly subscriptionId: SubscriptionId
  readonly state: SubscriptionState
  readonly auditId: AuditId
}

export interface ResourcePolicyShowInput {
  readonly serverId: ServerId
}
export interface ResourcePolicyShowOutput {
  readonly policy: ResourceUpdatePolicySettings
}

export interface ResourcePolicySetInput {
  readonly serverId: ServerId
  readonly policy: ResourceUpdatePolicySettings
  readonly principal: OperatorPrincipal
}
export interface ResourcePolicySetOutput {
  readonly policy: ResourceUpdatePolicySettings
  readonly auditId: AuditId
}

export type ResourceAdminError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "capability_not_advertised" }
  | { readonly type: "fail_closed"; readonly reason: string }
  | { readonly type: "uri_not_allowlisted"; readonly scheme: string }
  | { readonly type: "cross_project_denied" }
  | { readonly type: "reindex_not_opted_in" }
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// mcp.logging.level.* payloads (2 IDs) (FR28, C23)
// =============================================================================

export interface LoggingLevelShowInput {
  readonly serverId: ServerId
}
export interface LoggingLevelShowOutput {
  readonly level: McpLogLevel
}

export interface LoggingLevelSetInput {
  readonly serverId: ServerId
  readonly level: McpLogLevel
  readonly principal: OperatorPrincipal
}
export interface LoggingLevelSetOutput {
  readonly level: McpLogLevel
  readonly auditId: AuditId
}

export type LoggingError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "capability_not_advertised" }
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// mcp.experimental.* payloads (3 IDs) (FR41, FR45, C18)
// =============================================================================

export interface ExperimentalFlagState {
  readonly serverId: ServerId
  readonly flag: ExperimentalFlag
  readonly enabled: boolean
}

export interface ExperimentalStatusInput {
  readonly serverId: ServerId
}
export interface ExperimentalStatusOutput {
  readonly flags: readonly ExperimentalFlagState[]
}

export interface ExperimentalToggleInput {
  readonly serverId: ServerId
  readonly flag: ExperimentalFlag
  readonly principal: OperatorPrincipal
}
export interface ExperimentalToggleOutput {
  readonly flag: ExperimentalFlagState
  readonly auditId: AuditId
}

export type ExperimentalError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "capability_not_advertised"; readonly flag: ExperimentalFlag }
  | { readonly type: "rollout_order_violation"; readonly flag: ExperimentalFlag } // tasks->sampling->elicitation->content-stream (C18)
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// mcp.extension.* payloads (3 IDs) (FR45, C18; namespaced content-stream extension)
// =============================================================================

export interface ExtensionStatusInput {
  readonly serverId: ServerId
}
export interface ExtensionStatusOutput {
  readonly enabled: boolean
  readonly capabilityString: "experimental/opencode.contentStream"
}

export interface ExtensionToggleInput {
  readonly serverId: ServerId
  readonly principal: OperatorPrincipal
}
export interface ExtensionToggleOutput {
  readonly enabled: boolean
  readonly auditId: AuditId
}

export type ExtensionError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "capability_not_negotiated" } // server must negotiate the namespaced string first (C18)
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// Runtime data-plane payloads (NOT reserved mcp.* IDs) (FR10-FR19, C4, C8, C16)
// =============================================================================

export type CatalogRefreshTrigger = "connect" | "list_changed" | "manual"

export interface CatalogRefreshInput {
  readonly serverId: ServerId
  readonly trigger: CatalogRefreshTrigger
  readonly cursor?: string
}
export interface CatalogRefreshOutput {
  readonly entries: readonly McpToolCatalogEntry[]
  readonly nextCursor?: string
  readonly guardTripped: boolean // duplicate/non-advancing cursor or max-page breach (C4)
}

export type CatalogError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "cursor_guard_tripped"; readonly cursor: string }
  | { readonly type: "max_page_exceeded"; readonly pageCount: number }
  | { readonly type: "guard_tripped"; readonly reason: string }
  | { readonly type: "mcp_unavailable"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export interface McpCallInput {
  readonly serverId: ServerId
  readonly toolName: string
  readonly progressToken?: ProgressToken
  readonly wirePath: CancelWirePath
}
export interface McpCallOutput {
  readonly mcpCallId: McpCallId
  readonly envelope: McpContentEnvelope
  readonly isError: boolean // tool-execution error, distinct from a protocol error (C5)
  readonly structuredContentValid?: boolean // false only under tolerant-mode mismatch (C5)
}

export interface McpReadResourceInput {
  readonly serverId: ServerId
  readonly uri: string
  readonly viaResourceLink: boolean // true when this read fulfills a lazy resource_link fetch (C11)
}
export interface McpReadResourceOutput {
  readonly mcpCallId: McpCallId
  readonly envelope: McpContentEnvelope
}

export interface McpCancelInput {
  readonly mcpCallId: McpCallId
  readonly wirePath: CancelWirePath
}
export interface McpCancelOutput {
  readonly outcome: CancelOutcome
}

export type ContentError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "permission_denied"; readonly pattern: string }
  | { readonly type: "uri_not_allowlisted"; readonly scheme: string }
  | { readonly type: "mime_not_allowed"; readonly mimeType: string }
  | { readonly type: "size_limit_exceeded"; readonly bytes: number }
  | { readonly type: "decompression_bomb_rejected" }
  | { readonly type: "budget_exceeded" }
  | { readonly type: "unknown_remote" } // unacknowledged remote cancel; recorded as the durable audit (C8)
  | { readonly type: "isError"; readonly reason: string }
  | { readonly type: "mcp_unavailable"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export type InteractionError =
  | { readonly type: "flag_disabled"; readonly flag: ExperimentalFlag }
  | { readonly type: "permission_denied"; readonly pattern: string }
  | { readonly type: "sensitive_mode_blocked" }
  | { readonly type: "budget_exceeded" }
  | { readonly type: "timeout" }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
