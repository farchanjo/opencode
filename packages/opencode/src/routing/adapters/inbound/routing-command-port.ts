/**
 * Feature 001 / T028 — Routing inbound command adapter.
 *
 * Bridges the reserved `routing.*` operator commands to the Feature 001
 * RoutingPort application service through the Feature 007 dispatcher's
 * `DomainInvoke` seam (packages/opencode/src/operator/.../domain-ports.ts).
 * Feature 007 remains the sole management authority and the only command
 * registration path; this adapter registers NO new command ids — it only
 * supplies the routing domain's `invoke`, replacing the not_implemented stub in
 * `createDomainStubs`.
 *
 * Input is parsed and dispatched LOCALLY here (before any prompt admission):
 * the command payload never reaches a model, and every RoutingPort call is
 * model-independent and zero-cost (`routing.test` runs a deterministic local
 * simulation). RoutingErrors are mapped onto the operator FailureHandlerResult
 * codes so the dispatcher renders the canonical admin envelope + exit code.
 *
 * Command coverage (reserved routing ids in the Feature 007 catalog):
 *   - routing.status              -> RoutingPort.status()
 *   - routing.test                -> RoutingPort.test({ taskDescription, scope })
 *   - routing.explain             -> RoutingPort.explain(decisionId)      (surface-only)
 *   - routing.capability.inspect  -> RoutingPort.capabilityInspect(modelId) (surface-only)
 *   - routing.configure           -> not_implemented (Config.Service mutation, T027)
 */
export * as RoutingCommandPort from "./routing-command-port"

import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { RoutingError } from "@opencode-ai/protocol/routing/index"
import type { HandlerContext, HandlerResult, FailureHandlerResult } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { RoutingPort } from "../../application/ports"

export interface RoutingDomainPort {
  readonly invoke: DomainInvoke
}

const ROUTING_SCOPES: ReadonlySet<string> = new Set(["global", "project", "session"])

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

/** Resolve the routing scope from the payload, then the request scope, defaulting to session. */
function resolveScope(ctx: HandlerContext): Budget.Scope {
  const payload = asRecord(ctx.request.payload)
  const fromPayload = payload.scope
  if (typeof fromPayload === "string" && ROUTING_SCOPES.has(fromPayload)) return fromPayload as Budget.Scope
  const kind = ctx.request.scope.kind
  if (ROUTING_SCOPES.has(kind)) return kind as Budget.Scope
  return "session"
}

function fail(code: FailureHandlerResult["code"], message: string, details?: FailureHandlerResult["details"]): FailureHandlerResult {
  return { kind: "failure", code, message, details }
}

/** Map the closed RoutingError union onto operator failure codes. */
function routingErrorToFailure(error: RoutingError): FailureHandlerResult {
  switch (error.type) {
    case "invalid_argument":
      return fail("invalid_argument", error.reason, { field: error.field })
    case "not_implemented":
      return fail("not_implemented", "routing operation is not implemented")
    case "no_authorized_candidate":
      return fail("unavailable", error.reason, { type: error.type })
    case "catalog_mismatch":
      return fail("unavailable", `catalog mismatch for decision ${error.decisionId}`, {
        type: error.type,
        catalogVersion: error.catalogVersion,
      })
    case "mutation_risky":
      return fail("unavailable", error.reason, { type: error.type, agentId: error.agentId, modelId: error.modelId })
    case "unavailable":
      return fail("unavailable", error.reason, { type: error.type })
  }
}

/** Run a RoutingPort Effect and project it onto a HandlerResult (query on success). */
function runQuery<A>(effect: Effect.Effect<A, RoutingError>): Promise<HandlerResult> {
  const program = effect.pipe(
    Effect.match({
      onSuccess: (value): HandlerResult => ({ kind: "query", effective: value }),
      onFailure: (error): HandlerResult => routingErrorToFailure(error),
    }),
  )
  return Effect.runPromise(program)
}

/**
 * Build the routing DomainPort. Wire it into the Feature 007 dispatcher via
 * `wireDomainPorts({ routing: createRoutingDomainPort(routing) })` at the
 * composition root — it overrides the stub without touching the registry.
 */
export function createRoutingDomainPort(routing: RoutingPort): RoutingDomainPort {
  const invoke: DomainInvoke = (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)

    switch (id) {
      case "routing.status":
        return runQuery(routing.status())

      case "routing.test": {
        const taskDescription = firstString(payload, ["taskDescription", "input", "task", "description"])
        if (taskDescription === undefined) {
          return Promise.resolve(fail("invalid_argument", "routing.test requires a task description", { field: "input" }))
        }
        return runQuery(routing.test({ taskDescription, scope: resolveScope(ctx) }))
      }

      case "routing.explain": {
        const decisionId = firstString(payload, ["decisionId", "decision_id", "id"])
        if (decisionId === undefined) {
          return Promise.resolve(fail("invalid_argument", "routing.explain requires a decision id", { field: "decisionId" }))
        }
        return runQuery(routing.explain(decisionId))
      }

      case "routing.capability.inspect": {
        const modelId = firstString(payload, ["modelId", "model_id", "model"])
        return runQuery(routing.capabilityInspect(modelId))
      }

      case "routing.configure":
        return Promise.resolve(
          fail("not_implemented", "routing.configure persists via Config.Service (Feature 007 mutation path)"),
        )

      default:
        return Promise.resolve(fail("not_implemented", `routing command ${id} is not implemented`))
    }
  }

  return { invoke }
}
