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
import type { Effect } from "effect"

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
