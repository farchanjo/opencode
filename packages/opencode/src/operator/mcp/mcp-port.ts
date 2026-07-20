/**
 * Feature 008 / T034 (S22) — the typed `mcp.*` domain implementation backing the
 * Feature 007 operator control plane (C25, FR48-FR50).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and the
 * reserved-name guard; Feature 008 supplies ONLY these typed
 * `ServerLifecyclePort`/`AuthPort`/`ResourceAdminPort`/`LoggingPort`/
 * `ExperimentalPort`/`ExtensionPort` domain implementations plus their audit
 * events. The 30 reserved `mcp.*` ids (`mcp.server.*` 11, `mcp.auth.*` 4,
 * `mcp.resource.admin.*` 7, `mcp.logging.level.*` 2, `mcp.experimental.*` 3,
 * `mcp.extension.*` 3) already live in `packages/core/src/operator/catalog.ts` at
 * `RESERVED_CATALOG_VERSION = "1.3.0"` — NO catalog bump is performed and no id is
 * added here (C25). Ordinary list/status/show/capabilities make ZERO provider/model
 * calls and inject ZERO transcript; only explicit `mcp.server.test`/`mcp.auth.*`
 * reach the endpoint via a fixed probe (FR49). The runtime data plane (tools/call,
 * list_mcp_resources, read_mcp_resource) never reaches any of these 30 ids (FR50).
 *
 * The backend seam (`McpAdminBackend`) is the un-audited domain surface the
 * Feature 008 application host provides; the composition root injects the real
 * `MCP.Service`-backed implementations, or an honest capability gap when the host
 * is not bound to the operator runtime (see backend-live.ts). This module never
 * returns a secret, a raw token, or a filesystem path in a view (C15, C16, C26).
 */
export * as McpOperatorPort from "./mcp-port"

import type {
  AuthPort,
  ExperimentalPort,
  ExtensionPort,
  LoggingPort,
  ResourceAdminPort,
  ServerLifecyclePort,
} from "@opencode-ai/protocol/mcp/ports"
import type { Scope } from "@opencode-ai/protocol/mcp/commands"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { Effect } from "effect"

// =============================================================================
// Feature 017 / T007 — live-host server read seam (FR1, FR2)
// =============================================================================

/**
 * A content-free projection of ONE live-host server the operator reads via
 * `MCP.Service.status()` + `clients()`. It carries ONLY faithful live facts —
 * the connection status enum and whether a transport/capabilities set is present
 * for a connected client. NO SSOT-only field (CAS version, `auditId`, trust
 * profile, timestamps) is ever fabricated here; those live in the operator SSOT,
 * never the live host config (FR1, FR2).
 */
export interface LiveServerRead {
  readonly serverId: string
  readonly connectionStatus: string
  readonly transportPresent: boolean
  readonly capabilitiesPresent: boolean
}

export interface LiveServerListOutput {
  readonly servers: readonly LiveServerRead[]
}
export interface LiveServerStatusOutput {
  readonly server: LiveServerRead | null
}

/** A content-free reason for an unreachable/unbound live host read (never the raw error, FR2, FR14). */
export type McpLiveReadError = { readonly type: "mcp_unavailable"; readonly reason: string }

/**
 * The narrow live-host READ seam backing `mcp.server.list`/`status`/`capabilities`.
 * Reads the REAL connected servers over `MCP.Service.status()` + `clients()`; an
 * unbound/unreachable service degrades to a typed `mcp_unavailable`, never a crash
 * and never a fabricated SSOT field (FR1, FR2).
 */
export interface McpLiveServerReader {
  readonly list: () => Effect.Effect<LiveServerListOutput, McpLiveReadError>
  readonly status: (id: string) => Effect.Effect<LiveServerStatusOutput, McpLiveReadError>
  readonly capabilities: (id: string) => Effect.Effect<LiveServerStatusOutput, McpLiveReadError>
}

// =============================================================================
// Feature 017 / T008-T010 — mcp mutation-plan seam (FR3, FR4, FR5)
// =============================================================================

/** The closed error union a mutation plan validates against — never a false success (FR3, FR4, FR5). */
export type McpMutationError =
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "version_conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly type: "not_found"; readonly id: string }
  | { readonly type: "mcp_unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export interface McpServerAddInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly name: string
  readonly transportKind: string
  readonly endpoint: string
  readonly secretRef?: string
}
export interface McpServerUpdateInput {
  readonly id: string
  readonly patch: Record<string, unknown>
}
export interface McpServerTargetInput {
  readonly id: string
}
export interface McpLoggingSetInput {
  readonly serverId: string
  readonly level: string
}
export interface McpExperimentalToggleInput {
  readonly serverId: string
  readonly flag: string
  readonly enabled: boolean
}
export interface McpExtensionToggleInput {
  readonly serverId: string
  readonly enabled: boolean
}
export interface McpResourcePolicySetInput {
  readonly serverId: string
  readonly policy: unknown
}
export interface McpServerActionInput {
  readonly serverId: string
}

/**
 * The mutation-plan seam the composition root injects when the operator runtime is
 * bound. The config-backed verbs persist through `mutateAuthority` over the operator
 * `store.config` MCP authority (the `apply` is a pure transform of the persisted
 * document); the live-service actions (`connect`/`disconnect`/`reconnect`) and
 * `auth.remove` perform the live `MCP.Service`/`McpAuth` op and record the resulting
 * outcome through a store-scoped authority. Every method VALIDATES before returning a
 * plan, so a rejection leaves no phantom write (FR3, FR4, FR5).
 */
export interface McpMutationBackend {
  readonly planServerAdd: (input: McpServerAddInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planServerUpdate: (input: McpServerUpdateInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planServerDelete: (input: McpServerTargetInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planServerDisable: (input: McpServerTargetInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planLoggingSet: (input: McpLoggingSetInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planExperimentalToggle: (input: McpExperimentalToggleInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planExtensionToggle: (input: McpExtensionToggleInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planResourcePolicySet: (input: McpResourcePolicySetInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planConnect: (input: McpServerActionInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planDisconnect: (input: McpServerActionInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planReconnect: (input: McpServerActionInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
  readonly planAuthRemove: (input: McpServerActionInput) => Effect.Effect<OperatorMutationPlan, McpMutationError>
}

/** A bounded, secret-free operator audit event (never a secret/token/URI-as-content/path, C26). */
export interface McpAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "denied" | "unavailable"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface McpAuditSink {
  readonly record: (event: McpAuditEvent) => Effect.Effect<void>
}

/**
 * The narrow domain seam the Feature 008 application host provides, one namespaced
 * port per reserved group. The six ports carry the 30 reserved ids (FR48, C25).
 */
export interface McpAdminBackend {
  readonly server: ServerLifecyclePort
  readonly auth: AuthPort
  readonly resource: ResourceAdminPort
  readonly logging: LoggingPort
  readonly experimental: ExperimentalPort
  readonly extension: ExtensionPort
  /** Feature 017 / T007 — live-host reads backing `mcp.server.list`/`status`/`capabilities` (FR1, FR2). */
  readonly liveServer?: McpLiveServerReader
  /** Feature 017 / T008-T010 — the `mutation_plan` seam for the config-backed + live-service mcp verbs (FR3-FR5). */
  readonly mutations?: McpMutationBackend
}

/** The typed operator port; a thin pass-through over the injected backend (mirrors semantic-port). */
export type McpAdminPort = McpAdminBackend

export interface McpAdminPortDeps {
  readonly backend: McpAdminBackend
}

/**
 * Build the typed `mcp.*` operator port over the injected domain backend. The
 * backend authors the audit-correlation ids and the operator-only mutation guard;
 * this port is the stable surface the command adapter and the CLI/TUI consume
 * (FR48, C25).
 */
export const createMcpAdminPort = (deps: McpAdminPortDeps): McpAdminPort => deps.backend
