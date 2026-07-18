/**
 * Feature 005 / T037 (S24) — the `output.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `output.stat|read|follow|export|share|release|
 * delete|purge|retention.set|quota.set` operator command ids to the typed
 * `OutputSpoolPort` (T037) through the Feature 007 dispatcher's `DomainInvoke`
 * seam, exactly like `langlock-command-port.ts` (Feature 004) and
 * `jobs-command-port.ts` (Feature 003). Feature 007 remains the SOLE registration
 * authority: this adapter registers NO command ids — it only supplies the
 * `output` domain `invoke`, replacing the `not_implemented` stub. Reserved-id
 * collisions (`output.*`) are rejected by the Feature 007 reserved-name guard;
 * `RESERVED_OUTPUT_IDS` mirrors the catalog so a plugin/MCP/custom registration
 * of these ids is refused with a structured `reserved_name` error (C19).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission):
 * the payload never reaches a model, and every port call is model-independent and
 * zero-cost (FR41, AC13). Consume actions (`stat`/`read`/`follow`) re-evaluate
 * authorization per call; admin actions carry an operator principal + explicit
 * scope + version/CAS + idempotency enforced by the backend and return a Feature
 * 007 audit-correlation id, with export/share deny-by-default across projects
 * (FR42, FR44, C7, C17, AC15). This adapter is the single uniform operator
 * access-audit point and emits exactly one bounded, secret-free audit event per
 * dispatch.
 */
export * as OutputSpoolCommandPort from "./outputspool-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore, CommandRequest } from "@opencode-ai/core/operator"
import type {
  AdminError,
  OperatorPrincipal,
  SpoolReaderError,
} from "@opencode-ai/protocol/outputspool/commands"
import type { HandlerContext, HandlerResult, FailureHandlerResult } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { OutputSpoolAuditEvent, OutputSpoolAuditSink, OutputSpoolPort } from "./outputspool-port"

/** The ten reserved `output.*` operator ids (catalog 1.3.0); a plugin/MCP collision is rejected (C19). */
export const RESERVED_OUTPUT_IDS: ReadonlySet<string> = new Set([
  "output.stat", "output.read", "output.follow", "output.export", "output.share",
  "output.release", "output.delete", "output.purge", "output.retention.set", "output.quota.set",
])

/** True when `id` is a reserved content-plane operator id; plugin/MCP registration must be refused (C19). */
export const isReservedOutputId = (id: string): boolean => RESERVED_OUTPUT_IDS.has(id)

export interface OutputSpoolDomainPorts {
  readonly output: { readonly invoke: DomainInvoke }
}

export interface OutputSpoolCommandDeps {
  readonly port: OutputSpoolPort
  readonly audit: OutputSpoolAuditSink
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function firstString(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function firstNumber(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function fail(code: FailureHandlerResult["code"], message: string, details?: FailureHandlerResult["details"]): FailureHandlerResult {
  return { kind: "failure", code, message, details }
}

/** Map the Feature 007 operator principal onto the outputspool operator principal (C7). */
function toOperator(principal: OperatorPrincipalCore): OperatorPrincipal {
  const kind = principal.kind === "operator" || principal.kind === "manager-view" || principal.kind === "system"
    ? principal.kind
    : "system"
  return { kind, id: principal.subject }
}

function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): number {
  const fromPayload = firstNumber(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined) {
    const parsed = Number(request.version)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** Map a reader error onto the operator audit outcome + failure envelope. */
function readerToFailure(error: SpoolReaderError): { outcome: OutputSpoolAuditEvent["outcome"]; failure: FailureHandlerResult } {
  switch (error.type) {
    case "denied":
      return { outcome: "unauthorized", failure: fail("unauthorized", error.reason) }
    case "not_found":
      return { outcome: "rejected", failure: fail("invalid_argument", `output ${error.outputRef} not found`, { outputRef: error.outputRef }) }
    case "expired":
      return { outcome: "rejected", failure: fail("invalid_argument", "cursor expired") }
    case "invalid_cursor":
      return { outcome: "rejected", failure: fail("invalid_argument", "invalid cursor") }
    case "invalid_argument":
      return { outcome: "rejected", failure: fail("invalid_argument", error.reason, { field: error.field }) }
    case "unavailable":
      return { outcome: "rejected", failure: fail("unavailable", error.reason) }
    case "not_implemented":
      return { outcome: "rejected", failure: fail("not_implemented", "operation is not implemented") }
  }
}

/** Map an admin error onto the operator audit outcome + failure envelope. */
function adminToFailure(error: AdminError): { outcome: OutputSpoolAuditEvent["outcome"]; failure: FailureHandlerResult } {
  switch (error.type) {
    case "unauthorized":
      return { outcome: "unauthorized", failure: fail("unauthorized", error.reason) }
    case "cross_project_denied":
      return { outcome: "denied", failure: fail("unauthorized", "cross-project export/share is denied by default") }
    case "version_conflict":
      return { outcome: "conflict", failure: fail("invalid_argument", `version conflict: expected ${error.expectedVersion}, actual ${error.actualVersion}`, { expectedVersion: error.expectedVersion, actualVersion: error.actualVersion }) }
    case "reserved_name":
      return { outcome: "rejected", failure: fail("invalid_argument", `reserved id ${error.id}`, { id: error.id }) }
    case "not_found":
      return { outcome: "rejected", failure: fail("invalid_argument", `output ${error.outputRef} not found`, { outputRef: error.outputRef }) }
    case "legal_hold":
      return { outcome: "rejected", failure: fail("invalid_argument", `output ${error.outputRef} is under legal hold`, { outputRef: error.outputRef }) }
    case "quota":
      return { outcome: "rejected", failure: fail("invalid_argument", `quota exceeded at ${error.scope}`, { scope: error.scope }) }
    case "unavailable":
      return { outcome: "rejected", failure: fail("unavailable", error.reason) }
    case "not_implemented":
      return { outcome: "rejected", failure: fail("not_implemented", "operation is not implemented") }
  }
}

function outputInvoke(deps: OutputSpoolCommandDeps): DomainInvoke {
  const { port } = deps

  /** Run a port effect, emit exactly one audit event, and shape the result. */
  const run = <A, E>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, E>,
    toFailure: (error: E) => { outcome: OutputSpoolAuditEvent["outcome"]; failure: FailureHandlerResult },
    onSuccess: (value: A) => HandlerResult,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> => {
            const mapped = toFailure(error)
            return deps.audit.record({ commandId, principalId, target, outcome: mapped.outcome }).pipe(Effect.as(mapped.failure))
          },
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toOperator(ctx.request.principal)
    const principalId = principal.id
    const outputRef = firstString(payload, ["outputRef", "output_ref", "ref"]) ?? ""
    const expectedVersion = resolveExpectedVersion(payload, ctx.request)

    switch (id) {
      case "output.stat":
        return run(id, principalId, outputRef, port.stat({ outputRef, principal }), readerToFailure, (o) => query(o.stat))
      case "output.read": {
        const offset = firstNumber(payload, ["offset"]) ?? 0
        const limit = firstNumber(payload, ["limit"])
        if (limit === undefined) return Promise.resolve(fail("invalid_argument", "output.read requires a limit", { field: "limit" }))
        return run(id, principalId, outputRef, port.read({ outputRef, offset, limit, principal }), readerToFailure, (o) => query(o.page))
      }
      case "output.follow": {
        const cursor = firstString(payload, ["cursor"])
        if (cursor === undefined) return Promise.resolve(fail("invalid_argument", "output.follow requires a cursor", { field: "cursor" }))
        return run(id, principalId, cursor, port.follow({ cursor, principal }), readerToFailure, (o) => query({ page: o.page, cursor: o.cursor }))
      }
      case "output.export":
        return run(id, principalId, outputRef, port.export({ outputRef, scope: "project", expectedVersion, principal }), adminToFailure, (o) => query(o))
      case "output.share":
        return run(id, principalId, outputRef, port.share({ outputRef, scope: "project", expectedVersion, principal }), adminToFailure, (o) => query(o))
      case "output.release":
        return run(id, principalId, outputRef, port.release({ outputRef, scope: "project", principal }), adminToFailure, (o) => query(o))
      case "output.delete":
        return run(id, principalId, outputRef, port.delete({ outputRef, scope: "project", expectedVersion, principal }), adminToFailure, (o) => query(o))
      case "output.purge":
        return run(id, principalId, outputRef, port.purge({ outputRef, scope: "project", expectedVersion, principal }), adminToFailure, (o) => query(o))
      case "output.retention.set": {
        const scopeId = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? ""
        const scope = (firstString(payload, ["scope"]) ?? ctx.request.scope.kind) === "global" ? "global" : "project"
        const retention = asRetention(payload)
        return run(id, principalId, scopeId, port.setRetention({ scope, scopeId, retention, expectedVersion, principal }), adminToFailure, (o) => query(o))
      }
      case "output.quota.set": {
        const scopeId = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? ""
        const scope = (firstString(payload, ["scope"]) ?? ctx.request.scope.kind) === "global" ? "global" : "project"
        const quota = asQuota(payload)
        return run(id, principalId, scopeId, port.setQuota({ scope, scopeId, quota, expectedVersion, principal }), adminToFailure, (o) => query(o))
      }
      default:
        return Promise.resolve(fail("not_implemented", `output command ${id} is not implemented`))
    }
  }
}

/** Project a retention descriptor from the payload (bounded, content-free). */
function asRetention(payload: Record<string, unknown>) {
  return {
    ttlSeconds: firstNumber(payload, ["ttlSeconds", "ttl_seconds"]) ?? 0,
    hasLiveLease: false,
    hasActiveReaderOrWriter: false,
    referenceEdgeKinds: [] as const,
    legalHold: payload.legalHold === true,
  }
}

const QUOTA_SCOPES: ReadonlySet<string> = new Set(["global", "root", "session", "process", "channel"])

/** Project a quota descriptor from the payload (bounded, content-free). The cap scope is one of the five QuotaScopes (FR10, C3). */
function asQuota(payload: Record<string, unknown>) {
  const requested = firstString(payload, ["quotaScope", "quota_scope", "scope"]) ?? "global"
  const scope = (QUOTA_SCOPES.has(requested) ? requested : "global") as
    | "global" | "root" | "session" | "process" | "channel"
  return {
    scope,
    scopeId: firstString(payload, ["scopeId", "scope_id"]) ?? "",
    maxBytes: firstNumber(payload, ["maxBytes", "max_bytes"]) ?? 0,
    maxQueueDepthBytes: firstNumber(payload, ["maxQueueDepthBytes", "max_queue_depth_bytes"]) ?? 0,
  }
}

/**
 * Build the `output` DomainPort override. Wire it into the Feature 007 dispatcher
 * via `wireDomainPorts(createOutputSpoolDomainPorts({ port, audit }))` at the
 * composition root — it replaces the `not_implemented` stub without touching the
 * registry.
 */
export function createOutputSpoolDomainPorts(deps: OutputSpoolCommandDeps): OutputSpoolDomainPorts {
  return {
    output: { invoke: outputInvoke(deps) },
  }
}
