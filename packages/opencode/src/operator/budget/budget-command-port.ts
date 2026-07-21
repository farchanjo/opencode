/**
 * Feature 013 / T007 — the `budget.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `budget.status|show|set|reset|validate` operator
 * command ids to the typed `BudgetPort` through the Feature 007 dispatcher's
 * `DomainInvoke` seam, exactly like `langlock-command-port.ts`. Feature 007 remains
 * the SOLE registration authority: this adapter registers NO command ids — it only
 * supplies the `budget` domain `invoke`, replacing the `not_implemented` stub.
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission): the
 * payload never reaches a model, and every port call is model-independent and
 * zero-cost. `status`/`show`/`validate` project the redacted, bounded effective
 * limits; `set`/`reset` carry an operator principal + explicit scope + CAS expected
 * version and return a Feature 007 audit-correlation id. This adapter is the single
 * uniform operator access-audit point — it holds the Feature 007 principal for every
 * command — and emits exactly one bounded, secret-free audit event per dispatch.
 */
export * as BudgetCommandPort from "./budget-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore, CommandRequest } from "@opencode-ai/core/operator"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type {
  BudgetError,
  BudgetLimitsView,
  BudgetScope,
  OperatorPrincipal as BudgetOperatorPrincipal,
} from "@opencode-ai/protocol/budget/commands"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { EnforcementError, EnforcementLeafBackendApi } from "@/operator/enforcement/leaf-backend"
import type { BudgetAuditEvent, BudgetAuditSink, BudgetBackend } from "./budget-port"

export interface BudgetDomainPorts {
  readonly budget: { readonly invoke: DomainInvoke }
}

export interface BudgetCommandDeps {
  readonly backend: BudgetBackend
  readonly audit: BudgetAuditSink
  /**
   * Feature 046 — the shared enforcement-leaf backend. When present, `budget.show`
   * / `budget.status` are ENRICHED with the full `leaves` map (best-effort, never a
   * regression) and `budget.configure` performs a partial write of ANY budget leaf.
   * Optional so pre-046 constructions keep the legacy 5-leaf behavior.
   */
  readonly enforcement?: EnforcementLeafBackendApi
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

/** Map the Feature 007 operator principal onto the budget operator principal. */
function toBudgetOperator(principal: OperatorPrincipalCore): BudgetOperatorPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

/** Resolve the CAS `expectedVersion` string from the payload or the envelope version; defaults to create. */
function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): string {
  const fromPayload = firstString(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined && request.version.length > 0) return request.version
  return INITIAL_CONFIG_VERSION
}

/** Parse the bounded limits view from a `budget.set` payload; undefined when any field is missing. */
function parseLimits(record: Record<string, unknown>): BudgetLimitsView | undefined {
  const raw = asRecord(record["limits"])
  const maxTurns = firstNumber(raw, ["maxTurns", "max_turns"])
  const maxContextTokens = firstNumber(raw, ["maxContextTokens", "max_context_tokens"])
  const maxOutputTokens = firstNumber(raw, ["maxOutputTokens", "max_output_tokens"])
  const maxWorkers = firstNumber(raw, ["maxWorkers", "max_workers"])
  const tokenBudget = firstNumber(raw, ["tokenBudget", "token_budget"])
  if (
    maxTurns === undefined ||
    maxContextTokens === undefined ||
    maxOutputTokens === undefined ||
    maxWorkers === undefined ||
    tokenBudget === undefined
  ) {
    return undefined
  }
  return { maxTurns, maxContextTokens, maxOutputTokens, maxWorkers, tokenBudget }
}

// =============================================================================
// Error mapping
// =============================================================================

/** Map the closed `BudgetError` union onto the bounded operator audit outcome. */
function auditOutcome(error: BudgetError): BudgetAuditEvent["outcome"] {
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

/** Map the closed `BudgetError` union onto an operator failure code + envelope. */
function budgetErrorToFailure(error: BudgetError): FailureHandlerResult {
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

/** Map the enforcement error union onto an operator failure envelope (Feature 046, budget.configure). */
function enforcementErrorToFailure(error: EnforcementError): FailureHandlerResult {
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

/** The `{ leafKey: value }` map an operator set — from `payload.values`, else the payload minus reserved keys. */
function parseConfigureValues(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload["values"]
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>
  const RESERVED = new Set(["expectedVersion", "expected_version", "version", "idempotencyKey", "idempotency_key", "scopeId", "scope_id", "limits"])
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(payload)) if (!RESERVED.has(key)) out[key] = payload[key]
  return out
}

// =============================================================================
// budget.* domain invoke
// =============================================================================

function budgetInvoke(deps: BudgetCommandDeps): DomainInvoke {
  const { backend } = deps

  /** Run a read effect, emit exactly one audit event, and shape the result. */
  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, BudgetError>,
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
              .pipe(Effect.as(budgetErrorToFailure(error))),
        }),
      ),
    )

  /** Validate a mutation and hand back the `mutation_plan` the dispatcher commits (audited on commit). */
  const runPlan = (
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<OperatorMutationPlan, BudgetError>,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (plan): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...plan }),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(budgetErrorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  /** Run an enforcement mutation plan, emitting one audit event on failure (Feature 046). */
  const runEnforcementPlan = (
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
            deps.audit
              .record({ commandId, principalId, target, outcome: error.type === "unauthorized" ? "unauthorized" : error.type === "version_conflict" ? "conflict" : error.type === "invalid_argument" ? "invalid" : "rejected" })
              .pipe(Effect.as(enforcementErrorToFailure(error))),
        }),
      ),
    )

  /** Resolve the budget summary, best-effort ENRICHED with the full leaves map (Feature 046, FR5). */
  const resolveWithLeaves = (scope: BudgetScope, requestScopeKind: string): Effect.Effect<unknown, BudgetError> =>
    backend.resolve({ scope }).pipe(
      Effect.flatMap((summary) => {
        const enforcement = deps.enforcement
        if (!enforcement) return Effect.succeed(summary as unknown)
        return enforcement.showLeaves("budget", requestScopeKind).pipe(
          Effect.map((view) => ({ ...summary, leaves: view.leaves }) as unknown),
          Effect.orElseSucceed(() => summary as unknown),
        )
      }),
    )

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toBudgetOperator(ctx.request.principal)
    const principalId = principal.id
    // The scope a budget read/mutation targets follows the REQUEST scope — the SAME
    // input the mutation preflight normalizes (`BUDGET_AUTHORITY[norm(scope.kind)]`,
    // mapping everything but "global" to "project") — never a payload-supplied scope
    // the preflight never sees. This keeps the preflight CAS token and the committed
    // authority in lockstep on a fresh project, so a first budget.set persists to the
    // PROJECT `routing` doc and the second save threads the bumped version instead of
    // hard-failing "mutations require version" (Feature 025).
    const scope: BudgetScope = ctx.request.scope.kind === "global" ? "global" : "project"
    const target = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? scope

    switch (id) {
      case "budget.status":
        return run(id, principalId, target, resolveWithLeaves(scope, ctx.request.scope.kind), (summary) => query(summary))

      case "budget.show":
        return run(id, principalId, target, resolveWithLeaves(scope, ctx.request.scope.kind), (summary) => query(summary))

      case "budget.validate":
        return run(id, principalId, target, backend.validate({ scope }), (out) => query(out))

      case "budget.set": {
        const limits = parseLimits(payload)
        if (limits === undefined) {
          return Promise.resolve(fail("invalid_argument", "budget.set requires a complete limits view", { field: "limits" }))
        }
        const expectedVersion = resolveExpectedVersion(payload, ctx.request)
        return runPlan(id, principalId, target, backend.planSet({ scope, limits, expectedVersion, principal }))
      }

      case "budget.reset": {
        const expectedVersion = resolveExpectedVersion(payload, ctx.request)
        return runPlan(id, principalId, target, backend.planReset({ scope, expectedVersion, principal }))
      }

      case "budget.configure": {
        if (!deps.enforcement) return Promise.resolve(fail("not_implemented", "budget.configure requires the enforcement backend"))
        const expectedVersion = resolveExpectedVersion(payload, ctx.request)
        return runEnforcementPlan(
          id,
          principalId,
          target,
          deps.enforcement.planConfigure(
            { domain: "budget", values: parseConfigureValues(payload), expectedVersion, principal: { kind: principal.kind, id: principal.id } },
            ctx.request.scope.kind,
          ),
        )
      }

      default:
        return Promise.resolve(fail("not_implemented", `budget command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `budget` DomainPort override. Wire it into the Feature 007 dispatcher
 * via `wireDomainPorts(createBudgetDomainPorts({ port, audit }))` at the composition
 * root — it replaces the `not_implemented` stub without touching the registry.
 */
export function createBudgetDomainPorts(deps: BudgetCommandDeps): BudgetDomainPorts {
  return {
    budget: { invoke: budgetInvoke(deps) },
  }
}
