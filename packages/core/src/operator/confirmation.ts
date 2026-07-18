/**
 * Confirmation matrix helpers (Feature 007 / T011 domain rules).
 * Destructive ops always require explicit confirm; slash never auto-yes.
 */
import type { CommandId } from "./command-id"
import { commandOperation, commandSegments } from "./command-id"

/** Operation leaf names that always require interactive confirmation (Q6). */
export const CONFIRM_OPERATION_LEAVES = [
  "cutover",
  "rollback",
  "delete",
  "disable",
  "purge",
  "rotate-secret",
  "export",
  "share",
] as const

export type ConfirmOperationLeaf = (typeof CONFIRM_OPERATION_LEAVES)[number]

const LEAF_SET: ReadonlySet<string> = new Set(CONFIRM_OPERATION_LEAVES)

/**
 * Experimental enable is nested: `*.experimental.enable` or `experimental.enable` as leaf path.
 * Matched via segments ending with experimental + enable.
 */
export function requiresConfirmation(id: CommandId | string): boolean {
  const segments = typeof id === "string" ? id.split(".") : commandSegments(id)
  if (segments.length < 2) return false

  const leaf = segments[segments.length - 1]!
  if (LEAF_SET.has(leaf)) return true

  // experimental.enable anywhere as trailing pair
  if (segments.length >= 2) {
    const a = segments[segments.length - 2]!
    const b = segments[segments.length - 1]!
    if (a === "experimental" && b === "enable") return true
  }

  return false
}

/** Slash source can never auto-confirm (Q6). */
export function canAutoConfirm(source: string, isTty: boolean, confirm: boolean): boolean {
  if (source === "slash") return false
  if (source === "palette" || source === "settings") return false
  // CLI: --yes only when non-TTY and authenticated (auth checked separately)
  if (source === "cli") return confirm && !isTty
  // API/SDK/system: explicit confirm:true
  if (source === "api" || source === "system" || source === "app" || source === "desktop") return confirm
  return false
}

export function confirmationDeniedReason(id: CommandId | string): string {
  const op = typeof id === "string" ? id.split(".").slice(1).join(".") : commandOperation(id as CommandId)
  return `${op || id} requires confirm=true (slash never auto-yes)`
}

export * as OperatorConfirmation from "./confirmation"
