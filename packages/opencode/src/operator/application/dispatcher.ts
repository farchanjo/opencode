/**
 * CQRS-light dispatcher (B2).
 * Mutations: confirm → contract → handler plan → mutateAuthority (only path that commits).
 * Queries: handler query result → envelope. Audit every outcome when events port present.
 */
import {
  authorizeCommand,
  buildOperatorOtelAttributes,
  checkOfflineCapability,
  failureResult,
  isAdminResult,
  isOperatorControlPlaneEnabled,
  operatorUnavailableWhenFlagOff,
  parseCommandId,
  parseCommandRequest,
  parseScope,
  type CommandRequest,
  type CommandResult,
  type ConnectivityMode,
  type OperatorCommandDescriptor,
  type OperatorSpanRecorder,
} from "@opencode-ai/core/operator"
import { evaluateConfirmation } from "./confirmation"
import {
  handlerResultToCommandResult,
  isIllegalMutationCommit,
  notImplementedHandler,
  type HandlerContext,
  type HandlerMap,
  type HandlerResult,
  type OperatorCommandHandler,
} from "./handler"
import { auditOnly, mutateAuthority, requireMutationContract, type MutationPorts } from "./mutation"
import { rejectPlaintextSecrets } from "./plaintext"
import type { OperatorCommandRegistry } from "./registry"
import { assertAdminResultShape, createZeroLlmProbe, type ZeroLlmProbe } from "./zero-llm"

export type DispatchOptions = {
  readonly registry: OperatorCommandRegistry
  readonly handlers?: HandlerMap
  readonly defaultHandler?: OperatorCommandHandler
  readonly probe?: ZeroLlmProbe
  readonly rejectPlaintext?: boolean
  /** Required for production mutations — executes CAS/idempotency/audit. */
  readonly mutationPorts?: MutationPorts
  readonly authorityFor?: (descriptor: OperatorCommandDescriptor) => string
  readonly nowMs?: () => number
  /** T044 offline matrix. Default online. Static value or per-dispatch resolver (no stale cache). */
  readonly connectivity?: ConnectivityMode | (() => ConnectivityMode | Promise<ConnectivityMode>)
  /**
   * T041: when false, all dispatches return unavailable (no LLM).
   * Static boolean or per-dispatch resolver so flag enable/disable is observed without restart.
   * Default: env/sandbox slice only (live stack should pass a config-aware resolver).
   */
  readonly featureEnabled?: boolean | (() => boolean | Promise<boolean>)
  /** T046 content-free OTEL recorder (once per dispatch). */
  readonly otel?: OperatorSpanRecorder
  readonly surface?: string
}

export type DispatchRequestOptions = {
  /** T030: slash adapter only — after native confirm + single-use token. */
  readonly slashInteractiveConfirmed?: boolean
  /** T034: CLI adapter only — after native TTY confirm (single execution). */
  readonly cliInteractiveConfirmed?: boolean
}

export type Dispatcher = {
  readonly dispatch: (input: unknown) => Promise<CommandResult>
  readonly dispatchRequest: (
    request: CommandRequest,
    options?: DispatchRequestOptions,
  ) => Promise<CommandResult>
  readonly probe: () => ZeroLlmProbe
}

export function createDispatcher(options: DispatchOptions): Dispatcher {
  const probe = options.probe ?? createZeroLlmProbe()
  const defaultHandler = options.defaultHandler ?? notImplementedHandler
  const handlers = options.handlers
  const surface = options.surface ?? "dispatcher"
  let activeStartedAt = 0

  async function resolveFeatureEnabled(): Promise<boolean> {
    if (options.featureEnabled === undefined) return isOperatorControlPlaneEnabled(process.env)
    if (typeof options.featureEnabled === "function") return options.featureEnabled()
    return options.featureEnabled
  }

  async function resolveConnectivityMode(): Promise<ConnectivityMode> {
    if (options.connectivity === undefined) return "online"
    if (typeof options.connectivity === "function") return options.connectivity()
    return options.connectivity
  }

  async function finish(request: CommandRequest, result: CommandResult): Promise<CommandResult> {
    assertAdminResultShape(result)
    try {
      probe.assertClean()
    } catch (error) {
      return fail(
        String(request.id),
        "invalid_argument",
        error instanceof Error ? error.message : "zero-LLM invariant violated",
      )
    }
    if (options.otel) {
      const domain =
        typeof request.id === "string" && request.id.includes(".")
          ? request.id.slice(0, request.id.indexOf("."))
          : "unknown"
      options.otel.record(
        buildOperatorOtelAttributes({
          commandId: String(request.id),
          domain: domain || "unknown",
          surface,
          scopeKind: request.scope.kind,
          outcome: result.outcome,
          errorCode: result.error?.code,
          durationMs: (options.nowMs?.() ?? Date.now()) - activeStartedAt,
          retry: result.error?.retryable === true,
        }),
      )
    }
    if (options.mutationPorts?.events) {
      return auditOnly(
        { events: options.mutationPorts.events, nowMs: options.nowMs ?? options.mutationPorts.nowMs },
        request,
        result,
      )
    }
    return result
  }

  async function dispatchRequest(
    request: CommandRequest,
    requestOptions?: DispatchRequestOptions,
  ): Promise<CommandResult> {
    probe.reset()
    activeStartedAt = options.nowMs?.() ?? Date.now()

    // T041 feature flag — evaluate per dispatch (no restart/stale cache)
    const featureOn = await resolveFeatureEnabled()
    if (!featureOn) {
      const unavailable = operatorUnavailableWhenFlagOff(String(request.id))
      assertAdminResultShape(unavailable)
      return finish(request, unavailable)
    }

    const idParse = parseCommandId(request.id)
    if (!idParse.ok) {
      return fail(String(request.id), "invalid_argument", idParse.reason)
    }

    const scopeParse = parseScope(request.scope)
    if (!scopeParse.ok) {
      return fail(idParse.value, "invalid_argument", scopeParse.reason)
    }

    const descriptor = options.registry.lookup(idParse.value)
    if (!descriptor) {
      return fail(idParse.value, "invalid_argument", `unknown command id: ${idParse.value}`)
    }

    // T044 offline matrix before handler/network (per-dispatch connectivity)
    const connectivity = await resolveConnectivityMode()
    const offline = checkOfflineCapability(descriptor, connectivity)
    if (!offline.allowed) {
      return finish(
        request,
        failureResult({
          id: descriptor.id,
          code: "unavailable",
          message: offline.reason,
          details: { offlineCapable: descriptor.offlineCapable, connectivity },
        }),
      )
    }

    const projectContext = projectContextFromRequest(request)
    const auth = authorizeCommand({
      principal: request.principal,
      scope: scopeParse.value,
      descriptor,
      projectContext,
    })
    if (!auth.allowed) {
      return finish(request, fail(descriptor.id, auth.code, auth.reason))
    }

    if (options.rejectPlaintext !== false) {
      const plaintext = rejectPlaintextSecrets(request)
      if (plaintext) return finish(request, plaintext)
    }

    const confirm = evaluateConfirmation({
      request,
      descriptor,
      slashInteractiveConfirmed: requestOptions?.slashInteractiveConfirmed,
      cliInteractiveConfirmed: requestOptions?.cliInteractiveConfirmed,
    })
    if (!confirm.allowed) return finish(request, confirm.result)

    const ctx: HandlerContext = { request, descriptor }
    const handler = handlers?.get(descriptor.id) ?? defaultHandler
    const plan = await handler(ctx)

    // Illegal: raw admin success from handler (legacy commit)
    if (isIllegalMutationCommit(plan)) {
      return finish(
        request,
        failureResult({
          id: descriptor.id,
          code: "invalid_argument",
          message: "handlers must not commit config; return mutation_plan",
        }),
      )
    }

    if (descriptor.mutates) {
      if (!options.mutationPorts) {
        // Without ports: only allow failure/not_implemented (no silent success)
        if (plan.kind === "mutation_plan") {
          return finish(
            request,
            failureResult({
              id: descriptor.id,
              code: "unavailable",
              message: "mutationPorts required to execute mutation_plan",
            }),
          )
        }
        const contract = requireMutationContract(request)
        if (contract) return finish(request, contract)
        return finish(request, handlerResultToCommandResult(descriptor.id, plan))
      }

      const contract = requireMutationContract(request)
      if (contract) return finish(request, contract)

      if (plan.kind === "failure") {
        return finish(request, handlerResultToCommandResult(descriptor.id, plan))
      }
      if (plan.kind === "query") {
        return finish(
          request,
          failureResult({
            id: descriptor.id,
            code: "invalid_argument",
            message: "mutation command cannot return query result",
          }),
        )
      }

      // Execute plan exclusively via mutateAuthority
      if (plan.externalPrep && options.mutationPorts.outbox) {
        await options.mutationPorts.outbox.enqueue({
          target: plan.externalPrep.target,
          payloadHash: plan.externalPrep.payloadHash,
          nowMs: options.nowMs?.() ?? Date.now(),
        })
      }

      const result = await mutateAuthority(options.mutationPorts, {
        request,
        authority: plan.authority || options.authorityFor?.(descriptor) || descriptor.domain,
        apply: plan.apply,
        snapshotBefore: plan.snapshotBefore,
        cutoverDomain: plan.cutoverDomain,
        rollbackDomain: plan.rollbackDomain,
      })
      // mutateAuthority already audits on success path via events; ensure envelope
      assertAdminResultShape(result)
      try {
        probe.assertClean()
      } catch (error) {
        return fail(descriptor.id, "invalid_argument", error instanceof Error ? error.message : "zero-LLM")
      }
      // If mutateAuthority already set auditId, return as-is; else finish for audit on failure
      if (result.auditId || !options.mutationPorts.events) return result
      return finish(request, result)
    }

    // Query path
    if (plan.kind === "mutation_plan") {
      return finish(
        request,
        failureResult({
          id: descriptor.id,
          code: "invalid_argument",
          message: "query command cannot return mutation_plan",
        }),
      )
    }
    return finish(request, handlerResultToCommandResult(descriptor.id, plan))
  }

  async function dispatch(input: unknown): Promise<CommandResult> {
    const parsed = parseCommandRequest(input)
    if (!parsed.ok) {
      const id =
        typeof input === "object" && input !== null && "id" in input && typeof (input as { id: unknown }).id === "string"
          ? (input as { id: string }).id
          : "unknown"
      return fail(id, "invalid_argument", parsed.reason)
    }
    return dispatchRequest(parsed.value)
  }

  return { dispatch, dispatchRequest, probe: () => probe }
}

function fail(id: string, code: Parameters<typeof failureResult>[0]["code"], message: string): CommandResult {
  const result = failureResult({ id, code, message })
  assertAdminResultShape(result)
  return result
}

function projectContextFromRequest(request: CommandRequest): { projectId?: string | null } {
  const payload = request.payload
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const projectId = (payload as Record<string, unknown>).projectId
    if (typeof projectId === "string") return { projectId }
  }
  if (request.scope.kind === "project" && request.scope.ref) {
    return { projectId: request.scope.ref }
  }
  return { projectId: request.principal.projectBinding }
}

export * as OperatorDispatcher from "./dispatcher"
