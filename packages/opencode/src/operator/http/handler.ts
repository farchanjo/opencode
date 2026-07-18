/**
 * Operator HTTP routes (T025–T028) — pure Request → Response.
 * Access control uses serverBind + client socket IP only (never Host/XFF).
 */
import {
  ERROR_HTTP_STATUS,
  listReservedIds,
  parseCommandId,
  parseScope,
  RESERVED_CATALOG_VERSION,
  type CommandRequest,
  type CommandResult,
  type ErrorCode,
  type OperatorCommandDescriptor,
} from "@opencode-ai/core/operator"
import type { Dispatcher } from "../application/dispatcher"
import type { OperatorCommandRegistry } from "../application/registry"
import { bindOperatorPrincipal, constantTimeEqual, type AuthContext } from "../auth/principal"
import { assertOperatorRequestAccess, assertOriginPolicy } from "./loopback"

const MAX_BODY_BYTES = 256 * 1024
const MAX_JSON_DEPTH = 12

export type OperatorHttpDeps = {
  readonly dispatcher: Dispatcher
  readonly registry: OperatorCommandRegistry
  readonly resolveAuth: (request: Request) => AuthContext | Promise<AuthContext>
  /**
   * Configured listen hostname. Operator routes must not serve if non-loopback.
   */
  readonly serverBind: string
  /**
   * Actual client socket IP from server runtime (requestIP / remoteAddress).
   * Must NOT read Host/X-Forwarded-For/x-opencode-socket-host.
   */
  readonly getClientIp: (request: Request) => string | null
  /**
   * Active project id from Instance/server context (not body).
   * Used as projectBinding and default project scope.ref when injectScope is true.
   */
  readonly getProjectId?: (request: Request) => string | null
  /**
   * When true and body omits scope, inject {kind:project, ref: projectId}.
   * When false (default), missing scope is invalid_argument.
   */
  readonly injectProjectScopeWhenOmitted?: boolean
  readonly nowMs?: () => number
  /**
   * Optional ConfigPort for mutation preflight (version/configured only).
   * Never exposes raw config payload/secrets.
   */
  readonly config?: {
    readonly get: (authority: string) => Promise<{ version?: string } | null>
  }
  /**
   * T041/R3: dynamic feature flag. When false, all routes (except already
   * blocked non-loopback) return unavailable/404. Evaluated per request.
   */
  readonly resolveFeatureEnabled?: () => boolean | Promise<boolean>
}

export function createOperatorHttpHandler(deps: OperatorHttpDeps) {
  return async function handleOperatorHttp(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, "") || "/"

    // Gate: configured bind + real client IP (never Host header)
    const access = assertOperatorRequestAccess({
      serverBind: deps.serverBind,
      clientIp: deps.getClientIp(request),
    })
    if (!access.ok) {
      // Non-loopback bind or non-loopback client: behave as unmounted (404) for bind fail,
      // 403 for client spoof attempts on loopback bind.
      const status = access.reason.includes("forbids non-loopback bind") ? 404 : 403
      return json(
        {
          ok: false,
          id: "operator.http",
          outcome: "forbidden_scope",
          kind: "operator.admin_result",
          error: { code: "forbidden_scope", message: access.reason, retryable: false },
        },
        status,
      )
    }

    const origin = assertOriginPolicy({
      method: request.method,
      origin: request.headers.get("origin"),
    })
    if (!origin.ok) {
      return json(
        {
          ok: false,
          id: "operator.http",
          outcome: "unauthorized",
          kind: "operator.admin_result",
          error: { code: "unauthorized", message: origin.reason, retryable: false },
        },
        401,
      )
    }

    // T041/R3: dynamic flag after loopback gate (enable/disable same process)
    if (deps.resolveFeatureEnabled) {
      const enabled = await deps.resolveFeatureEnabled()
      if (!enabled) {
        return json(
          {
            ok: false,
            id: "operator.http",
            outcome: "unavailable",
            kind: "operator.admin_result",
            error: {
              code: "unavailable",
              message: "operator_control_plane disabled",
              retryable: false,
            },
          },
          404,
        )
      }
    }

    if (request.method === "GET" && pathEnds(path, "/operator/v1/health")) {
      // R5: strictly minimal loopback health — no secrets/catalog.
      // Unauthenticated ONLY because assertOperatorRequestAccess already required
      // loopback bind + real loopback client socket IP (fail-closed if IP missing).
      return json({ ok: true, service: "operator" }, 200)
    }

    if (request.method === "GET" && pathEnds(path, "/operator/v1/registry")) {
      const auth = await deps.resolveAuth(request)
      if (!auth.authenticated) return unauthorized("registry requires authentication")
      const descriptors = deps.registry.list().map(publicDescriptor)
      return json(
        {
          ok: true,
          catalogVersion: deps.registry.catalogVersion(),
          reservedCatalogVersion: RESERVED_CATALOG_VERSION,
          ids: listReservedIds(),
          commands: descriptors,
        },
        200,
      )
    }

    if (request.method === "POST" && pathEnds(path, "/operator/v1/commands")) {
      return handleCommand(request, deps)
    }

    if (request.method === "POST" && pathEnds(path, "/operator/v1/preflight")) {
      return handlePreflight(request, deps)
    }

    return json(
      {
        ok: false,
        id: "operator.http",
        outcome: "invalid_argument",
        kind: "operator.admin_result",
        error: {
          code: "invalid_argument",
          message: `unknown route ${request.method} ${path}`,
          retryable: false,
        },
      },
      404,
    )
  }
}

async function handlePreflight(request: Request, deps: OperatorHttpDeps): Promise<Response> {
  const auth = await deps.resolveAuth(request)
  if (!auth.authenticated) return unauthorized("preflight requires authentication")
  if (!deps.config) {
    return json(
      {
        ok: false,
        code: "unavailable",
        message: "preflight ConfigPort not available",
      },
      503,
    )
  }
  const raw = await request.arrayBuffer()
  if (raw.byteLength > MAX_BODY_BYTES) return badRequest(`body exceeds ${MAX_BODY_BYTES} bytes`)
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return badRequest("invalid JSON body")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return badRequest("body must be a JSON object")
  }
  const record = body as Record<string, unknown>
  if ("principal" in record && record.principal !== undefined) {
    return badRequest("principal must not be supplied in body")
  }
  const commandId = typeof record.commandId === "string" ? record.commandId : ""
  const idParse = parseCommandId(commandId)
  if (!idParse.ok) return badRequest(idParse.reason)
  const authority = commandId.split(".")[0] ?? commandId
  const entry = await deps.config.get(authority)
  return json(
    {
      ok: true,
      commandId,
      authority,
      currentVersion: entry?.version ?? null,
      configured: entry !== null,
      hasPayload: entry !== null,
      // never raw config / secrets
    },
    200,
  )
}

async function handleCommand(request: Request, deps: OperatorHttpDeps): Promise<Response> {
  const ct = request.headers.get("content-type") ?? ""
  if (!ct.includes("application/json")) {
    return badRequest("Content-Type must be application/json")
  }

  const raw = await request.arrayBuffer()
  if (raw.byteLength > MAX_BODY_BYTES) {
    return badRequest(`body exceeds ${MAX_BODY_BYTES} bytes`)
  }

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return badRequest("invalid JSON body")
  }

  if (!isBoundedJson(body, 0, MAX_JSON_DEPTH)) {
    return badRequest("JSON depth/size bound exceeded")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return badRequest("body must be a JSON object")
  }

  const record = body as Record<string, unknown>

  // Compatibility: body principal is ignored for authority; presence with spoof kind rejected
  if ("principal" in record && record.principal !== undefined) {
    return badRequest("principal must not be supplied in body; server auth binds principal")
  }

  const idRaw = typeof record.id === "string" ? record.id : ""
  const idParse = parseCommandId(idRaw)
  if (!idParse.ok) return badRequest(idParse.reason)

  const descriptor = deps.registry.lookup(idParse.value)
  const mutates = descriptor?.mutates ?? true

  const projectId = deps.getProjectId?.(request) ?? null
  const auth = await deps.resolveAuth(request)
  const bound = bindOperatorPrincipal({
    auth: {
      ...auth,
      // projectBinding only from server/instance context — never body
      projectBinding: projectId,
    },
    mutates,
  })
  if (!bound.ok) return unauthorized(bound.reason)

  // Scope: required unless injectProjectScopeWhenOmitted + projectId
  let scope: CommandRequest["scope"]
  if (record.scope === undefined || record.scope === null) {
    if (deps.injectProjectScopeWhenOmitted && projectId) {
      scope = { kind: "project", ref: projectId }
    } else {
      return badRequest("scope is required")
    }
  } else {
    const scopeParse = parseScope(record.scope)
    if (!scopeParse.ok) return badRequest(scopeParse.reason)
    scope = scopeParse.value
    // Cross-project: project-bound principal cannot target other project
    if (
      bound.principal.projectBinding &&
      scope.kind === "project" &&
      scope.ref !== bound.principal.projectBinding
    ) {
      return forbidden("cross-project scope denied")
    }
  }

  const commandRequest: CommandRequest = {
    id: idParse.value,
    principal: bound.principal,
    scope,
    source: "api",
    confirm: record.confirm === true,
    isTty: false,
    version: typeof record.version === "string" ? record.version : undefined,
    idempotencyKey:
      typeof record.idempotencyKey === "string"
        ? record.idempotencyKey
        : (request.headers.get("idempotency-key") ?? undefined),
    payload: record.payload,
  }

  const result = await deps.dispatcher.dispatchRequest(commandRequest)
  return json(result, statusForResult(result))
}

function pathEnds(path: string, suffix: string): boolean {
  return path === suffix || path.endsWith(suffix)
}

function statusForResult(result: CommandResult): number {
  if (result.ok) {
    if (result.outcome === "idempotent_replay") return 200
    if (result.outcome === "audit_pending") return 202
    return 200
  }
  const code = result.error?.code
  if (code && code in ERROR_HTTP_STATUS) return ERROR_HTTP_STATUS[code as ErrorCode]
  if (result.outcome in ERROR_HTTP_STATUS) return ERROR_HTTP_STATUS[result.outcome as ErrorCode]
  return 500
}

function publicDescriptor(d: OperatorCommandDescriptor) {
  return {
    id: String(d.id),
    aliases: d.aliases,
    mutates: d.mutates,
    scopesAllowed: d.scopesAllowed,
    confirmRequired: d.confirmRequired,
    offlineCapable: d.offlineCapable,
    schemaVersion: d.schemaVersion,
    authority: d.authority,
    domain: d.domain,
    title: d.title,
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function badRequest(message: string): Response {
  return json(
    {
      ok: false,
      id: "operator.http",
      outcome: "invalid_argument",
      kind: "operator.admin_result",
      error: { code: "invalid_argument", message, retryable: false },
    },
    400,
  )
}

function unauthorized(message: string): Response {
  return json(
    {
      ok: false,
      id: "operator.http",
      outcome: "unauthorized",
      kind: "operator.admin_result",
      error: { code: "unauthorized", message, retryable: false },
    },
    401,
  )
}

function forbidden(message: string): Response {
  return json(
    {
      ok: false,
      id: "operator.http",
      outcome: "forbidden_scope",
      kind: "operator.admin_result",
      error: { code: "forbidden_scope", message, retryable: false },
    },
    403,
  )
}

function isBoundedJson(value: unknown, depth: number, maxDepth: number): boolean {
  if (depth > maxDepth) return false
  if (value === null || typeof value !== "object") return true
  if (Array.isArray(value)) {
    if (value.length > 1000) return false
    return value.every((v) => isBoundedJson(v, depth + 1, maxDepth))
  }
  const keys = Object.keys(value as object)
  if (keys.length > 200) return false
  return keys.every((k) => isBoundedJson((value as Record<string, unknown>)[k], depth + 1, maxDepth))
}

/**
 * Auth from Authorization: Basic and optional sandbox token.
 * No password configured ⇒ unauthenticated (registry/commands deny).
 */
export function resolveAuthFromHeaders(input: {
  authorization: string | null
  expectedPassword?: string
  expectedUsername?: string
  sandboxToken?: string
  sandboxTokenHeader?: string | null
}): AuthContext {
  if (input.sandboxToken && input.sandboxTokenHeader) {
    if (constantTimeEqual(input.sandboxTokenHeader, input.sandboxToken)) {
      return { authenticated: true, subject: "sandbox-operator", role: "operator", projectBinding: null }
    }
  }

  if (!input.authorization?.startsWith("Basic ")) {
    return { authenticated: false, role: "anonymous" }
  }
  if (!input.expectedPassword) {
    return { authenticated: false, role: "anonymous" }
  }
  try {
    const decoded = atob(input.authorization.slice(6))
    const colon = decoded.indexOf(":")
    const username = colon >= 0 ? decoded.slice(0, colon) : decoded
    const password = colon >= 0 ? decoded.slice(colon + 1) : ""
    const userOk = constantTimeEqual(username, input.expectedUsername ?? "opencode")
    const passOk = constantTimeEqual(password, input.expectedPassword)
    if (userOk && passOk) {
      return { authenticated: true, subject: username, role: "operator", projectBinding: null }
    }
    return { authenticated: false, role: "anonymous" }
  } catch {
    return { authenticated: false, role: "anonymous" }
  }
}

export * as OperatorHttpHandler from "./handler"
