/**
 * Feature 008 / T034 (S22) — the `mcp.*` inbound command adapter.
 *
 * Bridges the 30 reserved Feature 007 `mcp.*` operator command ids to the typed
 * `McpAdminPort` (T034) through the Feature 007 dispatcher's `DomainInvoke` seam,
 * exactly like `semantic-command-port.ts` (Feature 006) and
 * `outputspool-command-port.ts` (Feature 005). Feature 007 remains the SOLE
 * registration authority: this adapter registers NO command ids — it only supplies
 * the `mcp` domain `invoke`, replacing the `not_implemented` stub. A plugin/MCP/
 * custom/`session.command` registration colliding with a reserved `mcp.*` id is
 * refused by the Feature 007 reserved-name guard; `RESERVED_MCP_IDS` mirrors the
 * catalog so the collision is structured `reserved_name` (FR48, C25).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission): the
 * payload never reaches a model, and ordinary list/status/show/capabilities make
 * ZERO provider/model calls and inject ZERO transcript (FR49, AC15). Mutations
 * carry an operator principal + explicit scope + version/CAS and return a redacted
 * result; `disconnect`/`disable`/`delete`/`mcp.experimental.enable`/`mcp.auth.remove`
 * require the `confirmed` flag and the backend returns `confirmation_required`
 * without it. An LLM attempt on any `mcp.*` id is denied (the data plane never
 * reaches these ids, FR50). This adapter emits exactly one bounded, secret-free
 * audit event per dispatch (C26).
 */
export * as McpCommandPort from "./mcp-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import { RESERVED_MCP_COMMAND_IDS } from "@opencode-ai/protocol/mcp/commands"
import type {
  ExperimentalFlag,
  McpLogLevel,
  OperatorPrincipal,
  Scope,
  TransportKind,
} from "@opencode-ai/protocol/mcp/commands"
import type { FailureHandlerResult, HandlerContext, HandlerResult } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { McpAdminPort, McpAuditEvent, McpAuditSink } from "./mcp-port"

/** The 30 reserved `mcp.*` operator ids (catalog 1.3.0); a plugin/MCP collision is rejected (C25). */
export const RESERVED_MCP_IDS: ReadonlySet<string> = new Set(RESERVED_MCP_COMMAND_IDS)

/** True when `id` is a reserved mcp operator id; plugin/MCP registration must be refused (C25). */
export const isReservedMcpId = (id: string): boolean => RESERVED_MCP_IDS.has(id)

export interface McpDomainPorts {
  readonly mcp: { readonly invoke: DomainInvoke }
}

export interface McpCommandDeps {
  readonly port: McpAdminPort
  readonly audit: McpAuditSink
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function num(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function bool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function fail(code: FailureHandlerResult["code"], message: string): FailureHandlerResult {
  return { kind: "failure", code, message }
}

/** Map the Feature 007 operator principal onto the mcp operator principal (C25). */
function toOperator(principal: OperatorPrincipalCore): OperatorPrincipal {
  const kind =
    principal.kind === "operator" || principal.kind === "manager-view" || principal.kind === "system"
      ? principal.kind
      : "system"
  return { kind, id: principal.subject }
}

/** Map any typed port error onto the operator audit outcome + failure envelope (content-free). */
function mapError(error: { readonly type: string }): { outcome: McpAuditEvent["outcome"]; failure: FailureHandlerResult } {
  const type = error.type
  if (type === "denied") return { outcome: "denied", failure: fail("unauthorized", "denied") }
  if (type === "confirmation_required")
    return { outcome: "rejected", failure: fail("invalid_argument", "interactive confirmation is required") }
  if (type === "version_conflict" || type === "oauth_state_mismatch")
    return { outcome: "conflict", failure: fail("invalid_argument", `conflict: ${type}`) }
  if (type === "not_implemented") return { outcome: "rejected", failure: fail("not_implemented", "operation is not implemented") }
  if (type.endsWith("unavailable") || type === "secret_backend_unavailable")
    return { outcome: "unavailable", failure: fail("unavailable", type) }
  return { outcome: "rejected", failure: fail("invalid_argument", type) }
}

const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

/** Run a port effect, emit exactly one audit event, and shape the result (mirrors semantic). */
function runner(deps: McpCommandDeps, commandId: string, principalId: string, target: string) {
  return <A>(
    effect: Effect.Effect<A, { readonly type: string }>,
    onSuccess: (value: A) => HandlerResult,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> => {
            const mapped = mapError(error)
            return deps.audit.record({ commandId, principalId, target, outcome: mapped.outcome }).pipe(Effect.as(mapped.failure))
          },
        }),
      ),
    )
}

interface Ctx {
  readonly id: string
  readonly payload: Record<string, unknown>
  readonly principal: OperatorPrincipal
  readonly scope: Scope
  readonly scopeId: string
  readonly run: ReturnType<typeof runner>
}

function serverInvoke(port: McpAdminPort, c: Ctx): Promise<HandlerResult> | null {
  const s = port.server
  const id = str(c.payload, ["id", "serverId", "server_id"]) ?? ""
  const version = num(c.payload, ["expectedVersion", "expected_version", "version"]) ?? 0
  switch (c.id) {
    case "mcp.server.list":
      return c.run(s.list({ scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    case "mcp.server.add":
      return c.run(
        s.add({
          scope: c.scope,
          scopeId: c.scopeId,
          name: str(c.payload, ["name"]) ?? "",
          transportKind: (str(c.payload, ["transportKind", "transport_kind"]) ?? "streamable_http") as TransportKind,
          endpoint: str(c.payload, ["endpoint"]) ?? "",
          secretRef: str(c.payload, ["secretRef", "secret_ref"]),
          principal: c.principal,
        }),
        (o) => query(o),
      )
    case "mcp.server.update":
      return c.run(
        s.update({
          id,
          expectedVersion: version,
          patch: asRecord(c.payload.patch) as never,
          casToken: str(c.payload, ["casToken", "cas_token"]) ?? "",
          principal: c.principal,
        }),
        (o) => query(o),
      )
    case "mcp.server.test":
      return c.run(s.test({ id, principal: c.principal }), (o) => query(o))
    case "mcp.server.connect":
      return c.run(s.connect({ id, principal: c.principal }), (o) => query(o))
    case "mcp.server.disconnect":
      return c.run(s.disconnect({ id, principal: c.principal }), (o) => query(o))
    case "mcp.server.reconnect":
      return c.run(s.reconnect({ id, principal: c.principal }), (o) => query(o))
    case "mcp.server.disable":
      return c.run(s.disable({ id, expectedVersion: version, principal: c.principal }), (o) => query(o))
    case "mcp.server.delete":
      return c.run(s.delete({ id, expectedVersion: version, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), (o) => query(o))
    case "mcp.server.status":
      return c.run(s.status({ id }), (o) => query(o))
    case "mcp.server.capabilities":
      return c.run(s.capabilities({ id }), (o) => query(o))
    default:
      return null
  }
}

function authInvoke(port: McpAdminPort, c: Ctx): Promise<HandlerResult> | null {
  const a = port.auth
  const serverId = str(c.payload, ["serverId", "server_id", "id"]) ?? ""
  switch (c.id) {
    case "mcp.auth.start":
      return c.run(a.start({ serverId, principal: c.principal }), (o) => query(o))
    case "mcp.auth.finish":
      return c.run(
        a.finish({
          serverId,
          oauthState: str(c.payload, ["oauthState", "oauth_state"]) ?? "",
          callbackParams: str(c.payload, ["callbackParams", "callback_params"]) ?? "",
          principal: c.principal,
        }),
        (o) => query(o),
      )
    case "mcp.auth.remove":
      return c.run(a.remove({ serverId, principal: c.principal }), (o) => query(o))
    case "mcp.auth.status":
      return c.run(a.status({ serverId }), (o) => query(o))
    default:
      return null
  }
}

function resourceInvoke(port: McpAdminPort, c: Ctx): Promise<HandlerResult> | null {
  const r = port.resource
  const serverId = str(c.payload, ["serverId", "server_id", "id"]) ?? ""
  const uri = str(c.payload, ["uri"]) ?? ""
  switch (c.id) {
    case "mcp.resource.admin.list":
      return c.run(r.list({ serverId, principal: c.principal }), (o) => query(o))
    case "mcp.resource.admin.templates":
      return c.run(r.templates({ serverId, principal: c.principal }), (o) => query(o))
    case "mcp.resource.admin.read":
      return c.run(r.read({ serverId, uri, principal: c.principal }), (o) => query(o))
    case "mcp.resource.admin.subscribe":
      return c.run(r.subscribe({ serverId, uri, principal: c.principal }), (o) => query(o))
    case "mcp.resource.admin.unsubscribe":
      return c.run(r.unsubscribe({ serverId, uri, principal: c.principal }), (o) => query(o))
    case "mcp.resource.admin.policy.show":
      return c.run(r.policyShow({ serverId }), (o) => query(o))
    case "mcp.resource.admin.policy.set":
      return c.run(r.policySet({ serverId, policy: asRecord(c.payload.policy) as never, principal: c.principal }), (o) => query(o))
    default:
      return null
  }
}

function otherInvoke(port: McpAdminPort, c: Ctx): Promise<HandlerResult> | null {
  const serverId = str(c.payload, ["serverId", "server_id", "id"]) ?? ""
  const flag = (str(c.payload, ["flag"]) ?? "tasks") as ExperimentalFlag
  switch (c.id) {
    case "mcp.logging.level.show":
      return c.run(port.logging.show({ serverId }), (o) => query(o))
    case "mcp.logging.level.set":
      return c.run(port.logging.set({ serverId, level: (str(c.payload, ["level"]) ?? "info") as McpLogLevel, principal: c.principal }), (o) => query(o))
    case "mcp.experimental.status":
      return c.run(port.experimental.status({ serverId }), (o) => query(o))
    case "mcp.experimental.enable":
      return c.run(port.experimental.enable({ serverId, flag, principal: c.principal }), (o) => query(o))
    case "mcp.experimental.disable":
      return c.run(port.experimental.disable({ serverId, flag, principal: c.principal }), (o) => query(o))
    case "mcp.extension.status":
      return c.run(port.extension.status({ serverId }), (o) => query(o))
    case "mcp.extension.enable":
      return c.run(port.extension.enable({ serverId, principal: c.principal }), (o) => query(o))
    case "mcp.extension.disable":
      return c.run(port.extension.disable({ serverId, principal: c.principal }), (o) => query(o))
    default:
      return null
  }
}

function mcpInvoke(deps: McpCommandDeps): DomainInvoke {
  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    if (!isReservedMcpId(id)) return Promise.resolve(fail("not_implemented", `mcp command ${id} is not a reserved id`))
    const payload = asRecord(ctx.request.payload)
    const principal = toOperator(ctx.request.principal)
    const scope: Scope = ctx.request.scope.kind === "global" ? "global" : "project"
    const scopeId = ctx.request.scope.ref ?? ""
    const c: Ctx = {
      id,
      payload,
      principal,
      scope,
      scopeId,
      run: runner(deps, id, principal.id, str(payload, ["id", "serverId", "server_id"]) ?? scopeId),
    }
    return (
      serverInvoke(deps.port, c) ??
      authInvoke(deps.port, c) ??
      resourceInvoke(deps.port, c) ??
      otherInvoke(deps.port, c) ??
      Promise.resolve(fail("not_implemented", `mcp command ${id} is not implemented`))
    )
  }
}

/**
 * Build the `mcp` DomainPort override. Wire it into the Feature 007 dispatcher via
 * `wireDomainPorts(createMcpDomainPorts({ port, audit }))` at the composition root
 * — it replaces the `not_implemented` stub without touching the registry (C25).
 */
export function createMcpDomainPorts(deps: McpCommandDeps): McpDomainPorts {
  return { mcp: { invoke: mcpInvoke(deps) } }
}
