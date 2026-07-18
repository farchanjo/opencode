/**
 * Feature 004 / T033 (S16) — the `langlock.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `langlock.status|show|set|reset` operator
 * command ids to the typed `LangLockPolicyPort` (T033) through the Feature 007
 * dispatcher's `DomainInvoke` seam, exactly like `jobs-command-port.ts`
 * (Feature 003) and `lifecycle-command-port.ts` (Feature 002). Feature 007
 * remains the SOLE registration authority: this adapter registers NO command ids
 * — it only supplies the `langlock` domain `invoke`, replacing the
 * `not_implemented` stub. Reserved-id collisions (`langlock.*`) are rejected by
 * the Feature 007 reserved-name guard, unchanged here (C3).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission):
 * the payload never reaches a model, and every port call is model-independent and
 * zero-cost (FR33, AC13). `status`/`show` project the redacted, content-free
 * effective policy; `set`/`reset` carry an operator principal + explicit scope +
 * version/CAS + idempotency enforced by the backend and return a Feature 007
 * audit-correlation id. This adapter is the single uniform operator access-audit
 * point — it holds the Feature 007 principal for every command — and emits exactly
 * one bounded, secret-free audit event per dispatch.
 */
export * as LangLockCommandPort from "./langlock-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore, CommandRequest } from "@opencode-ai/core/operator"
import type {
  LangLockPolicyError,
  OperatorPrincipal as LangLockOperatorPrincipal,
  Scope,
} from "@opencode-ai/protocol/langlock/commands"
import type { LangLockPolicyPort } from "@opencode-ai/protocol/langlock/ports"
import type { HandlerContext, HandlerResult, FailureHandlerResult } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { LangLockAuditEvent, LangLockAuditSink } from "./langlock-port"

export interface LangLockDomainPorts {
  readonly langlock: { readonly invoke: DomainInvoke }
}

export interface LangLockCommandDeps {
  readonly port: LangLockPolicyPort
  readonly audit: LangLockAuditSink
}

// =============================================================================
// Payload helpers
// =============================================================================

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

/** Map the Feature 007 operator principal onto the langlock operator principal (C3). */
function toLangLockOperator(principal: OperatorPrincipalCore): LangLockOperatorPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

/** Resolve the CAS `expectedVersion` from the payload or the envelope `version`; defaults to 0 (create). */
function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): number {
  const fromPayload = firstNumber(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined) {
    const parsed = Number(request.version)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

// =============================================================================
// Error mapping
// =============================================================================

/** Map the closed `LangLockPolicyError` union onto the bounded operator audit outcome. */
function auditOutcome(error: LangLockPolicyError): LangLockAuditEvent["outcome"] {
  switch (error.type) {
    case "unauthorized":
    case "floor_violation":
      return "unauthorized"
    case "version_conflict":
      return "conflict"
    case "invalid_tag":
      return "invalid"
    default:
      return "rejected"
  }
}

/** Map the closed `LangLockPolicyError` union onto an operator failure code + envelope. */
function langLockErrorToFailure(error: LangLockPolicyError): FailureHandlerResult {
  switch (error.type) {
    case "unauthorized":
      return fail("unauthorized", error.reason)
    case "floor_violation":
      return fail("unauthorized", `override tag ${error.requestedTag} would relax the hard-policy floor ${error.floorTag}`, {
        requestedTag: error.requestedTag,
        floorTag: error.floorTag,
      })
    case "invalid_tag":
      return fail("invalid_argument", `invalid or non-allowlisted tag ${error.tag}`, { field: "tag", tag: error.tag })
    case "version_conflict":
      return fail("invalid_argument", `version conflict: expected ${error.expectedVersion}, actual ${error.actualVersion}`, {
        field: "expectedVersion",
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      })
    case "reserved_name":
      return fail("invalid_argument", `reserved id ${error.id}`, { field: "id", id: error.id })
    case "unavailable":
      return fail("unavailable", error.reason)
    case "not_implemented":
      return fail("not_implemented", "operation is not implemented")
  }
}

// =============================================================================
// langlock.* domain invoke
// =============================================================================

function langLockInvoke(deps: LangLockCommandDeps): DomainInvoke {
  const { port } = deps

  /** Run a port effect, emit exactly one audit event, and shape the result. */
  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, LangLockPolicyError>,
    onSuccess: (value: A) => HandlerResult,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(langLockErrorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })
  const mutation = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toLangLockOperator(ctx.request.principal)
    const principalId = principal.id
    const scope = (firstString(payload, ["scope"]) ?? ctx.request.scope.kind) as Scope
    const scopeId = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? ""

    switch (id) {
      case "langlock.status":
      case "langlock.show":
        return run(id, principalId, scopeId, port.resolve({ scope, scopeId }), (out) => query(out.policy))

      case "langlock.set": {
        const tag = firstString(payload, ["tag", "language", "artifact_language"])
        if (tag === undefined) return Promise.resolve(fail("invalid_argument", "langlock.set requires a tag", { field: "tag" }))
        const expectedVersion = resolveExpectedVersion(payload, ctx.request)
        return run(id, principalId, scopeId, port.set({ scope, scopeId, tag, expectedVersion, principal }), (out) =>
          mutation({ policy: out.policy, auditId: out.auditId }),
        )
      }

      case "langlock.reset": {
        const expectedVersion = resolveExpectedVersion(payload, ctx.request)
        return run(id, principalId, scopeId, port.reset({ scope, scopeId, expectedVersion, principal }), (out) =>
          mutation({ policy: out.policy, auditId: out.auditId }),
        )
      }

      default:
        return Promise.resolve(fail("not_implemented", `langlock command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `langlock` DomainPort override. Wire it into the Feature 007
 * dispatcher via `wireDomainPorts(createLangLockDomainPorts({ port, audit }))` at
 * the composition root — it replaces the `not_implemented` stub without touching
 * the registry.
 */
export function createLangLockDomainPorts(deps: LangLockCommandDeps): LangLockDomainPorts {
  return {
    langlock: { invoke: langLockInvoke(deps) },
  }
}
