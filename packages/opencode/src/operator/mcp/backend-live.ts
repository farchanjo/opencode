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
import type {
  McpAuthStatus,
  McpResourceDescriptor,
  McpResourceTemplateDescriptor,
} from "@opencode-ai/protocol/mcp/commands"
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

// =============================================================================
// Feature 014 / T008 (FR7) — real MCP admin backend over the live `MCP.Service`
// =============================================================================

/**
 * The narrow LIVE-HOST READ seam the composition root implements over the AppLayer
 * `MCP.Service` + `McpAuth` (resolved via `AppRuntime`, the routing/provider
 * precedent). It carries ONLY faithful, content-free projections of live client
 * state — the OAuth status enum and the connected server's advertised resource /
 * resource-template descriptors. No secret, raw token, header value, or filesystem
 * path crosses this seam (C15, C26, FR11); a `secretRef` (if any) stays the opaque
 * reference the SSOT holds and is never dereferenced here.
 *
 * Only the reads that map 1:1 onto a real `MCP.Service` seam are surfaced. The
 * server-profile reads (`server.list`/`status`/`capabilities`) require rich SSOT
 * metadata (CAS version, auditId, timestamps, trust profile) the live host config
 * does not carry, so projecting them would fabricate state — they stay typed gaps.
 * Every mutating verb stays a typed gap too: the `mcp.*` command port returns
 * `kind:"query"` (Feature 008), which the Feature 007 dispatcher rejects for a
 * `mutates` descriptor AFTER any side effect — so a live mutation would be the exact
 * FR5 phantom-write trap. Converting `mcp.*` to the `OperatorMutationPlan` contract
 * is out of T008 scope (FR5 covers `langlock`/`jobs`), and MCP server config lives in
 * `cfg.mcp` (owned by `MCP.Service`), not an operator CAS authority. This boundary is
 * documented here and in the Feature 014 tasks.md T008 evidence.
 */
export interface McpHostReader {
  /** Live OAuth status for a server (`MCP.Service.getAuthStatus`); a faithful enum, never a token. */
  readonly authStatus: (serverId: string) => Promise<McpAuthStatus>
  /** Live advertised resources for a CONNECTED server (`MCP.Service.resources`); empty when unconnected. */
  readonly listResources: (serverId: string) => Promise<ReadonlyArray<McpResourceDescriptor>>
  /** Live advertised resource templates for a CONNECTED server (`MCP.Service.resourceTemplates`). */
  readonly listResourceTemplates: (serverId: string) => Promise<ReadonlyArray<McpResourceTemplateDescriptor>>
}

/** A content-free reason for a guarded live-host read failure — never the raw error (no path/secret leak, FR14). */
const READ_UNREACHABLE = "mcp live host read is unreachable"

/** Wrap a live-host read in a guarded effect that degrades to a typed `unavailable`, never a crash or a leak. */
function guardedRead<A>(read: () => Promise<A>): Effect.Effect<A, { readonly type: "unavailable"; readonly reason: string }> {
  return Effect.tryPromise({ try: read, catch: () => ({ type: "unavailable" as const, reason: READ_UNREACHABLE }) })
}

/** The live-backed `AuthPort`: `status` reflects the real OAuth state; the three mutating verbs stay typed gaps. */
function liveAuthPort(reader: McpHostReader): AuthPort {
  const gap = () => Effect.fail({ type: "unavailable" as const, reason: NOT_BOUND })
  return {
    start: gap,
    finish: gap,
    remove: gap,
    status: (input) => guardedRead(() => reader.authStatus(input.serverId)).pipe(Effect.map((authStatus) => ({ authStatus }))),
  }
}

/** The live-backed `ResourceAdminPort`: `list`/`templates` reflect the live client; the rest stay typed gaps. */
function liveResourcePort(reader: McpHostReader): ResourceAdminPort {
  const gap = () => Effect.fail({ type: "unavailable" as const, reason: NOT_BOUND })
  return {
    list: (input) => guardedRead(() => reader.listResources(input.serverId)).pipe(Effect.map((resources) => ({ resources }))),
    templates: (input) =>
      guardedRead(() => reader.listResourceTemplates(input.serverId)).pipe(Effect.map((templates) => ({ templates }))),
    read: gap,
    subscribe: gap,
    unsubscribe: gap,
    policyShow: gap,
    policySet: gap,
  }
}

/**
 * Build the `override` for `createLiveMcpBackend` from the live-host read seam. Wires
 * the faithful `auth.status` + `resource.admin.list`/`templates` reads; every other
 * sub-port method (and all server/logging/experimental/extension ports) stays the
 * honest typed gap. The composition root injects this over `MCP.Service` + `McpAuth`.
 */
export const createMcpServiceOverride = (reader: McpHostReader): Partial<McpAdminBackend> => ({
  auth: liveAuthPort(reader),
  resource: liveResourcePort(reader),
})
