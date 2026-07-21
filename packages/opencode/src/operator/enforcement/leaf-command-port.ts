/**
 * Feature 046 — the `hierarchy.*` / `capability.*` inbound command adapter.
 *
 * Bridges the reserved `hierarchy.show|set` and `capability.show|set` operator
 * command ids to the generic `EnforcementLeafBackend` through the Feature 007
 * dispatcher's `DomainInvoke` seam, exactly like `budget-command-port.ts`. Feature
 * 007 remains the SOLE registration authority: this adapter registers NO command
 * ids — it supplies the `hierarchy` and `capability` domain `invoke`s over one
 * shared backend, replacing the `not_implemented` stubs.
 *
 * Every command is parsed and dispatched LOCALLY: the payload never reaches a
 * model, every port call is zero-cost. `show` projects the bounded, redacted
 * effective leaves; `set` carries an operator principal + explicit scope + CAS
 * expected version and returns an `OperatorMutationPlan` the dispatcher commits.
 * Exactly one bounded, secret-free audit event is emitted per dispatch.
 */
export * as EnforcementCommandPort from "./leaf-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore, CommandRequest } from "@opencode-ai/core/operator"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { EnforcementDomain } from "@opencode-ai/protocol/enforcement/leaves"
import type { EnforcementError, EnforcementLeafBackendApi, EnforcementPrincipal } from "./leaf-backend"

/** A bounded, secret-free operator audit event (never a config payload/secret). */
export interface EnforcementAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "invalid"
}

export interface EnforcementAuditSink {
  readonly record: (event: EnforcementAuditEvent) => Effect.Effect<void>
}

export interface EnforcementCommandDeps {
  readonly backend: EnforcementLeafBackendApi
  readonly audit: EnforcementAuditSink
}

export interface EnforcementDomainPorts {
  readonly hierarchy: { readonly invoke: DomainInvoke }
  readonly capability: { readonly invoke: DomainInvoke }
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

function fail(code: FailureHandlerResult["code"], message: string, details?: FailureHandlerResult["details"]): FailureHandlerResult {
  return { kind: "failure", code, message, details }
}

function toEnforcementPrincipal(principal: OperatorPrincipalCore): EnforcementPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): string {
  const fromPayload = firstString(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined && request.version.length > 0) return request.version
  return INITIAL_CONFIG_VERSION
}

/** The `{ leafKey: value }` map an operator set — from `payload.values`, else the payload minus reserved keys. */
function parseValues(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload["values"]
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>
  const RESERVED = new Set(["expectedVersion", "expected_version", "version", "idempotencyKey", "idempotency_key", "scopeId", "scope_id"])
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(payload)) if (!RESERVED.has(key)) out[key] = payload[key]
  return out
}

// =============================================================================
// Error mapping
// =============================================================================

function auditOutcome(error: EnforcementError): EnforcementAuditEvent["outcome"] {
  switch (error.type) {
    case "unauthorized":
      return "unauthorized"
    case "version_conflict":
      return "conflict"
    case "invalid_argument":
      return "invalid"
    default:
      return "rejected"
  }
}

function errorToFailure(error: EnforcementError): FailureHandlerResult {
  switch (error.type) {
    case "unauthorized":
      return fail("unauthorized", error.reason)
    case "invalid_argument":
      return fail("invalid_argument", error.reason, { field: error.field })
    case "version_conflict":
      return fail("invalid_argument", `version conflict: expected ${error.expectedVersion}, actual ${error.actualVersion}`, {
        field: "expectedVersion",
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      })
    case "unavailable":
      return fail("unavailable", error.reason)
  }
}

// =============================================================================
// domain invoke
// =============================================================================

function enforcementInvoke(domain: EnforcementDomain, deps: EnforcementCommandDeps): DomainInvoke {
  const { backend } = deps

  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, EnforcementError>,
    onSuccess: (value: A) => HandlerResult,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: auditOutcome(error) }).pipe(Effect.as(errorToFailure(error))),
        }),
      ),
    )

  const runPlan = (
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<OperatorMutationPlan, EnforcementError>,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (plan): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...plan }),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: auditOutcome(error) }).pipe(Effect.as(errorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const verb = id.slice(id.indexOf(".") + 1)
    const payload = asRecord(ctx.request.payload)
    const principal = toEnforcementPrincipal(ctx.request.principal)
    const principalId = principal.id
    const requestScopeKind = ctx.request.scope.kind
    const target = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? requestScopeKind

    switch (verb) {
      case "show":
      case "status":
        return run(id, principalId, target, backend.showLeaves(domain, requestScopeKind), (view) => query(view))
      case "set": {
        const expectedVersion = resolveExpectedVersion(payload, ctx.request)
        return runPlan(id, principalId, target, backend.planConfigure({ domain, values: parseValues(payload), expectedVersion, principal }, requestScopeKind))
      }
      default:
        return Promise.resolve(fail("not_implemented", `${domain} command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `hierarchy` + `capability` DomainPort overrides over one shared
 * enforcement backend. Wire them into the Feature 007 dispatcher at the
 * composition root — they replace the `not_implemented` stubs without touching
 * the registry.
 */
export function createEnforcementDomainPorts(deps: EnforcementCommandDeps): EnforcementDomainPorts {
  return {
    hierarchy: { invoke: enforcementInvoke("hierarchy", deps) },
    capability: { invoke: enforcementInvoke("capability", deps) },
  }
}
