/**
 * Native operator slash form helpers (Feature 007 / T029).
 * Canonical surface: `/op.<domain.operation>` from registry-generated aliases.
 * Clients MUST NOT invent divergent admin slash names.
 */
import { isReservedCommandId } from "./catalog"
import { parseCommandId } from "./command-id"

/** Registry-generated slash prefix (see OperatorCommandRegistry.generateAliases). */
export const OPERATOR_SLASH_PREFIX = "/op." as const

export type OperatorSlashParse =
  | {
      readonly kind: "operator"
      /** Full first-token slash alias including leading `/` (e.g. `/op.langlock.status`). */
      readonly alias: string
      /** Dotted command id when well-formed (`langlock.status`); null if malformed after prefix. */
      readonly commandId: string | null
      readonly argsText: string
      /** True when args include `--yes` / `-y` (slash must never honor these). */
      readonly hasYesFlag: boolean
    }
  | { readonly kind: "not_operator" }

/**
 * Detect reserved operator slash form before custom/MCP/plugin/LLM expansion.
 * Only `/op.<id>` is reserved; other `/...` slashes are not operator.
 */
export function parseOperatorSlash(input: string): OperatorSlashParse {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return { kind: "not_operator" }

  const firstLineEnd = trimmed.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? trimmed : trimmed.slice(0, firstLineEnd)
  const restLines = firstLineEnd === -1 ? "" : trimmed.slice(firstLineEnd + 1)

  const tokens = firstLine.split(/\s+/).filter(Boolean)
  const head = tokens[0]
  if (!head) return { kind: "not_operator" }

  // Canonical reserved form only: /op.<dotted.id>
  if (!head.startsWith(OPERATOR_SLASH_PREFIX)) {
    return { kind: "not_operator" }
  }

  const dotted = head.slice(OPERATOR_SLASH_PREFIX.length)
  const argsTokens = tokens.slice(1)
  const argsText = [argsTokens.join(" "), restLines].filter(Boolean).join("\n")
  const hasYesFlag = argsTokens.some((t) => t === "--yes" || t === "-y" || t === "--confirm")

  if (!dotted) {
    return {
      kind: "operator",
      alias: head,
      commandId: null,
      argsText,
      hasYesFlag,
    }
  }

  const parsed = parseCommandId(dotted)
  return {
    kind: "operator",
    alias: head,
    commandId: parsed.ok ? parsed.value : null,
    argsText,
    hasYesFlag,
  }
}

/** True when input is a reserved operator slash (must not fall through to LLM/custom). */
export function isOperatorSlash(input: string): boolean {
  return parseOperatorSlash(input).kind === "operator"
}

/** Registry slash alias for a canonical dotted id. */
export function operatorSlashAlias(id: string): string {
  return `${OPERATOR_SLASH_PREFIX}${id}`
}

/** Whether a parsed command id is in the reserved catalog. */
export function isReservedOperatorSlashId(id: string | null): boolean {
  if (!id) return false
  return isReservedCommandId(id)
}

export * as OperatorSlash from "./slash"
