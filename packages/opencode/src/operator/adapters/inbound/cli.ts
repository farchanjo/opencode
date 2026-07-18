/**
 * Native CLI operator adapter (T032–T034).
 * Same dispatcher/registry/stack as slash/HTTP; never LLM/ToolRegistry/MCP/plugin/custom.
 */
import {
  failureResult,
  type CommandRequest,
  type CommandResult,
  type OperatorPrincipal,
  type OperatorScope,
} from "@opencode-ai/core/operator"
import type { Dispatcher } from "../../application/dispatcher"
import type { OperatorCommandRegistry } from "../../application/registry"
import {
  parseCliInvocation,
  type CliParseFlags,
  type CliPrincipalContext,
} from "./cli-parse"
import { CLI_EXIT_CANCELLED, formatOperatorCli, type CliRenderMode } from "./cli-output"

export type CliConfirmBinding = {
  readonly commandId: string
  readonly scopeKind: string
  readonly scopeRef: string | null | undefined
  readonly version: string | undefined
}

export type CliConfirmFn = (input: {
  readonly message: string
  readonly binding: CliConfirmBinding
}) => Promise<boolean>

export type CliRunInput = {
  readonly segments: readonly string[]
  readonly flags: CliParseFlags
  readonly ctx: CliPrincipalContext
  readonly payloadRaw?: string
  readonly isTty: boolean
  /** Injected for tests; default uses @clack/prompts.confirm */
  readonly confirmPrompt?: CliConfirmFn
}

export type CliRunOutput = {
  readonly result: CommandResult
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly mode: CliRenderMode
  readonly cancelled?: boolean
}

export type CreateCliRunnerOptions = {
  readonly registry: OperatorCommandRegistry
  readonly dispatcher: Dispatcher
}

function localPrincipal(ctx: CliPrincipalContext): OperatorPrincipal {
  return {
    kind: "operator",
    subject: ctx.subject?.trim() || "local",
    projectBinding: ctx.projectId ?? null,
  }
}

/**
 * Evaluate CLI `--yes` / TTY confirmation policy (T034).
 * - TTY + --yes → rejected (never auto-yes on TTY)
 * - non-TTY + --yes → only when authenticated local operator
 * - TTY without --yes on confirm-required → interactive prompt
 * - non-TTY without --yes on confirm-required → confirmation_required
 *
 * Auth note (V1): production `opencode op` always sets authenticated=true
 * (local process owner = operator). The unauthenticated branch exists only for
 * injected test principals — there is no production path that claims unauth.
 */
export function evaluateCliYesPolicy(input: {
  readonly confirmRequired: boolean
  readonly yes: boolean
  readonly isTty: boolean
  /** Production CLI always true; tests may inject false. */
  readonly authenticated: boolean
  readonly commandId: string
}): {
  readonly proceed: true
  readonly confirm: boolean
  readonly interactive: boolean
} | {
  readonly proceed: false
  readonly result: CommandResult
} {
  if (!input.confirmRequired) {
    return { proceed: true, confirm: false, interactive: false }
  }

  if (input.yes && input.isTty) {
    return {
      proceed: false,
      result: failureResult({
        id: input.commandId,
        code: "confirmation_required",
        message: "--yes is rejected on TTY; use interactive confirm or non-TTY + local operator --yes",
        details: { source: "cli", reason: "tty_yes_rejected", isTty: true },
      }),
    }
  }

  if (input.yes && !input.isTty) {
    // Test-only injection: production op.ts never sets authenticated=false.
    if (!input.authenticated) {
      return {
        proceed: false,
        result: failureResult({
          id: input.commandId,
          code: "unauthorized",
          message: "--yes requires local operator principal (V1: process owner)",
          details: { source: "cli", reason: "yes_unauthenticated", testOnly: true },
        }),
      }
    }
    return { proceed: true, confirm: true, interactive: false }
  }

  if (input.isTty) {
    return { proceed: true, confirm: false, interactive: true }
  }

  return {
    proceed: false,
    result: failureResult({
      id: input.commandId,
      code: "confirmation_required",
      message: `${input.commandId} requires --yes (non-TTY) or interactive TTY confirm`,
      details: { source: "cli", reason: "noninteractive_confirm_required", isTty: false },
    }),
  }
}

export function createCliRunner(options: CreateCliRunnerOptions) {
  async function run(input: CliRunInput): Promise<CliRunOutput> {
    const mode: CliRenderMode = input.flags.json ? "json" : "human"
    const parsed = parseCliInvocation({
      segments: input.segments,
      flags: input.flags,
      registry: options.registry,
      ctx: input.ctx,
      payloadRaw: input.payloadRaw,
    })

    if (!parsed.ok) {
      const rendered = formatOperatorCli({ result: parsed.result, mode, diagnostic: parsed.usage })
      return { result: parsed.result, ...rendered, mode }
    }

    const policy = evaluateCliYesPolicy({
      confirmRequired: parsed.descriptor.confirmRequired,
      yes: parsed.yes,
      isTty: input.isTty,
      authenticated: input.ctx.authenticated,
      commandId: parsed.commandId,
    })

    if (!policy.proceed) {
      const rendered = formatOperatorCli({ result: policy.result, mode })
      return { result: policy.result, ...rendered, mode }
    }

    const binding: CliConfirmBinding = {
      commandId: parsed.commandId,
      scopeKind: parsed.scope.kind,
      scopeRef: parsed.scope.ref,
      version: parsed.version,
    }

    let cliInteractiveConfirmed = false
    let confirm = policy.confirm

    if (policy.interactive) {
      const prompt =
        input.confirmPrompt ??
        (async ({ message }) => {
          const prompts = await import("@clack/prompts")
          const answer = await prompts.confirm({ message })
          if (prompts.isCancel(answer)) return false
          return answer === true
        })
      const accepted = await prompt({
        message: `Confirm operator command ${parsed.commandId} (scope=${parsed.scope.kind}${parsed.scope.ref ? `:${parsed.scope.ref}` : ""}${parsed.version ? ` version=${parsed.version}` : ""})?`,
        binding,
      })
      if (!accepted) {
        const result = failureResult({
          id: parsed.commandId,
          code: "confirmation_required",
          message: "confirmation cancelled; no mutation applied",
          details: { source: "cli", reason: "user_cancelled", ...bindingFields(binding) },
        })
        const rendered = formatOperatorCli({ result, mode })
        return {
          result,
          stdout: rendered.stdout,
          stderr: rendered.stderr,
          exitCode: CLI_EXIT_CANCELLED,
          mode,
          cancelled: true,
        }
      }
      // Single execution after interactive confirm, bound to command/scope/version.
      cliInteractiveConfirmed = true
      confirm = true
    }

    const principal = localPrincipal(input.ctx)
    const request = buildCliRequest({
      id: parsed.commandId,
      principal,
      scope: parsed.scope,
      version: parsed.version,
      idempotencyKey: parsed.idempotencyKey,
      payload: parsed.payload,
      confirm,
      isTty: input.isTty,
      mutates: parsed.descriptor.mutates,
    })

    const result = await options.dispatcher.dispatchRequest(request, {
      cliInteractiveConfirmed,
    })

    const rendered = formatOperatorCli({ result, mode })
    return { result, ...rendered, mode }
  }

  return { run }
}

function bindingFields(binding: CliConfirmBinding): Record<string, string | number | boolean | null> {
  return {
    commandId: binding.commandId,
    scopeKind: binding.scopeKind,
    scopeRef: binding.scopeRef ?? null,
    version: binding.version ?? null,
  }
}

function buildCliRequest(input: {
  id: string
  principal: OperatorPrincipal
  scope: OperatorScope
  version?: string
  idempotencyKey?: string
  payload: Record<string, unknown>
  confirm: boolean
  isTty: boolean
  mutates: boolean
}): CommandRequest {
  return {
    id: input.id as CommandRequest["id"],
    principal: input.principal,
    scope: input.scope,
    source: "cli",
    isTty: input.isTty,
    confirm: input.confirm,
    payload: input.payload,
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.mutates && input.idempotencyKey !== undefined
      ? { idempotencyKey: input.idempotencyKey }
      : {}),
  }
}

export * as OperatorCliInbound from "./cli"
