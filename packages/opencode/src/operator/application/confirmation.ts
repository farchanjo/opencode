/**
 * Confirmation gate (Feature 007 / T011).
 * Enforces confirm for approved destructive ops; slash never auto-yes.
 */
import {
  canAutoConfirm,
  confirmationDeniedReason,
  makeOperatorError,
  requiresConfirmation,
  type CommandRequest,
  type CommandResult,
  type OperatorCommandDescriptor,
} from "@opencode-ai/core/operator"
import { failureResult } from "@opencode-ai/core/operator"

export type ConfirmationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly result: CommandResult }

/**
 * Evaluate confirmation gate for a request against its descriptor.
 * - Non-confirm-required ops pass through.
 * - confirm=true only counts when source policy allows auto-confirm.
 * - slash never auto-yes via confirm=true / `--yes`; only T030 interactive confirm
 *   (slashInteractiveConfirmed after single-use token) may proceed.
 */
export function evaluateConfirmation(input: {
  request: CommandRequest
  descriptor: OperatorCommandDescriptor
  /** Set only by slash adapter after native confirm modal + single-use token consume. */
  slashInteractiveConfirmed?: boolean
  /** Set only by CLI adapter after native TTY confirm (T034); single execution. */
  cliInteractiveConfirmed?: boolean
}): ConfirmationDecision {
  const { request, descriptor } = input
  const needsConfirm = descriptor.confirmRequired || requiresConfirmation(descriptor.id)
  if (!needsConfirm) {
    return { allowed: true }
  }

  const isTty = request.isTty ?? true
  const confirm = request.confirm === true
  const source = request.source

  // Slash: never auto-yes (Q6). Interactive path only via slashInteractiveConfirmed (T030).
  if (source === "slash") {
    if (input.slashInteractiveConfirmed === true) {
      return { allowed: true }
    }
    return {
      allowed: false,
      result: failureResult({
        id: descriptor.id,
        code: "confirmation_required",
        message: confirmationDeniedReason(descriptor.id),
        details: { source, reason: "slash_never_auto_yes" },
      }),
    }
  }

  // CLI TTY interactive: after native prompt only (never via --yes on TTY).
  if (source === "cli" && input.cliInteractiveConfirmed === true) {
    return { allowed: true }
  }

  if (!confirm) {
    return {
      allowed: false,
      result: failureResult({
        id: descriptor.id,
        code: "confirmation_required",
        message: confirmationDeniedReason(descriptor.id),
        details: { source, confirm: false },
      }),
    }
  }

  if (!canAutoConfirm(source, isTty, confirm)) {
    return {
      allowed: false,
      result: failureResult({
        id: descriptor.id,
        code: "confirmation_required",
        message: `confirm rejected for source=${source} isTty=${isTty}`,
        details: { source, isTty, confirm },
      }),
    }
  }

  return { allowed: true }
}

/** Explicit metadata for audit/debug (source, TTY, operator subject). */
export function confirmationMetadata(request: CommandRequest): {
  source: string
  isTty: boolean
  confirm: boolean
  principalKind: string
  subject: string
} {
  return {
    source: request.source,
    isTty: request.isTty ?? true,
    confirm: request.confirm === true,
    principalKind: request.principal.kind,
    subject: request.principal.subject,
  }
}

export function confirmationRequiredError(id: string, message: string) {
  return makeOperatorError({
    code: "confirmation_required",
    message,
    details: { id },
  })
}

export * as OperatorConfirmationGate from "./confirmation"
