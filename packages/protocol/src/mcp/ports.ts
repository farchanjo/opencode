/**
 * Feature 008 — MCP protocol ports (T012).
 *
 * Two port families, both sourcing every enum member from `@opencode-ai/schema/mcp/*`
 * so the transport contract can never diverge from the wire shape.
 *
 * 1. DRIVEN / injected dependency ports the framework-free domain lifecycle engine
 *    (`packages/core/src/mcp/**`) consumes — `TransportPort`, `ClockPort`,
 *    `EntropyPort`, `SpoolPort`, `PermissionReadPort`, `EventPublishPort`,
 *    `ConfigReadPort`, `SecretResolvePort` (plan.md "New and reworked module tree
 *    target"). The SDK client, transports, OAuth and the Feature 005 OutputSpool live
 *    in `packages/opencode`; core makes lifecycle/reconnect/policy decisions over these
 *    injected seams with no I/O in the hot logic (FR7, FR29, C2, C14). These interfaces
 *    are underspecified in the spec corpus (named, not shaped) — the minimal typed
 *    contracts below are derived from the named responsibilities and the schema wire
 *    types; downstream waves (T014-T023) refine them behind the same names.
 *
 * 2. INBOUND operator/runtime port interfaces mirroring
 *    doc/arch/sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/contracts/ports.ts —
 *    the six operator-plane ports backing the 30 reserved Feature 007 `mcp.*` command
 *    IDs (operator-only, zero-token, zero-transcript) and the three runtime data-plane
 *    ports the canonical adapter calls under `mcp:<server>:*` Permission. Their payloads
 *    live in ./commands.
 *
 * Reconciled to CUE: the closed 15-member event vocabulary (10 durable / 5 live),
 * `mcp.call.cancel_requested` **live**, no `mcp.subscription.fail_closed` event member.
 */

import type { Effect } from "effect"
import type {
  ProvenanceClass as SchemaProvenanceClass,
  TransportKind as SchemaTransportKind,
} from "@opencode-ai/schema/mcp/enums"
import type { ContentKind as SchemaContentKind } from "@opencode-ai/schema/mcp/enums"
import type {
  AddServerInput,
  AddServerOutput,
  AuthError,
  AuthFinishInput,
  AuthFinishOutput,
  AuthRemoveInput,
  AuthRemoveOutput,
  AuthStartInput,
  AuthStartOutput,
  AuthStatusInput,
  AuthStatusOutput,
  CatalogError,
  CatalogRefreshInput,
  CatalogRefreshOutput,
  ConnectServerInput,
  ConnectServerOutput,
  ContentError,
  DeleteServerInput,
  DeleteServerOutput,
  DisableServerInput,
  DisableServerOutput,
  DisconnectServerInput,
  DisconnectServerOutput,
  ExperimentalError,
  ExperimentalStatusInput,
  ExperimentalStatusOutput,
  ExperimentalToggleInput,
  ExperimentalToggleOutput,
  ExtensionError,
  ExtensionStatusInput,
  ExtensionStatusOutput,
  ExtensionToggleInput,
  ExtensionToggleOutput,
  InteractionError,
  ListServersInput,
  ListServersOutput,
  LoggingError,
  LoggingLevelSetInput,
  LoggingLevelSetOutput,
  LoggingLevelShowInput,
  LoggingLevelShowOutput,
  McpCallInput,
  McpCallOutput,
  McpCancelInput,
  McpCancelOutput,
  McpElicitationRequest,
  McpElicitationResult,
  McpEventType,
  McpReadResourceInput,
  McpReadResourceOutput,
  McpSamplingRequest,
  McpSamplingResult,
  McpServerProfile,
  ReconnectServerInput,
  ReconnectServerOutput,
  ResourceAdminError,
  ResourceAdminListInput,
  ResourceAdminListOutput,
  ResourceAdminReadInput,
  ResourceAdminReadOutput,
  ResourceAdminTemplatesOutput,
  ResourcePolicySetInput,
  ResourcePolicySetOutput,
  ResourcePolicyShowInput,
  ResourcePolicyShowOutput,
  ResourceSubscribeInput,
  ResourceSubscribeOutput,
  Scope,
  SecretRef,
  ServerCapabilitiesInput,
  ServerCapabilitiesOutput,
  ServerError,
  ServerId,
  ServerStatusInput,
  ServerStatusOutput,
  TestServerInput,
  TestServerOutput,
  UpdateServerInput,
  UpdateServerOutput,
} from "./commands"

// =============================================================================
// Injected dependency ports (driven side; consumed by packages/core/src/mcp)
// =============================================================================

/** Monotonic wall clock; backoff, debounce, coalescing and timestamps read from it (FR15, FR29, C7, C14). */
export interface ClockPort {
  readonly nowMillis: () => number
}

/** Bounded randomness for reconnect backoff jitter and progress-token minting (FR29, C14). */
export interface EntropyPort {
  /** A jitter ratio in `[0, 1)` applied to the bounded exponential backoff delay (C14). */
  readonly nextJitterRatio: () => number
  /** An opaque non-secret token (e.g. a progress token); never a credential (FR14, C7). */
  readonly nextToken: () => string
}

/** One JSON-RPC frame the transport carries; content-free at this seam (FR29, C14). */
export interface TransportFrame {
  readonly method: string
  readonly correlationId: string
}

export interface TransportResponse {
  readonly ok: boolean
  readonly lastEventId?: string
}

/**
 * The JSON-RPC transport seam. The SDK client + Streamable-HTTP/SSE/stdio transports
 * live in `packages/opencode`; the domain drives connect/request/notify and reads
 * resume state over this port, never touching sockets directly (FR29, FR30, FR31, C14).
 */
export interface TransportPort {
  readonly kind: SchemaTransportKind
  readonly request: (frame: TransportFrame) => Effect.Effect<TransportResponse, TransportError>
  readonly notify: (frame: TransportFrame) => Effect.Effect<void, TransportError>
  /** The last observed `Last-Event-ID` for Streamable HTTP resume, or null (FR29, C14). */
  readonly lastEventId: () => string | null
}

export type TransportError =
  | { readonly type: "ssrf_blocked"; readonly host: string } // guards C12, Security
  | { readonly type: "uri_not_allowlisted"; readonly scheme: string } // guards C12, FR25
  | { readonly type: "mcp_unavailable"; readonly reason: string } // typed capability gap, never a hard fail (C1, C2)
  | { readonly type: "unknown_remote" } // unacknowledged remote cancel; recorded as the durable audit (C8)
  | { readonly type: "timeout" }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

/** A Feature 005 OutputSpool receipt — a bounded preview and an OutputRef, never a path (FR33, FR34, C16). */
export interface SpoolReceipt {
  readonly outputRef: string
  readonly byteLength: number
  readonly previewBytes: number
  readonly kind: SchemaContentKind
  readonly provenance: SchemaProvenanceClass
}

export interface SpoolInput {
  readonly serverId: ServerId
  readonly mimeType?: string
  readonly byteLength: number
}

/** Routes every call/read body to the Feature 005 content plane under MIME + size caps (FR33, FR36, C16, C17). */
export interface SpoolPort {
  readonly spool: (input: SpoolInput) => Effect.Effect<SpoolReceipt, SpoolError>
}

export type SpoolError =
  | { readonly type: "mime_not_allowed"; readonly mimeType: string } // guards C17
  | { readonly type: "size_limit_exceeded"; readonly bytes: number } // guards C17
  | { readonly type: "decompression_bomb_rejected" } // guards C24
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export type PermissionDecision = "allow" | "deny"

export interface PermissionCheckInput {
  readonly pattern: string // e.g. `mcp:<server>:read` / `mcp:<server>:sampling` (FR50, C10, C19)
}

/** Read-only PermissionV2 evaluation gating a runtime call/read/subscribe; fails closed (FR21, FR50, C10). */
export interface PermissionReadPort {
  readonly check: (input: PermissionCheckInput) => Effect.Effect<PermissionDecision, PermissionError>
}

export type PermissionError =
  | { readonly type: "fail_closed"; readonly reason: string } // guards C10 unauthorized subscribe/read/delivery
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

/** A content-free `mcp.*` publish request — only the closed type and its correlation key (FR38, FR56, C3, C26). */
export interface PublishableMcpEvent {
  readonly type: McpEventType
  readonly correlationId: string
}

/** Publishes an `mcp.*` event to the EventV2 bridge; durable members persist, live members are droppable (FR38, C3). */
export interface EventPublishPort {
  readonly publish: (event: PublishableMcpEvent) => Effect.Effect<void, never>
}

/** Reads the per-server SSOT config; never returns a plaintext credential (FR29, C15, C27). */
export interface ConfigReadPort {
  readonly readServer: (id: ServerId) => Effect.Effect<McpServerProfile, ConfigError>
  readonly listServers: (scope: Scope) => Effect.Effect<readonly McpServerProfile[], ConfigError>
}

export type ConfigError =
  | { readonly type: "not_found"; readonly id: ServerId }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

/** An opaque, spawn-only handle to resolved secret material; the plaintext never crosses this seam (FR32, C15). */
export interface SecretHandle {
  readonly handle: string
}

/** Resolves a Feature 007 SecretRef to an opaque usage handle, never plaintext in the type (FR32, C15). */
export interface SecretResolvePort {
  readonly resolve: (ref: SecretRef) => Effect.Effect<SecretHandle, SecretError>
}

export type SecretError =
  | { readonly type: "not_found"; readonly ref: SecretRef }
  | { readonly type: "secret_backend_unavailable" } // guards C15
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// Inbound operator-plane ports — back the 30 reserved mcp.* IDs (FR48-FR50, C25)
// =============================================================================

/** Backs `mcp.server.list|add|update|test|connect|disconnect|reconnect|disable|delete|status|capabilities` (11 IDs). */
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

/** Backs `mcp.auth.start|finish|remove|status` (4 IDs); OAuth resolves through SecretRefs only (FR32, C15). */
export interface AuthPort {
  readonly start: (input: AuthStartInput) => Effect.Effect<AuthStartOutput, AuthError>
  readonly finish: (input: AuthFinishInput) => Effect.Effect<AuthFinishOutput, AuthError>
  readonly remove: (input: AuthRemoveInput) => Effect.Effect<AuthRemoveOutput, AuthError>
  readonly status: (input: AuthStatusInput) => Effect.Effect<AuthStatusOutput, AuthError>
}

/** Backs `mcp.resource.admin.list|templates|read|subscribe|unsubscribe|policy.show|policy.set` (7 IDs). */
export interface ResourceAdminPort {
  readonly list: (input: ResourceAdminListInput) => Effect.Effect<ResourceAdminListOutput, ResourceAdminError>
  readonly templates: (input: ResourceAdminListInput) => Effect.Effect<ResourceAdminTemplatesOutput, ResourceAdminError>
  /** Operator-plane read; creates an admin audit record, unlike the runtime plane (AC29). */
  readonly read: (input: ResourceAdminReadInput) => Effect.Effect<ResourceAdminReadOutput, ResourceAdminError>
  /** Requires server `resources.subscribe` capability plus operator grant; the LLM never calls this (C10). */
  readonly subscribe: (input: ResourceSubscribeInput) => Effect.Effect<ResourceSubscribeOutput, ResourceAdminError>
  readonly unsubscribe: (input: ResourceSubscribeInput) => Effect.Effect<ResourceSubscribeOutput, ResourceAdminError>
  readonly policyShow: (input: ResourcePolicyShowInput) => Effect.Effect<ResourcePolicyShowOutput, ResourceAdminError>
  readonly policySet: (input: ResourcePolicySetInput) => Effect.Effect<ResourcePolicySetOutput, ResourceAdminError>
}

/** Backs `mcp.logging.level.show|set` (2 IDs); setLevel reached only via Feature 007, audited (FR28, C23). */
export interface LoggingPort {
  readonly show: (input: LoggingLevelShowInput) => Effect.Effect<LoggingLevelShowOutput, LoggingError>
  readonly set: (input: LoggingLevelSetInput) => Effect.Effect<LoggingLevelSetOutput, LoggingError>
}

/** Backs `mcp.experimental.status|enable|disable` (3 IDs); enabling one flag never implies another (C18). */
export interface ExperimentalPort {
  readonly status: (input: ExperimentalStatusInput) => Effect.Effect<ExperimentalStatusOutput, ExperimentalError>
  readonly enable: (input: ExperimentalToggleInput) => Effect.Effect<ExperimentalToggleOutput, ExperimentalError>
  readonly disable: (input: ExperimentalToggleInput) => Effect.Effect<ExperimentalToggleOutput, ExperimentalError>
}

/** Backs `mcp.extension.status|enable|disable` (3 IDs) for the namespaced content-stream extension (FR6, C18). */
export interface ExtensionPort {
  readonly status: (input: ExtensionStatusInput) => Effect.Effect<ExtensionStatusOutput, ExtensionError>
  readonly enable: (input: ExtensionToggleInput) => Effect.Effect<ExtensionToggleOutput, ExtensionError>
  readonly disable: (input: ExtensionToggleInput) => Effect.Effect<ExtensionToggleOutput, ExtensionError>
}

// =============================================================================
// Inbound runtime data-plane ports — NOT reserved mcp.* IDs (FR10-FR19, FR46, FR47)
// =============================================================================

/** Runtime cursor-paginated `tools/list` walk + `list_changed` refresh; never a Feature 007 command id (FR10, FR11, C4). */
export interface CatalogPort {
  readonly refresh: (input: CatalogRefreshInput) => Effect.Effect<CatalogRefreshOutput, CatalogError>
}

/** Runtime `tools/call` and `resources/read`; every result routes through the Feature 005 OutputSpool (FR12, FR33, C16). */
export interface ContentPort {
  readonly call: (input: McpCallInput) => Effect.Effect<McpCallOutput, ContentError>
  /** `resource_link` stays lazy; auto-fetch only under policy/Permission/budget (C11). */
  readonly readResource: (input: McpReadResourceInput) => Effect.Effect<McpReadResourceOutput, ContentError>
  readonly cancel: (input: McpCancelInput) => Effect.Effect<McpCancelOutput, ContentError>
}

/** Runtime server-initiated sampling/elicitation gates behind the operator-enabled experimental flags (FR46, FR47, C19, C20). */
export interface InteractionPort {
  /** Requires per-agent `mcp:<server>:sampling` Permission; approval passes through Feature 001 unchanged (C19). */
  readonly requestSampling: (input: McpSamplingRequest) => Effect.Effect<McpSamplingResult, InteractionError>
  /** Always operator-surfaced; sensitive mode blocks model-mediated answers outright (C20). */
  readonly requestElicitation: (input: McpElicitationRequest) => Effect.Effect<McpElicitationResult, InteractionError>
}
