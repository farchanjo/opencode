/**
 * Native slash intercept adapter (T029–T031).
 * Pre-prompt: reserved `/op.*` → same in-process dispatcher as HTTP.
 * Principal from local Instance/project only — never body/prompt principal.
 * No transcript Message/Part; zero LLM by construction.
 */
import {
  failureResult,
  parseOperatorSlash,
  resolveOperatorScope,
  type CommandRequest,
  type CommandResult,
  type OperatorPrincipal,
  type OperatorScope,
  type ScopeKind,
} from "@opencode-ai/core/operator"
import type { Dispatcher } from "../../application/dispatcher"
import type { OperatorCommandRegistry } from "../../application/registry"
import type { OperatorCommandDescriptor } from "@opencode-ai/core/operator"
import {
  createSlashConfirmStore,
  type SlashConfirmBinding,
  type SlashConfirmStore,
} from "./slash-confirm"
import { mapOperatorResultToDisplay, type OperatorSlashDisplay } from "./slash-display"

export type SlashPrincipalContext = {
  /** From local TUI Instance / project binding — never from prompt text. */
  readonly projectId?: string | null
  readonly subject?: string
  /** Current session when available (session-scoped commands). */
  readonly sessionId?: string | null
  /** Root-tree ref when available. */
  readonly rootTreeRef?: string | null
}

export type SlashInterceptInput = {
  readonly text: string
  /** Optional CAS version for mutations (overrides payload expectedVersion). */
  readonly version?: string
  /** Optional idempotency key for mutations (overrides payload; honored end-to-end). */
  readonly idempotencyKey?: string
  /** When user confirmed a prior confirmation_required prompt. */
  readonly confirmToken?: string
  readonly principalContext: SlashPrincipalContext
  readonly scope?: OperatorScope
}

export type SlashInterceptHandled = {
  readonly handled: true
  readonly result: CommandResult
  readonly display: OperatorSlashDisplay
  readonly needsConfirmation?: {
    readonly token: string
    readonly commandId: string
    readonly message: string
    readonly binding: SlashConfirmBinding
  }
  readonly cancelled?: boolean
}

export type SlashInterceptPass = {
  readonly handled: false
}

export type SlashInterceptResult = SlashInterceptHandled | SlashInterceptPass

export type SlashInterceptor = {
  readonly tryHandle: (input: SlashInterceptInput) => Promise<SlashInterceptResult>
  readonly cancelConfirmation: (token: string) => void
  readonly confirmStore: SlashConfirmStore
}

export type CreateSlashInterceptorOptions = {
  readonly registry: OperatorCommandRegistry
  readonly dispatcher: Dispatcher
  readonly confirmStore?: SlashConfirmStore
  readonly nowMs?: () => number
  readonly randomIdempotencyKey?: () => string
}

function localPrincipal(ctx: SlashPrincipalContext): OperatorPrincipal {
  return {
    kind: "operator",
    subject: ctx.subject?.trim() || "local",
    projectBinding: ctx.projectId ?? null,
  }
}

/**
 * Scope from runtime context + descriptor.scopesAllowed (shared core resolver).
 * Never arbitrary payload scope; never invents "local".
 */
export function resolveSlashScope(input: {
  ctx: SlashPrincipalContext
  descriptor: OperatorCommandDescriptor
  override?: OperatorScope
}) {
  return resolveOperatorScope({
    ctx: {
      projectId: input.ctx.projectId,
      sessionId: input.ctx.sessionId,
      rootTreeRef: input.ctx.rootTreeRef,
    },
    scopesAllowed: input.descriptor.scopesAllowed as readonly ScopeKind[],
    override: input.override,
  })
}

/**
 * Parse slash args JSON strictly for mutation fields.
 * expectedVersion / version / idempotencyKey extracted; principal/scope/confirm stripped.
 * Never invents expectedVersion for existing authority.
 */
export function parseSlashPayload(argsText: string): {
  readonly payload: Record<string, unknown>
  readonly expectedVersion?: string
  readonly idempotencyKey?: string
} {
  const trimmed = argsText.trim()
  if (!trimmed) return { payload: {} }
  if (!trimmed.startsWith("{")) return { payload: { args: trimmed } }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { payload: { args: trimmed } }
    }
    const record = { ...(parsed as Record<string, unknown>) }
    delete record.principal
    delete record.confirm
    delete record.source
    delete record.scope
    const expectedVersion =
      typeof record.expectedVersion === "string"
        ? record.expectedVersion
        : typeof record.version === "string"
          ? record.version
          : undefined
    const idempotencyKey = typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined
    delete record.expectedVersion
    delete record.version
    delete record.idempotencyKey
    return { payload: record, expectedVersion, idempotencyKey }
  } catch {
    return { payload: { args: trimmed } }
  }
}

function buildRequest(input: {
  id: string
  principal: OperatorPrincipal
  scope: OperatorScope
  version?: string
  idempotencyKey?: string
  payload: Record<string, unknown>
  mutates: boolean
  randomIdempotencyKey: () => string
}): CommandRequest {
  return {
    id: input.id as CommandRequest["id"],
    principal: input.principal,
    scope: input.scope,
    source: "slash",
    isTty: true,
    confirm: false,
    payload: input.payload,
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.mutates
      ? { idempotencyKey: input.idempotencyKey ?? input.randomIdempotencyKey() }
      : {}),
  }
}

/**
 * Create pre-prompt slash interceptor using the same dispatcher/registry as HTTP.
 */
export function createSlashInterceptor(options: CreateSlashInterceptorOptions): SlashInterceptor {
  const confirmStore = options.confirmStore ?? createSlashConfirmStore({ nowMs: options.nowMs })
  const randomIdempotencyKey =
    options.randomIdempotencyKey ??
    (() => `slash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)

  async function dispatchOperator(input: {
    commandId: string
    principal: OperatorPrincipal
    scope: OperatorScope
    version?: string
    idempotencyKey?: string
    payload: Record<string, unknown>
    slashInteractiveConfirmed: boolean
    mutates: boolean
  }): Promise<CommandResult> {
    const request = buildRequest({
      id: input.commandId,
      principal: input.principal,
      scope: input.scope,
      version: input.version,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      mutates: input.mutates,
      randomIdempotencyKey,
    })

    return options.dispatcher.dispatchRequest(request, {
      slashInteractiveConfirmed: input.slashInteractiveConfirmed,
    })
  }

  return {
    confirmStore,
    cancelConfirmation(token) {
      confirmStore.revoke(token)
    },
    async tryHandle(input) {
      const parsed = parseOperatorSlash(input.text)
      if (parsed.kind !== "operator") {
        return { handled: false }
      }

      const parsedPayload = parseSlashPayload(parsed.argsText)
      const payload = parsedPayload.payload
      // Explicit version/idempotency from caller wins; else payload (never invent version).
      const version = input.version ?? parsedPayload.expectedVersion
      const principal = localPrincipal(input.principalContext)

      if (!parsed.commandId) {
        const result = failureResult({
          id: "unknown",
          code: "invalid_argument",
          message: `invalid operator slash alias: ${parsed.alias}`,
          details: { source: "slash", alias: parsed.alias },
        })
        return {
          handled: true,
          result,
          display: mapOperatorResultToDisplay(result),
        }
      }

      const descriptor = options.registry.lookup(parsed.commandId)
      if (!descriptor) {
        const result = failureResult({
          id: parsed.commandId,
          code: "invalid_argument",
          message: `unknown operator command id: ${parsed.commandId}`,
          details: { source: "slash", reason: "unknown_reserved_alias", alias: parsed.alias },
        })
        return {
          handled: true,
          result,
          display: mapOperatorResultToDisplay(result),
        }
      }

      const scopeResult = resolveSlashScope({
        ctx: input.principalContext,
        descriptor,
        override: input.scope,
      })
      if (!scopeResult.ok) {
        const result = failureResult({
          id: descriptor.id,
          code: scopeResult.code,
          message: scopeResult.message,
          details: { source: "slash", ...scopeResult.details },
        })
        return {
          handled: true,
          result,
          display: mapOperatorResultToDisplay(result),
        }
      }
      const scope = scopeResult.scope

      const binding: SlashConfirmBinding = {
        commandId: descriptor.id,
        scopeKind: scope.kind,
        scopeRef: scope.ref,
        version,
      }

      let slashInteractiveConfirmed = false
      if (input.confirmToken) {
        const ok = confirmStore.consume(input.confirmToken, binding)
        if (!ok) {
          const result = failureResult({
            id: descriptor.id,
            code: "confirmation_required",
            message: "confirmation token invalid, expired, or bound to a different command/scope/version",
            details: { source: "slash", reason: "confirm_token_invalid" },
          })
          return {
            handled: true,
            result,
            display: mapOperatorResultToDisplay(result),
          }
        }
        slashInteractiveConfirmed = true
      }

      if (descriptor.confirmRequired && !slashInteractiveConfirmed) {
        const minted = confirmStore.mint(binding)
        const result = failureResult({
          id: descriptor.id,
          code: "confirmation_required",
          message: `${descriptor.id} requires interactive confirmation (slash never auto-yes)`,
          details: {
            source: "slash",
            reason: "slash_interactive_confirm",
            hasYesFlag: parsed.hasYesFlag,
          },
        })
        return {
          handled: true,
          result,
          display: mapOperatorResultToDisplay(result),
          needsConfirmation: {
            token: minted.token,
            commandId: descriptor.id,
            message: `Confirm operator command ${descriptor.id}?`,
            binding,
          },
        }
      }

      const result = await dispatchOperator({
        commandId: descriptor.id,
        principal,
        scope,
        version,
        // Honor explicit input.idempotencyKey over payload (TUI mutation contract)
        idempotencyKey: input.idempotencyKey ?? parsedPayload.idempotencyKey,
        payload,
        slashInteractiveConfirmed,
        mutates: descriptor.mutates,
      })

      if (result.outcome === "confirmation_required" && !slashInteractiveConfirmed) {
        const minted = confirmStore.mint(binding)
        return {
          handled: true,
          result,
          display: mapOperatorResultToDisplay(result),
          needsConfirmation: {
            token: minted.token,
            commandId: descriptor.id,
            message: `Confirm operator command ${descriptor.id}?`,
            binding,
          },
        }
      }

      return {
        handled: true,
        result,
        display: mapOperatorResultToDisplay(result),
      }
    },
  }
}

export * as OperatorSlashInbound from "./slash"
