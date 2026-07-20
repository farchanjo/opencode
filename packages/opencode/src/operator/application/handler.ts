/**
 * Typed operator handler contract (B2).
 * Handlers return query results, mutation plans, or structured failures —
 * they NEVER commit Config themselves.
 */
import {
  failureResult,
  successResult,
  type CommandResult,
  type ErrorCode,
  type OperatorCommandDescriptor,
  type CommandRequest,
} from "@opencode-ai/core/operator"

export type HandlerContext = {
  readonly request: CommandRequest
  readonly descriptor: OperatorCommandDescriptor
}

/** Successful query (read-only). */
export type QueryHandlerResult = {
  readonly kind: "query"
  readonly effective: unknown
  readonly version?: string
}

/**
 * The typed outcome of an `OperatorMutationPlan.effect` (ADR-0017 superseding
 * decision). `ok:true` threads `value` into `apply` as its second argument;
 * `ok:false` aborts `mutateAuthority` with the given typed envelope and commits
 * NOTHING (no fabricated success, no phantom write).
 */
export type OperatorMutationEffectResult =
  | { readonly ok: true; readonly value?: unknown }
  | {
      readonly ok: false
      readonly code: ErrorCode
      readonly message: string
      readonly details?: Readonly<Record<string, string | number | boolean | null>>
    }

/**
 * An irreversible side effect a store-scoped / live-service plan hands the
 * dispatcher. `mutateAuthority` runs it EXACTLY ONCE, AFTER contract +
 * idempotency-claim + CAS-precondition validation and BEFORE the committed CAS
 * write — so a rejected mutation (missing CAS token, version conflict) or an
 * idempotent replay never re-runs the destructive op (ADR-0017).
 */
export type OperatorMutationEffect = () => Promise<OperatorMutationEffectResult>

/**
 * The authority + transform a domain backend hands to the dispatcher so
 * `mutateAuthority` owns the single committed CAS write (never the backend itself).
 *
 * `apply` is a pure function of the raw persisted payload — no I/O, no self-commit.
 * When the verb has an irreversible side effect (a control-store op, a live MCP
 * connection change, a credential clear) the plan carries an `effect`: the op is
 * DEFERRED into it so `mutateAuthority` runs it only after every check passes; the
 * effect's resolved `value` is threaded to `apply` as its second argument. Pure
 * config-backed plans leave `effect` unset and stay pure.
 */
export type OperatorMutationPlan = {
  readonly authority: string
  readonly apply: (current: unknown, effectValue?: unknown) => unknown
  readonly effect?: OperatorMutationEffect
}

/** Mutation plan executed only by dispatcher via mutateAuthority. */
export type MutationPlanHandlerResult = OperatorMutationPlan & {
  readonly kind: "mutation_plan"
  readonly snapshotBefore?: boolean
  readonly cutoverDomain?: string
  readonly rollbackDomain?: string
  readonly externalPrep?: { readonly target: string; readonly payloadHash: string }
}

export type FailureHandlerResult = {
  readonly kind: "failure"
  readonly code: "not_implemented" | "unavailable" | "invalid_argument" | "forbidden_scope" | "unauthorized"
  readonly message: string
  readonly details?: Readonly<Record<string, string | number | boolean | null>>
}

export type HandlerResult = QueryHandlerResult | MutationPlanHandlerResult | FailureHandlerResult

export type OperatorCommandHandler = (ctx: HandlerContext) => HandlerResult | Promise<HandlerResult>

export type HandlerMap = ReadonlyMap<string, OperatorCommandHandler>

export function notImplementedHandler(ctx: HandlerContext): HandlerResult {
  return {
    kind: "failure",
    code: "not_implemented",
    message: `domain handler for ${ctx.descriptor.id} is not implemented`,
    details: { domain: ctx.descriptor.domain },
  }
}

export function fixtureStatusHandler(ctx: HandlerContext): HandlerResult {
  return {
    kind: "query",
    version: "cas_fixture_0",
    effective: {
      id: ctx.descriptor.id,
      status: "ok",
      offline: true,
      source: ctx.request.source,
    },
  }
}

/** Convert HandlerResult to CommandResult for non-mutation paths. */
export function handlerResultToCommandResult(id: string, result: HandlerResult): CommandResult {
  if (result.kind === "query") {
    return successResult({
      id,
      version: result.version,
      effective: result.effective,
    })
  }
  if (result.kind === "failure") {
    return failureResult({
      id,
      code: result.code,
      message: result.message,
      details: result.details,
    })
  }
  // mutation_plan must not be converted outside dispatcher
  return failureResult({
    id,
    code: "invalid_argument",
    message: "mutation_plan cannot be converted without mutateAuthority",
  })
}

/** Detect illegal handler shapes that claim success without pipeline. */
export function isIllegalMutationCommit(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false
  const r = result as Record<string, unknown>
  // Legacy CommandResult ok:true from mutation handler is illegal when mutationPorts set
  if (r.ok === true && r.kind === "operator.admin_result") return true
  return false
}

export function createHandlerMap(entries: Iterable<readonly [string, OperatorCommandHandler]>): Map<string, OperatorCommandHandler> {
  return new Map(entries)
}

export * as OperatorHandler from "./handler"
