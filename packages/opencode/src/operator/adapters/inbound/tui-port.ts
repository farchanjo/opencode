/**
 * Bridge slash interceptor → TUI OperatorSlashPort.
 * Honors version + idempotencyKey on tryHandle; preflight via ConfigPort.get.
 */
import { authorityKeyForCommandId } from "../outbound/config-status"
import type { ConfigPort } from "../../application/ports/config-port"
import type { SlashInterceptor } from "./slash"
import { displayToToast } from "./slash-display"
import { resolveScopeForCommandId, type OutcomeType } from "@opencode-ai/core/operator"

export type OperatorPreflightResult =
  | {
      readonly ok: true
      readonly currentVersion: string | null
      readonly configured: boolean
      readonly scopeKind: string
      readonly scopeRef: string | null
      readonly authority: string
    }
  | {
      readonly ok: false
      readonly code: string
      readonly message: string
    }

export type TuiOperatorSlashPort = {
  readonly tryHandle: (input: {
    text: string
    projectId?: string | null
    sessionId?: string | null
    rootTreeRef?: string | null
    version?: string
    confirmToken?: string
    idempotencyKey?: string
  }) => Promise<
    | {
        readonly handled: true
        readonly display: {
          readonly title: string
          readonly message: string
          readonly variant: "info" | "success" | "warning" | "error"
          readonly outcome: string
          readonly auditPending: boolean
          readonly injectTranscript: false
        }
        readonly needsConfirmation?: {
          readonly token: string
          readonly commandId: string
          readonly message: string
        }
        readonly currentVersion?: string | null
        /**
         * Structured half of the handled result (Feature 012 FR1). Forwards the
         * typed outcome, the optional effective payload, and the version from the
         * Feature 007 `CommandResult` on the SAME tryHandle return — no new route
         * or command name. Absence of `effective` is representable (FR2).
         */
        readonly result?: {
          readonly outcome: OutcomeType
          readonly effective?: unknown
          readonly version?: string | null
        }
      }
    | { readonly handled: false }
  >
  readonly cancelConfirmation: (token: string) => void
  readonly preflightMutation: (input: {
    commandId: string
    projectId?: string | null
    sessionId?: string | null
    rootTreeRef?: string | null
  }) => Promise<OperatorPreflightResult>
}

export function createTuiOperatorSlashPort(
  interceptor: SlashInterceptor,
  options?: { readonly config?: ConfigPort },
): TuiOperatorSlashPort {
  return {
    cancelConfirmation(token) {
      interceptor.cancelConfirmation(token)
    },
    async preflightMutation(input) {
      if (!options?.config) {
        return {
          ok: false,
          code: "unavailable",
          message: "preflight ConfigPort not available",
        }
      }
      const scopeResult = resolveScopeForCommandId(input.commandId, {
        projectId: input.projectId,
        sessionId: input.sessionId,
        rootTreeRef: input.rootTreeRef,
      })
      if (!scopeResult.ok) {
        return { ok: false, code: scopeResult.code, message: scopeResult.message }
      }
      const authority = authorityKeyForCommandId(input.commandId)
      const entry = await options.config.get(authority)
      return {
        ok: true,
        currentVersion: entry?.version ?? null,
        configured: entry !== null,
        scopeKind: scopeResult.scope.kind,
        scopeRef: scopeResult.scope.ref ?? null,
        authority,
      }
    },
    async tryHandle(input) {
      const result = await interceptor.tryHandle({
        text: input.text,
        principalContext: {
          projectId: input.projectId ?? null,
          sessionId: input.sessionId ?? null,
          rootTreeRef: input.rootTreeRef ?? null,
          subject: "local",
        },
        version: input.version,
        idempotencyKey: input.idempotencyKey,
        confirmToken: input.confirmToken,
      })
      if (!result.handled) return { handled: false }

      const toast = displayToToast(result.display)
      return {
        handled: true,
        display: {
          title: toast.title,
          message: result.display.message,
          variant: toast.variant,
          outcome: result.display.outcome,
          auditPending: result.display.auditPending,
          injectTranscript: false,
        },
        ...(result.needsConfirmation
          ? {
              needsConfirmation: {
                token: result.needsConfirmation.token,
                commandId: result.needsConfirmation.commandId,
                message: result.needsConfirmation.message,
              },
            }
          : {}),
        currentVersion: result.result.version ?? null,
        result: {
          outcome: result.result.outcome,
          ...(result.result.effective !== undefined ? { effective: result.result.effective } : {}),
          version: result.result.version ?? null,
        },
      }
    },
  }
}

export * as OperatorTuiPort from "./tui-port"
