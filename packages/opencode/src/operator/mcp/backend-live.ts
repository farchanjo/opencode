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
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type {
  LiveServerRead,
  McpAdminBackend,
  McpLiveReadError,
  McpLiveServerReader,
  McpMutationBackend,
  McpMutationError,
} from "./mcp-port"

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
  // Feature 017: the live-host server reads (T007) + the mutation-plan seam (T008-T010)
  // are only present once the composition root binds them; a bare backend keeps them
  // absent so `mcp.server.*` reads and mutations stay honest typed gaps.
  liveServer: deps.override?.liveServer,
  mutations: deps.override?.mutations,
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

// =============================================================================
// Feature 017 / T007 — live-host server reads (FR1, FR2)
// =============================================================================

/**
 * The raw live-host source the composition root implements over `MCP.Service`. It
 * carries ONLY faithful, content-free facts: the per-server connection-status enum
 * (`MCP.Service.status()`) and, for a connected client, whether a transport and a
 * capabilities set are present (`MCP.Service.clients()`). No secret, token, or path
 * crosses this seam; no SSOT-only field (CAS version, `auditId`, trust profile,
 * timestamps) is ever sourced here (FR1, FR2, C15, C26).
 */
export interface McpLiveServerSource {
  /** `MCP.Service.status()` projected — connection-status enum per configured server. */
  readonly statuses: () => Promise<Readonly<Record<string, string>>>
  /** `MCP.Service.clients()` projected — connected server id → transport/capabilities presence. */
  readonly clients: () => Promise<Readonly<Record<string, { readonly transportPresent: boolean; readonly capabilitiesPresent: boolean }>>>
}

/** A content-free reason for an unreachable/unbound live server read (never the raw error, FR2, FR14). */
const LIVE_READ_UNREACHABLE = "mcp live server read is unreachable"

/** Project a live status + client map into the content-free `LiveServerRead` for one server id. */
function projectServer(
  serverId: string,
  statuses: Readonly<Record<string, string>>,
  clients: Readonly<Record<string, { readonly transportPresent: boolean; readonly capabilitiesPresent: boolean }>>,
): LiveServerRead {
  const client = clients[serverId]
  return {
    serverId,
    connectionStatus: statuses[serverId] ?? (client ? "connected" : "disabled"),
    transportPresent: client?.transportPresent ?? false,
    capabilitiesPresent: client?.capabilitiesPresent ?? false,
  }
}

/** Guard a live-server source read; a throw/unbound host degrades to a typed `mcp_unavailable` (FR1, FR2). */
function guardedLiveRead<A>(read: () => Promise<A>): Effect.Effect<A, McpLiveReadError> {
  return Effect.tryPromise({ try: read, catch: () => ({ type: "mcp_unavailable" as const, reason: LIVE_READ_UNREACHABLE }) })
}

/**
 * Build the live-host server reader backing `mcp.server.list`/`status`/`capabilities`.
 * Reads the REAL connected servers over `MCP.Service.status()` + `clients()` and
 * projects each onto the content-free `LiveServerRead` — never a fabricated SSOT
 * field. An unbound/unreachable service degrades to `mcp_unavailable` (FR1, FR2).
 */
export function liveServerReader(source: McpLiveServerSource): McpLiveServerReader {
  const readBoth = (): Effect.Effect<
    { statuses: Readonly<Record<string, string>>; clients: Readonly<Record<string, { transportPresent: boolean; capabilitiesPresent: boolean }>> },
    McpLiveReadError
  > =>
    Effect.gen(function* () {
      const statuses = yield* guardedLiveRead(() => source.statuses())
      const clients = yield* guardedLiveRead(() => source.clients())
      return { statuses, clients }
    })

  return {
    list: () =>
      readBoth().pipe(
        Effect.map(({ statuses, clients }) => {
          const ids = new Set([...Object.keys(statuses), ...Object.keys(clients)])
          return { servers: [...ids].sort().map((id) => projectServer(id, statuses, clients)) }
        }),
      ),
    status: (id) =>
      readBoth().pipe(
        Effect.map(({ statuses, clients }) => ({
          server: id in statuses || id in clients ? projectServer(id, statuses, clients) : null,
        })),
      ),
    capabilities: (id) =>
      readBoth().pipe(
        Effect.map(({ statuses, clients }) => ({
          server: id in statuses || id in clients ? projectServer(id, statuses, clients) : null,
        })),
      ),
  }
}

// =============================================================================
// Feature 017 / T008-T010 — mcp mutation plans (FR3, FR4, FR5)
// =============================================================================

/** The operator SSOT authority the config-backed mcp verbs persist through `mutateAuthority`. */
const MCP_CONFIG_AUTHORITY = "global:mcp" as const
/** The store-scoped authority the live-service actions record their resulting connection outcome under. */
const MCP_CONNECTIONS_AUTHORITY = "global:mcp-connections" as const
/** The store-scoped authority `auth.remove` records its local credential-clear outcome under. */
const MCP_AUTH_AUTHORITY = "global:mcp-auth" as const

const TRANSPORT_KINDS: ReadonlySet<string> = new Set(["stdio", "streamable-http", "sse"])
const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"])
const EXPERIMENTAL_FLAGS: ReadonlySet<string> = new Set(["tasks", "sampling", "elicitation", "content-stream"])

/** The operator-managed, content-free mcp server record (never a plaintext credential; `secretRef` is opaque). */
interface McpServerEntry {
  transportKind: string
  endpoint: string
  secretRef?: string
  enabled: boolean
  name?: string
  loggingLevel?: string
  experimental?: string[]
  extensionEnabled?: boolean
  resourcePolicy?: unknown
}
interface McpConfigDoc {
  servers: Record<string, McpServerEntry>
}

/** Parse a persisted authority payload into the mcp config document; a default empty doc when absent/malformed. */
function parseDoc(current: unknown): McpConfigDoc {
  if (current && typeof current === "object" && !Array.isArray(current)) {
    const servers = (current as Record<string, unknown>).servers
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      return { servers: { ...(servers as Record<string, McpServerEntry>) } }
    }
  }
  return { servers: {} }
}

/** Parse a persisted authority payload into a plain content-free record (connection/auth outcome maps). */
function parseMap(current: unknown): Record<string, unknown> {
  return current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {}
}

const invalidArg = (field: string, reason: string): McpMutationError => ({ type: "invalid_argument", field, reason })

/** A live-service action outcome — the resulting status, or a not-found gap. */
export type McpLiveActionOutcome = { readonly kind: "ok"; readonly status: string } | { readonly kind: "not_found" }

/** The live `MCP.Service` connection actions the composition root implements (connect/disconnect/reconnect). */
export interface McpLiveActions {
  readonly connect: (serverId: string) => Promise<McpLiveActionOutcome>
  readonly disconnect: (serverId: string) => Promise<McpLiveActionOutcome>
  readonly reconnect: (serverId: string) => Promise<McpLiveActionOutcome>
}

/** The local credential-clear seam `auth.remove` calls (`MCP.Service.removeAuth` → `McpAuth.remove`). */
export interface McpAuthClear {
  readonly remove: (serverId: string) => Promise<void>
}

export interface McpMutationDeps {
  /** The operator `store.config` authority the config-backed verbs persist through `mutateAuthority`. */
  readonly config: ConfigPort
  /** The live `MCP.Service` connection actions; absent leaves connect/disconnect/reconnect a typed `mcp_unavailable` gap. */
  readonly actions?: McpLiveActions
  /** The local credential-clear seam; absent leaves `auth.remove` a typed `mcp_unavailable` gap (T010). */
  readonly authClear?: McpAuthClear
  readonly now?: () => number
}

/**
 * Build the `mutation_plan` backend for the config-backed + live-service mcp verbs.
 *
 * The config-backed verbs (`server.add`/`update`/`delete`/`disable`,
 * `logging.level.set`, `experimental.enable`/`disable`, `extension.enable`/`disable`,
 * `resource.admin.policy.set`) VALIDATE then return an `OperatorMutationPlan` over the
 * `store.config` MCP authority — the pure `apply` transforms the persisted document
 * and `mutateAuthority` owns the single committed CAS write + audit, so a rejection
 * leaves no phantom write (FR3, FR5). The live-service actions (`connect`/`disconnect`/
 * `reconnect`) and `auth.remove` perform the live op and, on success, record the
 * resulting outcome through a store-scoped authority; a `not_found`/unbound service
 * fails BEFORE any plan (FR4, FR5). Nothing is fabricated.
 */
export function createMcpMutations(deps: McpMutationDeps): McpMutationBackend {
  const now = deps.now ?? Date.now

  const readDoc = (): Effect.Effect<McpConfigDoc, McpMutationError> =>
    Effect.tryPromise({
      try: () => deps.config.get(MCP_CONFIG_AUTHORITY),
      catch: () => ({ type: "mcp_unavailable" as const, reason: "mcp config authority is unreachable" }),
    }).pipe(Effect.map((entry) => parseDoc(entry?.payload ?? null)))

  /** Read the current doc and require the server to exist; else a typed `not_found` (no phantom write). */
  const requireServer = (id: string): Effect.Effect<McpConfigDoc, McpMutationError> =>
    Effect.gen(function* () {
      if (!id) return yield* Effect.fail(invalidArg("id", "server id is required"))
      const doc = yield* readDoc()
      if (!doc.servers[id]) return yield* Effect.fail<McpMutationError>({ type: "not_found", id })
      return doc
    })

  /** Build a config-authority plan whose pure `apply` mutates one server entry off the committed payload. */
  const editPlan = (mutate: (doc: McpConfigDoc) => void): OperatorMutationPlan => ({
    authority: MCP_CONFIG_AUTHORITY,
    apply: (current: unknown) => {
      const doc = parseDoc(current)
      mutate(doc)
      return doc
    },
  })

  const planServerAdd: McpMutationBackend["planServerAdd"] = (input) =>
    Effect.gen(function* () {
      const name = input.name.trim()
      if (!name) return yield* Effect.fail(invalidArg("name", "server name is required"))
      if (!TRANSPORT_KINDS.has(input.transportKind))
        return yield* Effect.fail(invalidArg("transportKind", `transportKind must be one of ${[...TRANSPORT_KINDS].join(", ")}`))
      const endpoint = input.endpoint.trim()
      if (!endpoint) return yield* Effect.fail(invalidArg("endpoint", "endpoint is required"))
      return editPlan((doc) => {
        doc.servers[name] = {
          transportKind: input.transportKind,
          endpoint,
          secretRef: input.secretRef,
          enabled: true,
          name,
          experimental: [],
        }
      })
    })

  const planServerUpdate: McpMutationBackend["planServerUpdate"] = (input) =>
    requireServer(input.id).pipe(
      Effect.map(() =>
        editPlan((doc) => {
          const base = doc.servers[input.id]
          if (!base) return
          const patch = input.patch
          if (typeof patch.name === "string") base.name = patch.name
          if (typeof patch.endpoint === "string") base.endpoint = patch.endpoint
          if (typeof patch.enabled === "boolean") base.enabled = patch.enabled
          if (typeof patch.transportKind === "string" && TRANSPORT_KINDS.has(patch.transportKind))
            base.transportKind = patch.transportKind
        }),
      ),
    )

  const planServerDelete: McpMutationBackend["planServerDelete"] = (input) =>
    requireServer(input.id).pipe(Effect.map(() => editPlan((doc) => void delete doc.servers[input.id])))

  const planServerDisable: McpMutationBackend["planServerDisable"] = (input) =>
    requireServer(input.id).pipe(
      Effect.map(() =>
        editPlan((doc) => {
          const base = doc.servers[input.id]
          if (base) base.enabled = false
        }),
      ),
    )

  const planLoggingSet: McpMutationBackend["planLoggingSet"] = (input) =>
    Effect.gen(function* () {
      if (!LOG_LEVELS.has(input.level))
        return yield* Effect.fail(invalidArg("level", `level must be one of ${[...LOG_LEVELS].join(", ")}`))
      yield* requireServer(input.serverId)
      return editPlan((doc) => {
        const base = doc.servers[input.serverId]
        if (base) base.loggingLevel = input.level
      })
    })

  const planExperimentalToggle: McpMutationBackend["planExperimentalToggle"] = (input) =>
    Effect.gen(function* () {
      if (!EXPERIMENTAL_FLAGS.has(input.flag))
        return yield* Effect.fail(invalidArg("flag", `flag must be one of ${[...EXPERIMENTAL_FLAGS].join(", ")}`))
      yield* requireServer(input.serverId)
      return editPlan((doc) => {
        const base = doc.servers[input.serverId]
        if (!base) return
        const set = new Set(base.experimental ?? [])
        if (input.enabled) set.add(input.flag)
        else set.delete(input.flag)
        base.experimental = [...set]
      })
    })

  const planExtensionToggle: McpMutationBackend["planExtensionToggle"] = (input) =>
    requireServer(input.serverId).pipe(
      Effect.map(() =>
        editPlan((doc) => {
          const base = doc.servers[input.serverId]
          if (base) base.extensionEnabled = input.enabled
        }),
      ),
    )

  const planResourcePolicySet: McpMutationBackend["planResourcePolicySet"] = (input) =>
    Effect.gen(function* () {
      if (!input.policy || typeof input.policy !== "object" || Array.isArray(input.policy))
        return yield* Effect.fail(invalidArg("policy", "policy must be an object"))
      yield* requireServer(input.serverId)
      return editPlan((doc) => {
        const base = doc.servers[input.serverId]
        if (base) base.resourcePolicy = input.policy
      })
    })

  /** Run one live-service connection action and, on success, record the resulting outcome (T009, FR4). */
  const liveActionPlan = (
    serverId: string,
    action: "connect" | "disconnect" | "reconnect",
    run: ((serverId: string) => Promise<McpLiveActionOutcome>) | undefined,
  ): Effect.Effect<OperatorMutationPlan, McpMutationError> =>
    Effect.gen(function* () {
      if (!serverId) return yield* Effect.fail(invalidArg("serverId", "server id is required"))
      if (!run) return yield* Effect.fail<McpMutationError>({ type: "mcp_unavailable", reason: "mcp live service is not bound" })
      const outcome = yield* Effect.tryPromise({
        try: () => run(serverId),
        catch: () => ({ type: "mcp_unavailable" as const, reason: "mcp live service is unreachable" }),
      })
      if (outcome.kind === "not_found") return yield* Effect.fail<McpMutationError>({ type: "not_found", id: serverId })
      return {
        authority: MCP_CONNECTIONS_AUTHORITY,
        apply: (current: unknown) => {
          const map = parseMap(current)
          map[serverId] = { action, status: outcome.status, updatedAtMs: now() }
          return map
        },
      }
    })

  const planConnect: McpMutationBackend["planConnect"] = (input) =>
    liveActionPlan(input.serverId, "connect", deps.actions?.connect)
  const planDisconnect: McpMutationBackend["planDisconnect"] = (input) =>
    liveActionPlan(input.serverId, "disconnect", deps.actions?.disconnect)
  const planReconnect: McpMutationBackend["planReconnect"] = (input) =>
    liveActionPlan(input.serverId, "reconnect", deps.actions?.reconnect)

  const planAuthRemove: McpMutationBackend["planAuthRemove"] = (input) =>
    Effect.gen(function* () {
      if (!input.serverId) return yield* Effect.fail(invalidArg("serverId", "server id is required"))
      if (!deps.authClear)
        return yield* Effect.fail<McpMutationError>({ type: "mcp_unavailable", reason: "mcp credential store is not bound" })
      yield* Effect.tryPromise({
        try: () => deps.authClear!.remove(input.serverId),
        catch: () => ({ type: "mcp_unavailable" as const, reason: "mcp credential store is unreachable" }),
      })
      return {
        authority: MCP_AUTH_AUTHORITY,
        apply: (current: unknown) => {
          const map = parseMap(current)
          map[input.serverId] = { action: "remove", updatedAtMs: now() }
          return map
        },
      }
    })

  return {
    planServerAdd,
    planServerUpdate,
    planServerDelete,
    planServerDisable,
    planLoggingSet,
    planExperimentalToggle,
    planExtensionToggle,
    planResourcePolicySet,
    planConnect,
    planDisconnect,
    planReconnect,
    planAuthRemove,
  }
}

/** The live-host seams the composition root injects alongside the read seam (T007, T008-T010). */
export interface McpServiceLiveDeps {
  /** The live-server read source backing `mcp.server.list`/`status`/`capabilities` (T007). */
  readonly servers?: McpLiveServerSource
  /** The mutation-plan deps (config authority + optional live actions + credential clear) (T008-T010). */
  readonly mutations?: McpMutationDeps
}

/**
 * Build the `override` for `createLiveMcpBackend`. Wires the faithful `auth.status` +
 * `resource.admin.list`/`templates` reads (Feature 014); when `live.servers` is bound
 * the live-host server reads back `mcp.server.list`/`status`/`capabilities` (T007), and
 * when `live.mutations` is bound the config-backed + live-service mcp verbs return
 * `mutation_plan`s (T008-T010). Absent live deps leave those verbs the honest typed
 * gap. The composition root injects this over `MCP.Service` + `McpAuth`.
 */
export const createMcpServiceOverride = (reader: McpHostReader, live?: McpServiceLiveDeps): Partial<McpAdminBackend> => ({
  auth: liveAuthPort(reader),
  resource: liveResourcePort(reader),
  ...(live?.servers ? { liveServer: liveServerReader(live.servers) } : {}),
  ...(live?.mutations ? { mutations: createMcpMutations(live.mutations) } : {}),
})
