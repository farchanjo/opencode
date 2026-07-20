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
import { SubscriptionMachine } from "@opencode-ai/core/mcp/subscription-machine"
import type {
  AuthPort,
  ExperimentalPort,
  ExtensionPort,
  LoggingPort,
  ResourceAdminPort,
  ServerLifecyclePort,
} from "@opencode-ai/protocol/mcp/ports"
import type {
  ExperimentalFlag,
  ExperimentalFlagState,
  ExperimentalStatusOutput,
  ExtensionStatusOutput,
  McpAuthStatus,
  McpResourceDescriptor,
  McpResourceTemplateDescriptor,
} from "@opencode-ai/protocol/mcp/commands"
import type { OperatorMutationEffectResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type {
  LiveServerRead,
  McpAdminBackend,
  McpAuthFinishActionInput,
  McpAuthStartActionInput,
  McpLiveReadError,
  McpLiveServerReader,
  McpMutationBackend,
  McpMutationError,
  McpResourceSubscribeActionInput,
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
export const MCP_CONFIG_AUTHORITY = "global:mcp" as const
/** The store-scoped authority the live-service actions record their resulting connection outcome under. */
export const MCP_CONNECTIONS_AUTHORITY = "global:mcp-connections" as const
/** The store-scoped authority `auth.remove` records its local credential-clear outcome under. */
export const MCP_AUTH_AUTHORITY = "global:mcp-auth" as const

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

// =============================================================================
// Feature 019 / T010-T011 — interactive-OAuth delegation + resource subscription
// =============================================================================

/** The outcome of the live `MCP.Service.startAuth` delegation (Feature 019 / FR8). */
export type McpAuthStartResult =
  | { readonly kind: "ok"; readonly authorizationUrl: string; readonly oauthState: string }
  | { readonly kind: "not_found" }

/** The outcome of the live `MCP.Service.finishAuth` delegation (Feature 019 / FR8). */
export type McpAuthFinishResult =
  | { readonly kind: "ok"; readonly status: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "state_mismatch" }

/**
 * The live interactive-OAuth flow seam the composition root implements over
 * `MCP.Service.startAuth`/`finishAuth` (Feature 019 / T010, FR8). `start` returns the
 * authorize URL (not a secret) and starts the loopback callback listener; `finish`
 * validates the CSRF state and completes the exchange. No token, code verifier, or
 * secret material crosses this seam — only the non-secret authorize URL and a bounded
 * connection status.
 */
export interface McpAuthDelegate {
  readonly start: (serverId: string) => Promise<McpAuthStartResult>
  readonly finish: (serverId: string, input: { oauthState: string; callbackParams: string }) => Promise<McpAuthFinishResult>
}

/** Whether a server advertises `resources.subscribe` on a live client (Feature 019 / FR9). */
export type McpSubscribeCapability =
  | { readonly kind: "capable" }
  | { readonly kind: "capability_absent" }
  | { readonly kind: "no_client" }

/**
 * The subscribe-capable live client seam the composition root implements over the SDK
 * `subscribeResource`/`unsubscribeResource` (Feature 019 / T011, FR9). `capability`
 * reports the negotiated `resources.subscribe` capability (absent → fail-closed
 * `capability_absent`; no connected client → typed unavailable); `subscribe`/
 * `unsubscribe` drive the live client subscription. Never fabricates a subscription.
 */
export interface McpSubscriptionClient {
  readonly capability: (serverId: string) => Promise<McpSubscribeCapability>
  readonly subscribe: (serverId: string, uri: string) => Promise<void>
  readonly unsubscribe: (serverId: string, uri: string) => Promise<void>
}

export interface McpMutationDeps {
  /** The operator `store.config` authority the config-backed verbs persist through `mutateAuthority`. */
  readonly config: ConfigPort
  /** The live `MCP.Service` connection actions; absent leaves connect/disconnect/reconnect a typed `mcp_unavailable` gap. */
  readonly actions?: McpLiveActions
  /** The local credential-clear seam; absent leaves `auth.remove` a typed `mcp_unavailable` gap (T010). */
  readonly authClear?: McpAuthClear
  /** Feature 019 / T010 — the interactive-OAuth delegate; absent leaves `auth.start`/`finish` a typed gap (FR8). */
  readonly auth?: McpAuthDelegate
  /** Feature 019 / T011 — the subscribe-capable live client; absent leaves subscribe/unsubscribe a typed gap (FR9). */
  readonly subscription?: McpSubscriptionClient
  readonly now?: () => number
}

/** Feature 019 — the never-written effectOnly authorities the auth/subscription flows record under. */
export const MCP_AUTH_FLOW_AUTHORITY = "global:mcp-auth-flow" as const
export const MCP_SUBSCRIPTION_AUTHORITY = "global:mcp-subscriptions" as const

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

  /**
   * Validate the request, then return a plan whose `effect` DEFERS the live-service connection
   * action to `mutateAuthority` (run only after all checks pass, T009, FR4, ADR-0017). The op is
   * never performed at plan-build time, so a rejected mutation or an idempotent replay never
   * re-runs connect/disconnect/reconnect. `apply` records the resulting status; a `not_found`/
   * unreachable service is a typed effect failure that commits nothing.
   */
  const liveActionPlan = (
    serverId: string,
    action: "connect" | "disconnect" | "reconnect",
    run: ((serverId: string) => Promise<McpLiveActionOutcome>) | undefined,
  ): Effect.Effect<OperatorMutationPlan, McpMutationError> =>
    Effect.gen(function* () {
      if (!serverId) return yield* Effect.fail(invalidArg("serverId", "server id is required"))
      if (!run) return yield* Effect.fail<McpMutationError>({ type: "mcp_unavailable", reason: "mcp live service is not bound" })
      const action_ = action
      return {
        authority: MCP_CONNECTIONS_AUTHORITY,
        effect: async (): Promise<OperatorMutationEffectResult> => {
          let outcome: McpLiveActionOutcome
          try {
            outcome = await run(serverId)
          } catch {
            return { ok: false, code: "unavailable", message: "mcp live service is unreachable" }
          }
          if (outcome.kind === "not_found")
            return { ok: false, code: "invalid_argument", message: `server not found: ${serverId}`, details: { field: "id" } }
          return { ok: true, value: outcome.status }
        },
        apply: (current: unknown, effectValue?: unknown) => {
          const map = parseMap(current)
          map[serverId] = { action: action_, status: typeof effectValue === "string" ? effectValue : "unknown", updatedAtMs: now() }
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
      const authClear = deps.authClear
      const serverId = input.serverId
      return {
        authority: MCP_AUTH_AUTHORITY,
        // Deferred: the local credential clear runs inside mutateAuthority's effect phase, never at
        // plan build — so a rejected mutation or an idempotent replay never re-clears the credential.
        effect: async (): Promise<OperatorMutationEffectResult> => {
          try {
            await authClear.remove(serverId)
            return { ok: true }
          } catch {
            return { ok: false, code: "unavailable", message: "mcp credential store is unreachable" }
          }
        },
        apply: (current: unknown) => {
          const map = parseMap(current)
          map[serverId] = { action: "remove", updatedAtMs: now() }
          return map
        },
      }
    })

  // Feature 019 / T010 (FR8) — the interactive-OAuth delegation plans. The command port
  // has already confirmed an interactive TUI surface (a headless surface never reaches
  // here — it keeps the honest typed gap). Both are effectOnly: they run the live flow
  // once, after every dispatcher check, and record NO authority document (the credential
  // lives inside `McpAuth`, never the operator envelope). The effect value surfaces the
  // non-secret authorize URL / bounded status; no token or code verifier crosses the seam.
  const planAuthStart: McpMutationBackend["planAuthStart"] = (input: McpAuthStartActionInput) =>
    Effect.gen(function* () {
      if (!input.serverId) return yield* Effect.fail(invalidArg("serverId", "server id is required"))
      if (!deps.auth) return yield* Effect.fail<McpMutationError>({ type: "mcp_unavailable", reason: "mcp auth delegation is not bound" })
      const delegate = deps.auth
      const serverId = input.serverId
      return {
        authority: MCP_AUTH_FLOW_AUTHORITY,
        effectOnly: true,
        effect: async (): Promise<OperatorMutationEffectResult> => {
          let outcome: McpAuthStartResult
          try {
            outcome = await delegate.start(serverId)
          } catch {
            return { ok: false, code: "unavailable", message: "mcp auth flow is unreachable" }
          }
          if (outcome.kind === "not_found")
            return { ok: false, code: "invalid_argument", message: `server not found: ${serverId}`, details: { field: "id" } }
          // The authorize URL is NOT a secret; the oauthState is a CSRF nonce, not a credential.
          return { ok: true, value: { serverId, delegation: "interactive_delegated", authorizationUrl: outcome.authorizationUrl } }
        },
        apply: (current: unknown) => current ?? null,
      }
    })

  const planAuthFinish: McpMutationBackend["planAuthFinish"] = (input: McpAuthFinishActionInput) =>
    Effect.gen(function* () {
      if (!input.serverId) return yield* Effect.fail(invalidArg("serverId", "server id is required"))
      if (!deps.auth) return yield* Effect.fail<McpMutationError>({ type: "mcp_unavailable", reason: "mcp auth delegation is not bound" })
      const delegate = deps.auth
      const serverId = input.serverId
      const oauthState = input.oauthState
      const callbackParams = input.callbackParams
      return {
        authority: MCP_AUTH_FLOW_AUTHORITY,
        effectOnly: true,
        effect: async (): Promise<OperatorMutationEffectResult> => {
          let outcome: McpAuthFinishResult
          try {
            outcome = await delegate.finish(serverId, { oauthState, callbackParams })
          } catch {
            return { ok: false, code: "unavailable", message: "mcp auth flow is unreachable" }
          }
          if (outcome.kind === "not_found")
            return { ok: false, code: "invalid_argument", message: `server not found: ${serverId}`, details: { field: "id" } }
          if (outcome.kind === "state_mismatch")
            return { ok: false, code: "conflict", message: "oauth state mismatch" }
          return { ok: true, value: { serverId, delegation: "interactive_delegated", status: outcome.status } }
        },
        apply: (current: unknown) => current ?? null,
      }
    })

  // Feature 019 / T011 (FR9) — resource subscribe/unsubscribe over the dual-authority
  // machine + a subscribe-capable live client. effectOnly: the live subscription is the
  // side effect; the operator envelope records nothing (no fabricated subscription). An
  // absent capability fails closed via the pure machine (`capability_absent`); no client
  // is a typed unavailable; both commit NOTHING.
  const planSubscription = (
    serverId: string,
    uri: string,
    verb: "subscribe" | "unsubscribe",
  ): Effect.Effect<OperatorMutationPlan, McpMutationError> =>
    Effect.gen(function* () {
      if (!serverId) return yield* Effect.fail(invalidArg("serverId", "server id is required"))
      if (!uri) return yield* Effect.fail(invalidArg("uri", "resource uri is required"))
      if (!deps.subscription)
        return yield* Effect.fail<McpMutationError>({ type: "mcp_unavailable", reason: "mcp subscription client is not bound" })
      const client = deps.subscription
      return {
        authority: MCP_SUBSCRIPTION_AUTHORITY,
        effectOnly: true,
        effect: async (): Promise<OperatorMutationEffectResult> => {
          let cap: McpSubscribeCapability
          try {
            cap = await client.capability(serverId)
          } catch {
            return { ok: false, code: "unavailable", message: "mcp subscription client is unreachable" }
          }
          if (cap.kind === "no_client") return { ok: false, code: "unavailable", message: "mcp live service is not bound" }
          // The operator grant is implied by the audited operator principal + confirmation gate;
          // the dual authority is server capability AND operator grant (fail-closed, C10).
          const authority = { serverCapable: cap.kind === "capable", operatorGranted: true }
          const decision = SubscriptionMachine.apply("unsubscribed", "subscribe", authority)
          if (decision.kind === "fail_closed")
            return {
              ok: false,
              code: "invalid_argument",
              message: `subscription ${decision.reason}`,
              details: { reason: decision.reason },
            }
          try {
            if (verb === "subscribe") await client.subscribe(serverId, uri)
            else await client.unsubscribe(serverId, uri)
          } catch {
            return { ok: false, code: "unavailable", message: `mcp ${verb} failed` }
          }
          return { ok: true, value: { serverId, resourceUri: uri, state: verb === "subscribe" ? "subscribed" : "unsubscribed" } }
        },
        apply: (current: unknown) => current ?? null,
      }
    })

  const planResourceSubscribe: McpMutationBackend["planResourceSubscribe"] = (input: McpResourceSubscribeActionInput) =>
    planSubscription(input.serverId, input.uri, "subscribe")
  const planResourceUnsubscribe: McpMutationBackend["planResourceUnsubscribe"] = (input: McpResourceSubscribeActionInput) =>
    planSubscription(input.serverId, input.uri, "unsubscribe")

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
    planAuthStart,
    planAuthFinish,
    planResourceSubscribe,
    planResourceUnsubscribe,
  }
}

// =============================================================================
// Feature 019 / T012 (FR10) — truthful Experimental/Extension toggle badges
// =============================================================================
//
// The `mcp.experimental.status`/`mcp.extension.status` reads project the operator's
// config-backed flag SSOT (the same `store.config` MCP authority the toggles write via
// `planExperimentalToggle`/`planExtensionToggle`) so a connected server's control rows
// render `Enabled`/`Disabled` instead of `Unknown`. The runtime `cfg.mcp` schema has NO
// such field — reconciling the two SSOTs is a documented boundary (spec Out of Scope);
// the badge reflects only the config-backed flag the operator toggle owns. A genuinely
// absent server carries no aggregate state, so it still renders `Unknown` honestly.

/** The four per-server experimental flags, in rollout order (mirrors `EXPERIMENTAL_FLAGS`). */
const EXPERIMENTAL_FLAG_ORDER = ["tasks", "sampling", "elicitation", "content-stream"] as const

/** Read the config-backed mcp server entry for one server id; null when genuinely absent. */
function readServerEntry(
  config: ConfigPort,
  serverId: string,
): Effect.Effect<McpServerEntry | null, { readonly type: "unavailable"; readonly reason: string }> {
  return Effect.tryPromise({
    try: () => config.get(MCP_CONFIG_AUTHORITY),
    catch: () => ({ type: "unavailable" as const, reason: "mcp config authority is unreachable" }),
  }).pipe(Effect.map((entry) => parseDoc(entry?.payload ?? null).servers[serverId] ?? null))
}

/** The config-backed `ExperimentalPort`: `status` reads the flag SSOT; enable/disable route through the mutation seam. */
function liveExperimentalPort(config: ConfigPort): ExperimentalPort {
  const gap = () => Effect.fail({ type: "unavailable" as const, reason: NOT_BOUND })
  return {
    status: (input) =>
      readServerEntry(config, input.serverId).pipe(
        Effect.map((entry): ExperimentalStatusOutput => {
          if (!entry) return { flags: [] } // genuinely absent → no aggregate `enabled` → Unknown
          const set = new Set(entry.experimental ?? [])
          const flags: ExperimentalFlagState[] = EXPERIMENTAL_FLAG_ORDER.map((flag) => ({
            serverId: input.serverId,
            flag: flag as ExperimentalFlag,
            enabled: set.has(flag),
          }))
          return { flags, enabled: set.has("tasks") }
        }),
      ),
    enable: gap,
    disable: gap,
  }
}

/** The config-backed `ExtensionPort`: `status` reads the flag SSOT; enable/disable route through the mutation seam. */
function liveExtensionPort(config: ConfigPort): ExtensionPort {
  const gap = () => Effect.fail({ type: "unavailable" as const, reason: NOT_BOUND })
  return {
    status: (input) =>
      readServerEntry(config, input.serverId).pipe(
        Effect.map((entry): ExtensionStatusOutput => {
          if (!entry) return { capabilityString: "experimental/opencode.contentStream" } // absent → Unknown
          return { enabled: entry.extensionEnabled === true, capabilityString: "experimental/opencode.contentStream" }
        }),
      ),
    enable: gap,
    disable: gap,
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
  // Feature 019 / T012 — when the config authority is bound, the Experimental/Extension
  // status reads project the config-backed flag SSOT so the toggle badges render truthfully.
  ...(live?.mutations
    ? { experimental: liveExperimentalPort(live.mutations.config), extension: liveExtensionPort(live.mutations.config) }
    : {}),
})
