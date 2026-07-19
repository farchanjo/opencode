/**
 * Feature 013 / T008 — the `pools.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `pools.status|show|set|reset|validate` operator
 * command ids to the typed `PoolsPort` (T008) through the Feature 007 dispatcher's
 * `DomainInvoke` seam, exactly like `langlock-command-port.ts` (Feature 004).
 * Feature 007 remains the SOLE registration authority: this adapter registers NO
 * command ids — it only supplies the `pools` domain `invoke`, replacing the
 * `not_implemented` stub. Reserved-id collisions (`pools.*`) are rejected by the
 * Feature 007 reserved-name guard, unchanged here (FR11).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission): the
 * payload never reaches a model, and every port call is model-independent and
 * zero-cost. `status`/`show` project the redacted, content-free `role_pools`
 * bindings; `validate` reports validity without mutating; `set`/`reset` carry an
 * operator principal + an opaque CAS `expectedVersion` and return a Feature 007
 * audit-correlation id. This adapter is the single uniform operator access-audit
 * point — it holds the Feature 007 principal for every command — and emits exactly
 * one bounded, secret-free audit event per dispatch.
 */
export * as PoolsCommandPort from "./pools-command-port"

import { Effect } from "effect"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import type {
  ConfigVersion,
  OperatorPrincipal as PoolsOperatorPrincipal,
  PoolsError,
  RolePoolBindingList,
} from "@opencode-ai/protocol/pools/commands"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { PoolsAuditEvent, PoolsAuditSink, PoolsBackend } from "./pools-port"

export interface PoolsDomainPorts {
  readonly pools: { readonly invoke: DomainInvoke }
}

export interface PoolsCommandDeps {
  readonly backend: PoolsBackend
  readonly audit: PoolsAuditSink
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

/** Map the Feature 007 operator principal onto the pools operator principal (FR9). */
function toPoolsOperator(principal: OperatorPrincipalCore): PoolsOperatorPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

/** Resolve the opaque CAS `expectedVersion` from the payload or envelope; defaults to the create sentinel. */
function resolveExpectedVersion(record: Record<string, unknown>, requestVersion: string | undefined): ConfigVersion {
  return firstString(record, ["expectedVersion", "expected_version", "version"]) ?? requestVersion ?? INITIAL_CONFIG_VERSION
}

/** Parse the `set` payload into a content-free binding list, or `undefined` when malformed (FR8). */
function parseBindings(record: Record<string, unknown>): RolePoolBindingList | undefined {
  const raw = record["bindings"]
  if (!Array.isArray(raw)) return undefined
  const bindings: { role: string; models: readonly string[] }[] = []
  for (const item of raw) {
    const entry = asRecord(item)
    const role = entry["role"]
    const models = entry["models"]
    if (typeof role !== "string" || !Array.isArray(models) || models.some((m) => typeof m !== "string")) return undefined
    bindings.push({ role, models: models as readonly string[] })
  }
  return bindings
}

// =============================================================================
// Error mapping
// =============================================================================

/** Map the closed `PoolsError` union onto the bounded operator audit outcome. */
function auditOutcome(error: PoolsError): PoolsAuditEvent["outcome"] {
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

/** Map the closed `PoolsError` union onto an operator failure code + envelope. */
function poolsErrorToFailure(error: PoolsError): FailureHandlerResult {
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
// pools.* domain invoke
// =============================================================================

function poolsInvoke(deps: PoolsCommandDeps): DomainInvoke {
  const { backend } = deps

  /** Run a read effect, emit exactly one audit event, and shape the result. */
  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, PoolsError>,
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
              .pipe(Effect.as(poolsErrorToFailure(error))),
        }),
      ),
    )

  /** Validate a mutation and hand back the `mutation_plan` the dispatcher commits (audited on commit). */
  const runPlan = (
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<OperatorMutationPlan, PoolsError>,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (plan): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...plan }),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(poolsErrorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toPoolsOperator(ctx.request.principal)
    const principalId = principal.id
    const target = ctx.request.scope.ref ?? ctx.request.scope.kind

    switch (id) {
      case "pools.status":
      case "pools.show":
        return run(id, principalId, target, backend.resolve(), (projection) => query(projection))

      case "pools.validate":
        return run(id, principalId, target, backend.validate(), (projection) => query({ valid: projection.valid, projection }))

      case "pools.set": {
        const bindings = parseBindings(payload)
        if (bindings === undefined)
          return Promise.resolve(fail("invalid_argument", "pools.set requires a bindings array of { role, models }", { field: "bindings" }))
        const expectedVersion = resolveExpectedVersion(payload, ctx.request.version)
        return runPlan(id, principalId, target, backend.planSet({ bindings, expectedVersion, principal }))
      }

      case "pools.reset": {
        const expectedVersion = resolveExpectedVersion(payload, ctx.request.version)
        return runPlan(id, principalId, target, backend.planReset({ expectedVersion, principal }))
      }

      default:
        return Promise.resolve(fail("not_implemented", `pools command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `pools` DomainPort override. Wire it into the Feature 007 dispatcher via
 * `wireDomainPorts(createPoolsDomainPorts({ port, audit }))` at the composition root
 * — it replaces the `not_implemented` stub without touching the registry.
 */
export function createPoolsDomainPorts(deps: PoolsCommandDeps): PoolsDomainPorts {
  return {
    pools: { invoke: poolsInvoke(deps) },
  }
}
