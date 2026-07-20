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
 *   - routing.configure           -> RoutingConfigureBackend.planConfigure (Feature 024)
 *
 * Feature 024: `routing.configure` is no longer a `not_implemented` stub. When a
 * write-capable `RoutingConfigureBackend` is wired (the live stack always wires it),
 * it validates the payload and returns a `mutation_plan` the dispatcher commits via
 * `mutateAuthority` (CAS over the shared `routing` / `global:routing` authority,
 * partial-merged to preserve role_pools + sibling activation). A backend-less port
 * (read-only construction) still answers `not_implemented`, since it genuinely
 * cannot persist.
 */
export * as RoutingCommandPort from "./routing-command-port"

import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { RoutingError } from "@opencode-ai/protocol/routing/index"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { RoutingConfigureBackend, RoutingConfigureInput } from "../outbound/configure-backend"
import type { RoutingPort } from "../../application/ports"

export interface RoutingDomainPort {
  readonly invoke: DomainInvoke
}

const ROUTING_SCOPES: ReadonlySet<string> = new Set(["global", "project", "session"])

/** The closed set of routing modes an operator may set (mirrors RoutingConfig.RoutingMode). */
const ROUTING_MODES: ReadonlySet<string> = new Set(["always", "auto", "never"])

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
 * Run a mutation-plan Effect and project it onto a HandlerResult. On success the
 * dispatcher commits the plan through `mutateAuthority` (the single CAS write); on
 * a typed RoutingError the mutation is rejected and NOTHING is committed.
 */
function runPlan(effect: Effect.Effect<OperatorMutationPlan, RoutingError>): Promise<HandlerResult> {
  const program = effect.pipe(
    Effect.match({
      onSuccess: (plan): HandlerResult => ({ kind: "mutation_plan", ...plan }),
      onFailure: (error): HandlerResult => routingErrorToFailure(error),
    }),
  )
  return Effect.runPromise(program)
}

/**
 * Parse the local `routing.configure` payload into the content-free configure input,
 * or a typed `invalid_argument` failure. The TUI form composes
 * `{ enabled, mode, ...advanced }` (field-list.ts), so the advanced `budgetPolicy`
 * override is spread at the top level. An all-empty payload is rejected — a Save must
 * change at least one field.
 */
function parseConfigure(payload: Record<string, unknown>): RoutingConfigureInput | FailureHandlerResult {
  const enabled = typeof payload.enabled === "boolean" ? payload.enabled : undefined

  let mode: RoutingConfig.RoutingMode | undefined
  const rawMode = payload.mode
  if (rawMode !== undefined) {
    if (typeof rawMode !== "string" || !ROUTING_MODES.has(rawMode)) {
      return fail("invalid_argument", "routing.configure mode must be one of always, auto, or never", { field: "mode" })
    }
    mode = rawMode as RoutingConfig.RoutingMode
  }

  const budgetPolicy = "budgetPolicy" in payload ? payload.budgetPolicy : undefined

  if (enabled === undefined && mode === undefined && budgetPolicy === undefined) {
    return fail("invalid_argument", "routing.configure requires at least one of enabled, mode, or a policy override", {
      field: "payload",
    })
  }
  return { enabled, mode, budgetPolicy }
}

/**
 * Build the routing DomainPort. Wire it into the Feature 007 dispatcher via
 * `wireDomainPorts({ routing: createRoutingDomainPort(routing) })` at the
 * composition root — it overrides the stub without touching the registry.
 */
export function createRoutingDomainPort(routing: RoutingPort, configure?: RoutingConfigureBackend): RoutingDomainPort {
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

      case "routing.configure": {
        // A read-only construction (no write-capable backend) genuinely cannot
        // persist — surface the honest not_implemented rather than a phantom success.
        if (configure === undefined) {
          return Promise.resolve(
            fail("not_implemented", "routing.configure requires a write-capable routing config backend"),
          )
        }
        const parsed = parseConfigure(payload)
        if ("kind" in parsed) return Promise.resolve(parsed)
        // Thread the dispatcher-resolved REQUEST scope so the backend writes the
        // SAME authority the mutation preflight reported (project → "routing",
        // global → "global:routing") — never the effective-config origin. This
        // keeps the CAS token and the committed authority in lockstep, even on a
        // fresh project with no project-scope routing document yet (Feature 024).
        return runPlan(configure.planConfigure(parsed, ctx.request.scope.kind))
      }

      default:
        return Promise.resolve(fail("not_implemented", `routing command ${id} is not implemented`))
    }
  }

  return { invoke }
}
