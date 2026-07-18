/**
 * Execute operator command via OperatorSlashPort (T035–T036).
 * Mutations REQUIRE preflightMutation; mint one idempotencyKey for confirm/retry.
 * Never session.prompt / custom / MCP / plugin / LLM.
 */
import {
  listOperatorPaletteEntries,
  buildOperatorPaletteCommands,
  type OperatorPaletteEntry,
} from "@opencode-ai/core/operator"
import type { OperatorSlashPort } from "../context/operator-slash"
import type { DialogContext } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"

export type OperatorToast = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  show: (input: any) => void
}

export function operatorPaletteEntries(): readonly OperatorPaletteEntry[] {
  return listOperatorPaletteEntries()
}

export function operatorPaletteCommandRegistrations() {
  return buildOperatorPaletteCommands()
}

function mintIdempotencyKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `tui_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

export async function executeOperatorCommand(input: {
  entry: OperatorPaletteEntry
  port: OperatorSlashPort | undefined
  projectId?: string | null
  sessionId?: string | null
  rootTreeRef?: string | null
  version?: string
  dialog: DialogContext
  toast: OperatorToast
  /**
   * Optional structured command arguments (e.g. `langlock.set`'s `tag`).
   * Embedded as strict JSON after the slash alias — the same `argsText`
   * contract the inbound slash adapters already parse
   * (`packages/opencode/src/operator/adapters/inbound/slash.ts`
   * `parseSlashPayload`). Omit for argument-less commands (unchanged
   * behavior).
   */
  payload?: Record<string, unknown>
}): Promise<{ outcome?: string; cancelled?: boolean }> {
  if (!input.port) {
    input.toast.show({
      title: "Operator unavailable",
      message: "Operator control plane is not available in this TUI session",
      variant: "warning",
    })
    return { outcome: "unavailable" }
  }

  if (!input.entry.executable || input.entry.secretRelated) {
    input.toast.show({
      title: "Secret action unavailable",
      message: `${input.entry.id} disabled until T019 keychain (no plaintext)`,
      variant: "warning",
    })
    return { outcome: "unavailable" }
  }

  const text = input.payload ? `/op.${input.entry.id} ${JSON.stringify(input.payload)}` : `/op.${input.entry.id}`
  const base = {
    text,
    projectId: input.projectId,
    sessionId: input.sessionId,
    rootTreeRef: input.rootTreeRef,
  }

  if (input.entry.mutates || input.entry.confirmRequired) {
    // Preflight always required for mutations — no blind mutate
    if (!input.port.preflightMutation) {
      input.toast.show({
        title: "Operator unavailable",
        message: "Mutation preflight not supported by this port",
        variant: "warning",
      })
      return { outcome: "unavailable" }
    }

    const pre = await input.port.preflightMutation({
      commandId: input.entry.id,
      projectId: input.projectId,
      sessionId: input.sessionId,
      rootTreeRef: input.rootTreeRef,
    })
    if (!pre.ok) {
      input.toast.show({
        title: "Operator preflight failed",
        message: pre.message,
        variant: "warning",
      })
      return { outcome: pre.code }
    }

    let version = input.version
    if (pre.currentVersion !== null) {
      version = version ?? pre.currentVersion
    }
    if (pre.configured && version === undefined) {
      input.toast.show({
        title: "Operator conflict",
        message: `${input.entry.id}: authority exists but version missing — refresh status`,
        variant: "warning",
      })
      return { outcome: "conflict" }
    }

    const idempotencyKey = mintIdempotencyKey()
    const first = await input.port.tryHandle({
      ...base,
      version,
      idempotencyKey,
    })
    if (!first.handled) {
      input.toast.show({
        title: "Operator",
        message: "Reserved operator command was not handled",
        variant: "error",
      })
      return { outcome: "invalid_argument" }
    }

    if (first.needsConfirmation) {
      const ok = await DialogConfirm.show(
        input.dialog,
        "Confirm operator command",
        `${first.needsConfirmation.message}${version ? ` (version=${version})` : " (create)"}`,
      )
      if (!ok) {
        input.port.cancelConfirmation?.(first.needsConfirmation.token)
        input.toast.show({
          title: "Operator cancelled",
          message: `${input.entry.id} cancelled`,
          variant: "info",
        })
        return { cancelled: true, outcome: "confirmation_required" }
      }
      // Same key+version on confirm; conflict does not auto-reapply
      const second = await input.port.tryHandle({
        ...base,
        version,
        idempotencyKey,
        confirmToken: first.needsConfirmation.token,
      })
      if (second.handled) {
        if (second.display.outcome === "conflict") {
          // Refresh preflight for user; do not auto-reapply
          const refresh = await input.port.preflightMutation!({
            commandId: input.entry.id,
            projectId: input.projectId,
            sessionId: input.sessionId,
            rootTreeRef: input.rootTreeRef,
          })
          if (refresh.ok) {
            input.toast.show({
              title: "Operator conflict",
              message: `CAS conflict — current version=${refresh.currentVersion ?? "null"}; re-confirm required`,
              variant: "warning",
            })
          } else {
            showDisplay(input.toast, second.display)
          }
          return { outcome: "conflict" }
        }
        showDisplay(input.toast, second.display)
        return { outcome: second.display.outcome }
      }
    }
    showDisplay(input.toast, first.display)
    return { outcome: first.display.outcome }
  }

  const result = await input.port.tryHandle(base)
  if (!result.handled) {
    input.toast.show({
      title: "Operator",
      message: "Reserved operator command was not handled",
      variant: "error",
    })
    return { outcome: "invalid_argument" }
  }
  showDisplay(input.toast, result.display)
  return { outcome: result.display.outcome }
}

function showDisplay(
  toast: OperatorToast,
  display: {
    title: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    auditPending?: boolean
  },
) {
  toast.show({
    title: display.title,
    message: display.auditPending ? `${display.message} [audit pending]` : display.message,
    variant: display.variant,
    duration: display.auditPending || display.variant === "warning" ? 8000 : 5000,
  })
}
