/**
 * Feature 008 — Application Ports (Complete MCP Client Tools and Resources
 * Lifecycle)
 *
 * These interfaces define the inbound ports owned by Feature 008. They are
 * implemented by the domain lifecycle engine (`packages/core/src/mcp/**`)
 * and application adapters (`packages/opencode/src/mcp/**` reworked in
 * place, `packages/opencode/src/operator/mcp/**`), and are consumed by
 * Feature 007 (sole registry/auth/CAS/audit authority for the reserved
 * `mcp.*` catalog at `RESERVED_CATALOG_VERSION = "1.3.0"`), Feature 002
 * (Process Table child per call/task, cancel root tree, EventBus, progress
 * UI), Feature 005 (OutputSpool/OutputRef for every call/read), Feature 001
 * (Smart routing/budgets/OTEL that sampling and reindex triggers may never
 * bypass), Feature 004 (LangLock external-content exemption), Feature 006
 * (opt-in resource semantic-reindex trigger consumer), and Feature 009
 * (durable `mcp.tools_changed` / `mcp.resources_changed` reindex seam).
 * `packages/opencode/src/mcp/index.ts` (`MCP.Service`), `catalog.ts`
 * (`McpCatalog`), and `packages/core/src/operator/catalog.ts` (the reserved
 * registry) remain sources of truth; this file never re-registers a
 * reserved id and never redefines the `Status` union or the `defs[server]`
 * shape those seams already own (C25, C27).
 *
 * **Dual-plane grammar (single authority model, no dual authority).**
 * {@link ServerLifecyclePort}, {@link AuthPort}, {@link ResourceAdminPort},
 * {@link LoggingPort}, {@link ExperimentalPort}, and {@link ExtensionPort}
 * back the 30 reserved Feature 007 `mcp.*` operator command IDs exactly
 * (11 + 4 + 7 + 2 + 3 + 3 = 30, `RESERVED_CATALOG_VERSION = "1.3.0"`); they
 * are operator-only, zero-token, zero-transcript, and never reachable by
 * the LLM, ToolRegistry, MCP, custom commands, or `session.command` (FR48,
 * C25). {@link CatalogPort}, {@link ContentPort}, and {@link InteractionPort}
 * back the **runtime data plane** instead — the canonical adapter the LLM
 * calls under `mcp:<server>:*` Permission (`tools/call`,
 * `list_mcp_resources`, `read_mcp_resource`, sampling/elicitation gates);
 * they are never registered as Feature 007 command IDs and never create
 * management-authority audit records (FR19, FR50, AC29).
 *
 * Domain: the fixed connection-lifecycle state machine
 * (`configured -> connecting -> negotiating -> recording -> connected`,
 * with `reconnecting`/backoff/resume and the additive terminal branches
 * `disabled`/`failed`/`needs_auth`/`needs_client_registration`, C2), the
 * cursor-paginated tool-catalog refresh with duplicate-cursor guard and
 * max-page fail-closed (C4), the resource-subscription machine
 * (`unsubscribed -> subscribing -> subscribed -> unsubscribing`, capability
 * plus operator authority, fail-closed, C10), the notify+cache-only
 * resource-update policy ladder with opt-in re-read/reindex/wake (C9, C21,
 * C22), the standard-vs-task cancel wire-path split (C8), and the durable/
 * live `mcp.*` event vocabulary with the single canonical
 * `mcp.tools_changed` spelling (C3, no dual spelling survives).
 *
 * Wire-shape source of truth: `doc/arch/schemas/mcp/*.cue` (capability.cue,
 * connection.cue, events.cue, policy.cue, uri-allowlist.cue,
 * experimental.cue, spool-descriptor.cue — plan.md "New and reworked module
 * tree target", forthcoming in the tasks phase). This file is the
 * TypeScript mirror; it does not redefine payload schemas owned by
 * `packages/schema/src/mcp/*` and it does not redefine or diverge from the
 * reserved catalog owned by `packages/core/src/operator/catalog.ts` (C25).
 */

import type { Effect } from "effect"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/mcp/*.cue)
// =============================================================================

export type ServerId = string
export type SubscriptionId = string
export type ProgressToken = string
export type RequestId = string
export type McpCallId = string // Feature 002 Process Table child id (FR39)
export type AuditId = string

/** Opaque secret reference minted by Feature 007 SecretPort; OAuth tokens/headers never inline plaintext (FR32, C15). */
export type SecretRef = string

/** Opaque bounded token minted by Feature 005 OutputSpool for every call/read result; never a filesystem path (FR33, C16). */
export type OutputRef = string

/** Compare-and-swap token required for `mcp.server.update`/`mcp.resource.admin.policy.set` version-guarded mutations. */
export type CasToken = string

// =============================================================================
// Closed enums (wire shape: doc/arch/schemas/mcp/{connection,capability,policy,experimental}.cue)
// =============================================================================

/** Reserved-catalog command scope; mirrors `ScopeKind` in `packages/core/src/operator/catalog.ts` (C25). */
export type Scope = "project" | "global"

/**
 * The fixed connection-lifecycle sequence plus additive terminal branches
 * (plan.md "State machines" -> "Connection lifecycle", C2). `configured`
 * follows config load; `connecting`/`negotiating`/`recording` are the
 * connect-transport / initialize-negotiate / capability-exchange steps;
 * `connected` is reached only once capabilities are recorded.
 * `reconnecting` covers a Streamable HTTP drop under bounded backoff with
 * resume/`Last-Event-ID` (C14); a stdio drop restarts through
 * `connecting` again under lifecycle control, never `reconnecting`. The
 * existing coarse `Status` union (`connected|disabled|failed|needs_auth|
 * needs_client_registration`) in `packages/opencode/src/mcp/index.ts`
 * remains the compatibility surface and extends only additively; this enum
 * is the finer-grained domain state the core lifecycle engine transitions
 * through to reach it (C2, C27).
 */
export type ConnectionState =
  | "configured"
  | "connecting"
  | "negotiating"
  | "recording"
  | "connected"
  | "reconnecting"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"

/** Transport kind; Streamable HTTP is preferred for new connections, legacy SSE is deprecation-labeled (C14). */
export type TransportKind = "stdio" | "streamable_http" | "sse"

/**
 * Typed capability-gap codes recorded when an optional wire feature is
 * unsupported by the SDK or unadvertised by the server; the session
 * continues rather than hard-failing (C1, C2, FR7).
 */
export type DegradationGapCode =
  | "mcp_unavailable"
  | "capability_not_advertised"
  | "sdk_feature_unsupported"
  | "session_expired"

/**
 * Tool-annotation trust posture (FR13a, C6). Annotations are `untrusted` by
 * default and never relied on as safety guarantees; only `elevated` — an
 * explicit operator server-trust-profile grant — lets annotations inform
 * UI hints or policy gating.
 */
export type TrustProfile = "untrusted" | "elevated"

/** `outputSchema` validation posture; tolerant is the default, strict is a per-server operator opt-in (C5). */
export type OutputSchemaValidationMode = "tolerant" | "strict"

/**
 * The resource-update policy ladder applied to a coalesced
 * `resources/updated` batch under the C9 default (plan.md "Resource
 * subscription lifecycle"; FR23, FR24). `notify_cache_only` is the fixed
 * default and requires no opt-in; each higher rung is a separate per-server
 * operator opt-in and never implied by the rung below it (C9, C21, C22).
 */
export type ResourceUpdatePolicy = "notify_cache_only" | "conditional_reread" | "semantic_reindex" | "admission_wake"

/**
 * The resource-subscription machine (plan.md "Resource subscription
 * lifecycle", C10). `fail_closed` is reached on an unauthorized subscribe
 * attempt or a lost server capability, never a silent downgrade to
 * unsubscribed.
 */
export type SubscriptionState = "unsubscribed" | "subscribing" | "subscribed" | "unsubscribing" | "fail_closed"

/**
 * The four separate per-server experimental flags, disabled by default,
 * enabled in rollout order `tasks -> sampling -> elicitation ->
 * content_stream`; a server enable never implies another flag or server
 * (C18, FR41, FR45).
 */
export type ExperimentalFlag = "tasks" | "sampling" | "elicitation" | "content_stream"

/** Standard vs task-augmented cancel wire path (FR17, FR18, C8). */
export type CancelKind = "standard" | "task_augmented"

/** Local cancel-settlement outcome when the remote does not acknowledge (FR17, C8). */
export type CancelOutcome = "cancelled" | "cancel_requested" | "unknown_remote"

/** Server-initiated sampling gate outcome under per-agent `mcp:<server>:sampling` Permission (FR46, C19). */
export type SamplingDecision = "approved" | "denied" | "timeout"

/** MCP content-envelope kind per `tools/call` / `resources/read` (FR12, FR26). */
export type ContentKind = "text" | "image" | "audio" | "resource" | "resource_link"

/** Untrusted-content provenance label applied at the context boundary (C24, FR27, Security). */
export type ContentProvenance = "trusted_operator" | "untrusted_external"

/** Stable error codes shared across ports; never a query, URI, or credential (Security "Error exposure"). */
export type StableErrorCode =
  | "not_found"
  | "denied"
  | "invalid_argument"
  | "unavailable"
  | "cas_conflict"
  | "confirmation_required"
  | "not_implemented"

// =============================================================================
// Reserved mcp.* catalog mirror (wire shape: packages/core/src/operator/catalog.ts)
// =============================================================================

/**
 * Documentation-only mirror of the 30 reserved `mcp.*` IDs at
 * `RESERVED_CATALOG_VERSION = "1.3.0"` (C25). `packages/core/src/operator/catalog.ts`
 * is the sole registration authority; this array never re-registers or
 * diverges from it and exists only to trace each operator-plane port
 * method back to its canonical command ID. The runtime data plane
 * ({@link CatalogPort}, {@link ContentPort}, {@link InteractionPort}) never
 * registers any of these IDs (FR48, FR50).
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
// mcp.* event vocabulary (wire shape: doc/arch/schemas/mcp/events.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and persist for reindex/audit correlation (C3).
 *
 * Reconciliation (resolved; authority = the CUE corpus `event-types.cue` +
 * `events-live.cue`, mirrored by `data-model.md`): the closed vocabulary is
 * **15 members — 10 durable / 5 live**. `mcp.call.cancel_requested` is a
 * **live** pre-settlement signal, not durable: the unacknowledged-remote
 * outcome C8 requires for audit is recorded by the **durable**
 * `mcp.call.cancelled` settlement member, whose {@link CancelOutcome} carries
 * `cancel_requested` / `unknown_remote`, so keeping the request signal live
 * loses no audit trail while matching FR38's normative set. `mcp.subscription.*`
 * is exactly the two durable audit transitions `subscribed` / `unsubscribed`;
 * the subscription `fail_closed` posture is a {@link SubscriptionState} value,
 * not a separately persisted event member. This module now matches CUE and the
 * data-model exactly (no dual authority); T012 re-derives these members from the
 * `packages/schema/src/mcp` enums and T041 pins the parity.
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
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay); MAY be
 * dropped under `allBounded` load without affecting durable connection/
 * catalog/subscription state (C3). `mcp.call.cancel_requested` is the live
 * pre-settlement cancel signal (its durable audit is `mcp.call.cancelled`).
 */
export const LIVE_MCP_EVENT_TYPES = ["mcp.call.started", "mcp.call.progress", "mcp.call.cancel_requested", "mcp.task.status", "mcp.log"] as const

export type DurableMcpEventType = (typeof DURABLE_MCP_EVENT_TYPES)[number]
export type LiveMcpEventType = (typeof LIVE_MCP_EVENT_TYPES)[number]

/** The closed `mcp.*` event vocabulary (FR38, C3). No event carries full content, URIs, or paths. */
export type McpEventType = DurableMcpEventType | LiveMcpEventType

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to authorize Feature 008 `mcp.*` admin-plane actions (FR48, C25). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// Wire mirrors — server profile, negotiated capabilities
// (wire shape: doc/arch/schemas/mcp/{connection,capability}.cue)
// =============================================================================

/** SSOT server record; never embeds a secret — `secretRef` is opaque (FR29-FR32, C14, C15, C27). */
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

/** Recorded negotiated server capabilities for operator query and runtime gating; an unadvertised capability is never exercised (FR7, FR8, C2). */
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

// =============================================================================
// Wire mirrors — tool catalog, resources
// (wire shape: doc/arch/schemas/mcp/policy.cue)
// =============================================================================

/** One paginated `tools/list` entry; `defs[server]` shape preserved by the catalog walker (FR10-FR13a, C4, C6). */
export interface McpToolCatalogEntry {
  readonly serverId: ServerId
  readonly name: string
  readonly description?: string
  readonly outputSchemaValidationMode: OutputSchemaValidationMode
  readonly annotationsTrust: TrustProfile // gating posture applied to this entry's annotations (C6)
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

/** Per-server resource-update policy settings; `notify_cache_only` is the fixed default rung (FR23, FR24, C9, C21, C22). */
export interface ResourceUpdatePolicySettings {
  readonly serverId: ServerId
  readonly rung: ResourceUpdatePolicy
  readonly semanticReindexOptIn: boolean // requires a Feature 006 classification decision (C21)
  readonly wakeAdmissionOptIn: boolean // gated by Feature 001/002/003 admission at runtime (C22)
}

// =============================================================================
// Wire mirrors — content envelope, progress
// (wire shape: doc/arch/schemas/mcp/spool-descriptor.cue)
// =============================================================================

/**
 * Every `tools/call` and `resources/read` result mirror. UI and LLM receive
 * a bounded preview plus {@link OutputRef} only; `previewBytes` is never a
 * filesystem path (FR33-FR36, C16, C17). `resource_link` stays a reference
 * until an explicit policy/Permission/budget-gated fetch (C11).
 */
export interface McpContentEnvelope {
  readonly kind: ContentKind
  readonly outputRef: OutputRef
  readonly previewBytes: number
  readonly mimeType?: string
  readonly provenance: ContentProvenance
  readonly ramSpillApplied: boolean // true once the SDK's in-RAM final parse is spilled post-parse (C16)
}

/** Bounded progress metadata; wire `progress` MUST increase per {@link ProgressToken} (FR14-FR16a, C7). */
export interface McpProgressEvent {
  readonly progressToken: ProgressToken
  readonly progress: number
  readonly total?: number
  readonly message?: string
  readonly mcpCallId: McpCallId // Feature 002 Process Table child correlation (FR39)
}

// =============================================================================
// Wire mirrors — sampling, elicitation
// (wire shape: doc/arch/schemas/mcp/experimental.cue)
// =============================================================================

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
  readonly outputRef?: OutputRef // populated only when decision is "approved"
  readonly auditId: AuditId
}

/** Elicitation request; always operator-surfaced, never silently answered by the model (FR47, C20). */
export interface McpElicitationRequest {
  readonly serverId: ServerId
  readonly requestId: RequestId
  readonly promptSummary: string // content-free summary safe for UI/audit
  readonly sensitiveMode: boolean // blocks model-mediated answers outright when true (C20)
}

/** Operator elicitation response; `input_required` is a lifecycle prompt, never partial tool content (FR47, C20). */
export interface McpElicitationResult {
  readonly requestId: RequestId
  readonly operatorAnswered: boolean
  readonly auditId: AuditId
}

// =============================================================================
// ServerLifecyclePort — mcp.server.* (FR29-FR31, FR48-FR50, C2, C14, C25)
// =============================================================================

/**
 * Backs the reserved `mcp.server.list|add|update|test|connect|disconnect|
 * reconnect|disable|delete|status|capabilities` operator commands (11
 * IDs), registered via Feature 007. Operator-only; zero tokens, zero
 * transcript (FR49).
 */
export interface ServerLifecyclePort {
  readonly list: (input: ListServersInput) => Effect.Effect<ListServersOutput, ServerError>
  readonly add: (input: AddServerInput) => Effect.Effect<AddServerOutput, ServerError>
  readonly update: (input: UpdateServerInput) => Effect.Effect<UpdateServerOutput, ServerError>
  readonly test: (input: TestServerInput) => Effect.Effect<TestServerOutput, ServerError>
  readonly connect: (input: ConnectServerInput) => Effect.Effect<ConnectServerOutput, ServerError>
  readonly disconnect: (input: DisconnectServerInput) => Effect.Effect<DisconnectServerOutput, ServerError>
  /** Re-runs negotiation; emits `mcp.server.capabilities_changed` when the recorded set differs (C2). */
  readonly reconnect: (input: ReconnectServerInput) => Effect.Effect<ReconnectServerOutput, ServerError>
  readonly disable: (input: DisableServerInput) => Effect.Effect<DisableServerOutput, ServerError>
  readonly delete: (input: DeleteServerInput) => Effect.Effect<DeleteServerOutput, ServerError>
  readonly status: (input: ServerStatusInput) => Effect.Effect<ServerStatusOutput, ServerError>
  readonly capabilities: (input: ServerCapabilitiesInput) => Effect.Effect<ServerCapabilitiesOutput, ServerError>
}

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
  readonly capabilitiesChanged: boolean
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
  | { readonly type: "mcp_unavailable"; readonly reason: string } // guards C1, C2 typed capability gap
  | { readonly type: "version_conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly type: "confirmation_required" } // guards delete, C15
  | { readonly type: "stdio_command_not_allowlisted"; readonly command: string } // guards Security
  | { readonly type: "ssrf_blocked"; readonly host: string } // guards C12, Security
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// AuthPort — mcp.auth.* (FR32, C15)
// =============================================================================

/**
 * Backs the reserved `mcp.auth.start|finish|remove|status` operator
 * commands (4 IDs). OAuth tokens/headers/secrets resolve through Feature
 * 007 SecretRefs only; no plaintext in args, history, output, config JSON,
 * or plain audit (C15).
 */
export interface AuthPort {
  readonly start: (input: AuthStartInput) => Effect.Effect<AuthStartOutput, AuthError>
  readonly finish: (input: AuthFinishInput) => Effect.Effect<AuthFinishOutput, AuthError>
  readonly remove: (input: AuthRemoveInput) => Effect.Effect<AuthRemoveOutput, AuthError>
  readonly status: (input: AuthStatusInput) => Effect.Effect<AuthStatusOutput, AuthError>
}

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
  | { readonly type: "secret_backend_unavailable" } // guards C15
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ResourceAdminPort — mcp.resource.admin.* (FR20-FR26, C9, C10, C12, C25)
// =============================================================================

/**
 * Backs the reserved `mcp.resource.admin.list|templates|read|subscribe|
 * unsubscribe|policy.show|policy.set` operator commands (7 IDs) — the
 * **only** human-facing resource control surface. An operator-plane `read`
 * creates an admin audit record; the runtime-plane {@link ContentPort#readResource}
 * does not (AC29, C10, C25). The LLM never subscribes.
 */
export interface ResourceAdminPort {
  readonly list: (input: ResourceAdminListInput) => Effect.Effect<ResourceAdminListOutput, ResourceAdminError>
  readonly templates: (
    input: ResourceAdminListInput,
  ) => Effect.Effect<ResourceAdminTemplatesOutput, ResourceAdminError>
  /** Operator-plane read; creates an admin audit record, unlike the runtime plane (AC29). */
  readonly read: (input: ResourceAdminReadInput) => Effect.Effect<ResourceAdminReadOutput, ResourceAdminError>
  /** Requires server `resources.subscribe` capability; the LLM never calls this (C10). */
  readonly subscribe: (input: ResourceSubscribeInput) => Effect.Effect<ResourceSubscribeOutput, ResourceAdminError>
  readonly unsubscribe: (
    input: ResourceSubscribeInput,
  ) => Effect.Effect<ResourceSubscribeOutput, ResourceAdminError>
  readonly policyShow: (input: ResourcePolicyShowInput) => Effect.Effect<ResourcePolicyShowOutput, ResourceAdminError>
  readonly policySet: (input: ResourcePolicySetInput) => Effect.Effect<ResourcePolicySetOutput, ResourceAdminError>
}

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
  readonly auditId: AuditId
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
  | { readonly type: "capability_not_advertised" } // guards C10 subscribe/unsubscribe
  | { readonly type: "fail_closed"; readonly reason: string } // guards C10 unauthorized subscribe/read/delivery
  | { readonly type: "uri_not_allowlisted"; readonly scheme: string } // guards C12, FR25
  | { readonly type: "cross_project_denied" } // guards Privacy 3, AC21
  | { readonly type: "reindex_not_opted_in" } // guards C21, FR53
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// CatalogPort — runtime tool-catalog refresh (FR10, FR11, C4; NOT a reserved mcp.* id)
// =============================================================================

/**
 * Runtime data-plane port backing the cursor-paginated `tools/list` walk
 * and `notifications/tools/list_changed` refresh (plan.md "Tool-catalog
 * refresh flow", C4). Never registered as a Feature 007 command id; the
 * canonical adapter and code-mode share this one path (C13).
 */
export interface CatalogPort {
  readonly refresh: (input: CatalogRefreshInput) => Effect.Effect<CatalogRefreshOutput, CatalogError>
}

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
  | { readonly type: "cursor_guard_tripped"; readonly cursor: string } // guards C4 duplicate-cursor guard
  | { readonly type: "max_page_exceeded"; readonly pageCount: number } // guards C4 max-page fail-closed
  | { readonly type: "mcp_unavailable"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ContentPort — spooled tools/call and resources/read (FR12, FR19, FR33-FR37, C16, C17; NOT a reserved mcp.* id)
// =============================================================================

/**
 * Runtime data-plane port for `tools/call` and `resources/read`, reachable
 * only under `mcp:<server>:*` Permission (the existing `list_mcp_resources`
 * / `read_mcp_resource` runtime tools). Every result routes through the
 * Feature 005 OutputSpool; UI and LLM receive {@link McpContentEnvelope}
 * with a bounded preview and an `outputRef`, never a filesystem path (C16,
 * C17). Cancellation for an in-flight `call` follows {@link CancelKind}
 * (FR17, FR18, C8).
 */
export interface ContentPort {
  readonly call: (input: McpCallInput) => Effect.Effect<McpCallOutput, ContentError>
  /** `resource_link` stays lazy; auto-fetch only under policy/Permission/budget (C11). */
  readonly readResource: (input: McpReadResourceInput) => Effect.Effect<McpReadResourceOutput, ContentError>
  readonly cancel: (input: McpCancelInput) => Effect.Effect<McpCancelOutput, ContentError>
}

export interface McpCallInput {
  readonly serverId: ServerId
  readonly toolName: string
  readonly progressToken?: ProgressToken
  readonly cancelKind: CancelKind
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
  readonly cancelKind: CancelKind
}
export interface McpCancelOutput {
  readonly outcome: CancelOutcome
}

export type ContentError =
  | { readonly type: "not_found"; readonly serverId: ServerId }
  | { readonly type: "permission_denied"; readonly pattern: string } // guards mcp:<server>:* Permission
  | { readonly type: "uri_not_allowlisted"; readonly scheme: string } // guards C12
  | { readonly type: "mime_not_allowed"; readonly mimeType: string } // guards C17
  | { readonly type: "size_limit_exceeded"; readonly bytes: number } // guards C17
  | { readonly type: "decompression_bomb_rejected" } // guards C24
  | { readonly type: "budget_exceeded" } // guards C11 resource_link auto-fetch budget
  | { readonly type: "isError"; readonly reason: string } // tool-execution failure, distinct from protocol error (C5)
  | { readonly type: "mcp_unavailable"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// InteractionPort — sampling / elicitation gates (FR46, FR47, C19, C20; NOT a reserved mcp.* id)
// =============================================================================

/**
 * Runtime data-plane port for server-initiated sampling and elicitation,
 * reachable only when the corresponding {@link ExperimentalFlag} is
 * operator-enabled. Sampling never bypasses Feature 001 Smart routing,
 * budgets, LangLock, or privacy (C19); elicitation and `input_required`
 * always surface to the operator UI and the model never silently answers
 * (C20).
 */
export interface InteractionPort {
  /** Requires per-agent `mcp:<server>:sampling` Permission; approval passes through Feature 001 unchanged (C19). */
  readonly requestSampling: (input: McpSamplingRequest) => Effect.Effect<McpSamplingResult, InteractionError>
  /** Always operator-surfaced; sensitive mode blocks model-mediated answers outright (C20). */
  readonly requestElicitation: (input: McpElicitationRequest) => Effect.Effect<McpElicitationResult, InteractionError>
}

export type InteractionError =
  | { readonly type: "flag_disabled"; readonly flag: ExperimentalFlag } // guards C18 per-server opt-in
  | { readonly type: "permission_denied"; readonly pattern: string } // guards C19 mcp:<server>:sampling
  | { readonly type: "sensitive_mode_blocked" } // guards C20
  | { readonly type: "budget_exceeded" } // guards C19 Smart/budget passthrough
  | { readonly type: "timeout" }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// LoggingPort — mcp.logging.level.* (FR28, C23)
// =============================================================================

/** Backs the reserved `mcp.logging.level.show|set` operator commands (2 IDs). */
export interface LoggingPort {
  readonly show: (input: LoggingLevelShowInput) => Effect.Effect<LoggingLevelShowOutput, LoggingError>
  readonly set: (input: LoggingLevelSetInput) => Effect.Effect<LoggingLevelSetOutput, LoggingError>
}

export type McpLogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"

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
  | { readonly type: "capability_not_advertised" } // guards server `logging` capability
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ExperimentalPort — mcp.experimental.* (FR41, FR45, C18)
// =============================================================================

/**
 * Backs the reserved `mcp.experimental.status|enable|disable` operator
 * commands (3 IDs, per capability: tasks, sampling, elicitation,
 * content-stream extension). Enabling one flag on one server never
 * implies another flag or another server (C18).
 */
export interface ExperimentalPort {
  readonly status: (input: ExperimentalStatusInput) => Effect.Effect<ExperimentalStatusOutput, ExperimentalError>
  readonly enable: (input: ExperimentalToggleInput) => Effect.Effect<ExperimentalToggleOutput, ExperimentalError>
  readonly disable: (input: ExperimentalToggleInput) => Effect.Effect<ExperimentalToggleOutput, ExperimentalError>
}

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
  | { readonly type: "capability_not_advertised"; readonly flag: ExperimentalFlag } // guards C2, C18
  | { readonly type: "rollout_order_violation"; readonly flag: ExperimentalFlag } // guards C18 tasks->sampling->elicitation->content_stream
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ExtensionPort — mcp.extension.* (FR45, C18; nonstandard content-stream extension)
// =============================================================================

/**
 * Backs the reserved `mcp.extension.status|enable|disable` operator
 * commands (3 IDs, per server) for the nonstandard, namespaced
 * `experimental/opencode.contentStream` capability; disabled by default
 * and never used silently (FR6, C18).
 */
export interface ExtensionPort {
  readonly status: (input: ExtensionStatusInput) => Effect.Effect<ExtensionStatusOutput, ExtensionError>
  readonly enable: (input: ExtensionToggleInput) => Effect.Effect<ExtensionToggleOutput, ExtensionError>
  readonly disable: (input: ExtensionToggleInput) => Effect.Effect<ExtensionToggleOutput, ExtensionError>
}

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
  | { readonly type: "capability_not_negotiated" } // guards C18 — server must negotiate the namespaced string first
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
