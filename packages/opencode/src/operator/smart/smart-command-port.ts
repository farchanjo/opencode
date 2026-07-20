/**
 * Feature 013 / T006 — the `smart.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `smart.status|on|off|auto` operator command
 * ids to the typed `SmartPort` (T006) through the Feature 007 dispatcher's
 * `DomainInvoke` seam, exactly like `langlock-command-port.ts` (Feature 004) and
 * `jobs-command-port.ts` (Feature 003). Feature 007 remains the SOLE registration
 * authority: this adapter registers NO command ids — it only supplies the `smart`
 * domain `invoke`, replacing the `not_implemented` stub (FR9).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission):
 * the payload never reaches a model, and every port call is model-independent and
 * zero-cost. `status` projects the redacted, content-free activation summary;
 * `on`/`off`/`auto` carry an operator principal + `expectedVersion` CAS token
 * enforced by the backend and return a Feature 007 audit-correlation id. This
 * adapter is the single uniform operator access-audit point — it holds the
 * Feature 007 principal for every command — and emits exactly one bounded,
 * secret-free audit event per dispatch.
 */
export * as SmartCommandPort from "./smart-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore, CommandRequest } from "@opencode-ai/core/operator"
import type { SmartError, OperatorPrincipal as SmartOperatorPrincipal } from "@opencode-ai/protocol/smart/commands"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { SmartAuditEvent, SmartAuditSink, SmartBackend } from "./smart-port"

export interface SmartDomainPorts {
  readonly smart: { readonly invoke: DomainInvoke }
}

export interface SmartCommandDeps {
  readonly backend: SmartBackend
  readonly audit: SmartAuditSink
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

/** Map the Feature 007 operator principal onto the smart operator principal (FR9). */
function toSmartOperator(principal: OperatorPrincipalCore): SmartOperatorPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

/** Resolve the CAS `expectedVersion` from the payload or the envelope `version`; defaults to the create token. */
function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): string {
  const fromPayload = firstString(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined && request.version.length > 0) return request.version
  return INITIAL_CONFIG_VERSION
}

// =============================================================================
// Error mapping
// =============================================================================

/** Map the closed `SmartError` union onto the bounded operator audit outcome. */
function auditOutcome(error: SmartError): SmartAuditEvent["outcome"] {
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

/** Map the closed `SmartError` union onto an operator failure code + envelope. */
function smartErrorToFailure(error: SmartError): FailureHandlerResult {
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
    case "not_implemented":
      return fail("not_implemented", "operation is not implemented")
  }
}

// =============================================================================
// smart.* domain invoke
// =============================================================================

function smartInvoke(deps: SmartCommandDeps): DomainInvoke {
  const { backend } = deps

  /** Run a read effect, emit exactly one audit event, and shape the result. */
  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, SmartError>,
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
              .pipe(Effect.as(smartErrorToFailure(error))),
        }),
      ),
    )

  /** Validate a mutation and hand back the `mutation_plan` the dispatcher commits (audited on commit). */
  const runPlan = (
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<OperatorMutationPlan, SmartError>,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (plan): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...plan }),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(smartErrorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toSmartOperator(ctx.request.principal)
    const principalId = principal.id
    const target = ctx.request.scope.ref ?? ""
    const input = { expectedVersion: resolveExpectedVersion(payload, ctx.request), principal }
    // Thread the dispatcher-resolved REQUEST scope so the backend writes the SAME
    // authority the mutation preflight reported (project → "routing", global →
    // "global:routing") — never the effective-config origin. This keeps the CAS token
    // and the committed authority in lockstep on a fresh project (Feature 025).
    const requestScopeKind = ctx.request.scope.kind

    switch (id) {
      case "smart.status":
        return run(id, principalId, target, backend.resolve(requestScopeKind), (summary) => query(summary))
      case "smart.on":
        return runPlan(id, principalId, target, backend.planOn(input, requestScopeKind))
      case "smart.off":
        return runPlan(id, principalId, target, backend.planOff(input, requestScopeKind))
      case "smart.auto":
        return runPlan(id, principalId, target, backend.planAuto(input, requestScopeKind))
      default:
        return Promise.resolve(fail("not_implemented", `smart command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `smart` DomainPort override. Wire it into the Feature 007 dispatcher
 * via `wireDomainPorts(createSmartDomainPorts({ port, audit }))` at the
 * composition root — it replaces the `not_implemented` stub without touching the
 * registry.
 */
export function createSmartDomainPorts(deps: SmartCommandDeps): SmartDomainPorts {
  return {
    smart: { invoke: smartInvoke(deps) },
  }
}
