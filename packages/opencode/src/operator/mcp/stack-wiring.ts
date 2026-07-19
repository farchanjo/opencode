/**
 * Feature 008 / T034 (S22) — live runtime composition for the mcp domain port.
 *
 * The composition-root wiring that turns the Feature 008 application host seams
 * into the typed `mcp` operator `DomainInvoke` override the Feature 007 dispatcher
 * consumes (C25). It mirrors how Feature 005 outputspool and Feature 006 semantic
 * are wired, adding NO command ids (Feature 007 stays the sole registration
 * authority; the reserved 30 `mcp.*` ids already live in the catalog at
 * `RESERVED_CATALOG_VERSION = 1.3.0` — no bump).
 *
 * The backend is injected because the real domain effects live behind the
 * `MCP.Service` host the composition root resolves against the same `AppRuntime`.
 * This module never returns a secret, a raw token, or a path (C25, C26). The
 * bounded, secret-free operator access-audit sink defaults to a debug log; the
 * composition root may replace it with the Feature 007 operator audit projector
 * feed. No async resolution happens here.
 */
export * as McpStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { McpOperatorPort } from "./mcp-port"
import { McpCommandPort } from "./mcp-command-port"
import type { McpAdminBackend, McpAdminPort, McpAuditSink } from "./mcp-port"

export interface McpDomainWiringDeps {
  /** The un-audited domain surface the Feature 008 application host provides. */
  readonly backend: McpAdminBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: McpAuditSink
}

export interface McpDomainWiring {
  readonly ports: McpCommandPort.McpDomainPorts
  /** The typed `mcp.*` operator port (also usable directly by the CLI/TUI). */
  readonly port: McpAdminPort
  /** Symmetry with the semantic/outputspool wiring; nothing background to tear down. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a secret/token/URI-as-content/path). */
const defaultAuditSink: McpAuditSink = {
  record: (event) => Effect.logDebug("mcp.operator.audit", event),
}

/**
 * Compose the live mcp domain port over the injected application backend. Returns
 * the `mcp` `DomainInvoke` override plus the typed port for direct CLI/TUI use.
 */
export const createMcpDomainWiring = (deps: McpDomainWiringDeps): McpDomainWiring => {
  const audit = deps.audit ?? defaultAuditSink
  const port = McpOperatorPort.createMcpAdminPort({ backend: deps.backend })
  const ports = McpCommandPort.createMcpDomainPorts({ port, audit })
  return { ports, port, dispose: () => {} }
}
