/**
 * Feature 008 / T034 (S22) — live `McpAdminBackend` composition for the operator
 * stack.
 *
 * Turns the Feature 008 application host (`MCP.Service`: the reworked
 * `packages/opencode/src/mcp/**`) into the un-audited `McpAdminBackend` seam that
 * `createMcpAdminPort` (T034) consumes, following the
 * `createLiveSemanticBackend`/`createLiveOutputSpoolBackend` precedent. It is
 * HONEST about what the operator `AppRuntime` reaches: the live `MCP.Service` is
 * not bound from the operator runtime in this wave, so every method returns the
 * port's typed capability gap (`unavailable`/`mcp_unavailable`) rather than
 * fabricated data (mirrors the Feature 006 semantic / Feature 005 outputspool
 * Residuals notes). The composition root injects a real per-port `override` as the
 * host is bound.
 *
 * Zero provider/model calls, tokens, or cost on this default path (FR49, AC15); a
 * caller always sees an honest capability gap and never a false success or a
 * secret/token/path in a view (C25, C26).
 */
export * as McpBackendLive from "./backend-live"

import { Effect } from "effect"
import type {
  AuthPort,
  ExperimentalPort,
  ExtensionPort,
  LoggingPort,
  ResourceAdminPort,
  ServerLifecyclePort,
} from "@opencode-ai/protocol/mcp/ports"
import type { McpAdminBackend } from "./mcp-port"

export interface LiveMcpBackendDeps {
  /** Real per-port implementations the composition root injects as the host is bound; unset falls back to the honest gap. */
  readonly override?: Partial<McpAdminBackend>
}

const NOT_BOUND = "mcp MCP.Service host is not bound to the operator runtime in this wave"

const serverGap: ServerLifecyclePort = {
  list: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  add: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  update: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  test: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  connect: () => Effect.fail({ type: "mcp_unavailable", reason: NOT_BOUND }),
  disconnect: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  reconnect: () => Effect.fail({ type: "mcp_unavailable", reason: NOT_BOUND }),
  disable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  delete: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  status: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  capabilities: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const authGap: AuthPort = {
  start: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  finish: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  remove: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  status: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const resourceGap: ResourceAdminPort = {
  list: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  templates: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  read: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  subscribe: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  unsubscribe: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  policyShow: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  policySet: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const loggingGap: LoggingPort = {
  show: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  set: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const experimentalGap: ExperimentalPort = {
  status: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  enable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  disable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const extensionGap: ExtensionPort = {
  status: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  enable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  disable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const gapBackend: McpAdminBackend = {
  server: serverGap,
  auth: authGap,
  resource: resourceGap,
  logging: loggingGap,
  experimental: experimentalGap,
  extension: extensionGap,
}

/** Build the live backend: the honest gap default overlaid with any injected real ports. */
export const createLiveMcpBackend = (deps: LiveMcpBackendDeps = {}): McpAdminBackend => ({
  server: deps.override?.server ?? gapBackend.server,
  auth: deps.override?.auth ?? gapBackend.auth,
  resource: deps.override?.resource ?? gapBackend.resource,
  logging: deps.override?.logging ?? gapBackend.logging,
  experimental: deps.override?.experimental ?? gapBackend.experimental,
  extension: deps.override?.extension ?? gapBackend.extension,
})
