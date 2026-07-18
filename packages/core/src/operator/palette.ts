/**
 * Palette/Settings metadata from reserved catalog (T035–T036).
 * No hardcoded command lists — generated from RESERVED_CATALOG only.
 */
import { RESERVED_CATALOG, type OperatorDomain } from "./catalog"
import { requiresConfirmation } from "./confirmation"
import type { DescriptorDraft } from "./descriptor"

export type OperatorPaletteEntry = {
  readonly id: string
  readonly domain: string
  readonly operation: string
  readonly commandName: string
  readonly title: string
  readonly description: string
  readonly category: string
  readonly mutates: boolean
  readonly confirmRequired: boolean
  readonly scopesAllowed: readonly string[]
  readonly offlineCapable: boolean
  readonly slashAlias: string
  readonly paletteAlias: string
  /** Mutating secret/credential ops — require keychain (T019) when true */
  readonly secretRelated: boolean
  readonly suggest: boolean
  /** False when secretRelated and keychain unavailable. */
  readonly executable: boolean
}

export type ListPaletteOptions = {
  /** When true, secret mutation entries are executable (native keychain available). */
  readonly keychainAvailable?: boolean
}

/**
 * Block mutating secret operations; allow safe queries like mcp.auth.status.
 */
export function isOperatorSecretMutationId(id: string): boolean {
  const lower = id.toLowerCase()
  // Safe status/show queries involving auth are allowed
  if (lower.endsWith(".status") || lower.endsWith(".show") || lower.endsWith(".list") || lower.endsWith(".history")) {
    return false
  }
  if (lower.includes("rotate-secret") || lower.includes("rotate_secret")) return true
  if (lower.includes("mcp.auth.start") || lower.includes("mcp.auth.finish") || lower.includes("mcp.auth.remove")) {
    return true
  }
  if (lower.includes("password") || lower.includes("credential") || lower.includes("token")) {
    // token in middle of non-mutate already excluded
    return true
  }
  if (lower.includes("secret") && !lower.includes("status")) return true
  return false
}

/** @deprecated use isOperatorSecretMutationId — kept for call sites */
export function isOperatorSecretRelatedId(id: string): boolean {
  return isOperatorSecretMutationId(id)
}

function splitId(id: string): { domain: string; operation: string } {
  const i = id.indexOf(".")
  if (i <= 0) return { domain: id, operation: id }
  return { domain: id.slice(0, i), operation: id.slice(i + 1) }
}

function titleFor(draft: DescriptorDraft): string {
  if (draft.title) return draft.title
  const { domain, operation } = splitId(draft.id)
  return `${domain}: ${operation}`
}

export function listOperatorPaletteEntries(options: ListPaletteOptions = {}): readonly OperatorPaletteEntry[] {
  const keychainAvailable = options.keychainAvailable === true
  return RESERVED_CATALOG.entries.map((draft) => {
    const { domain, operation } = splitId(draft.id)
    const confirmRequired = draft.confirmRequired || requiresConfirmation(draft.id)
    const secretRelated = isOperatorSecretMutationId(draft.id)
    const secretBlocked = secretRelated && !keychainAvailable
    const suggest =
      !draft.mutates &&
      !secretRelated &&
      (operation === "status" ||
        operation === "show" ||
        operation.endsWith(".status") ||
        operation.endsWith(".show") ||
        operation === "auth.status")
    return {
      id: draft.id,
      domain,
      operation,
      commandName: `operator.${draft.id}`,
      title: titleFor(draft),
      description: secretBlocked
        ? `⚠ Secret mutation unavailable (keychain): ${draft.id}`
        : secretRelated
          ? `Secret mutation (keychain): ${draft.id}`
          : draft.mutates
            ? confirmRequired
              ? `Operator mutation (confirm required): ${draft.id}`
              : `Operator mutation: ${draft.id}`
            : `Operator query: ${draft.id}`,
      category: secretRelated ? `Operator / ${domain} / secrets` : `Operator / ${domain}`,
      mutates: draft.mutates,
      confirmRequired,
      scopesAllowed: [...draft.scopesAllowed],
      offlineCapable: draft.offlineCapable ?? !draft.mutates,
      slashAlias: `/op.${draft.id}`,
      paletteAlias: draft.id,
      secretRelated,
      suggest,
      executable: !secretBlocked,
    }
  })
}

export function listOperatorSuggestedEntries(): readonly OperatorPaletteEntry[] {
  return listOperatorPaletteEntries().filter((e) => e.suggest)
}

export const OPERATOR_SETTINGS_DOMAINS: readonly OperatorDomain[] = [
  "telemetry",
  "smart",
  "routing",
  "budget",
  "pools",
  "langlock",
  "semantic",
  "mcp",
] as const

export function listOperatorSettingsEntries(domain: string): readonly OperatorPaletteEntry[] {
  return listOperatorPaletteEntries().filter((e) => e.domain === domain)
}

export function listAllOperatorSettingsDomains(): readonly {
  readonly domain: string
  readonly title: string
  readonly entryCount: number
}[] {
  return OPERATOR_SETTINGS_DOMAINS.map((domain) => ({
    domain,
    title: domain.charAt(0).toUpperCase() + domain.slice(1),
    entryCount: listOperatorSettingsEntries(domain).length,
  }))
}

export function buildOperatorPaletteCommands(): readonly {
  readonly name: string
  readonly title: string
  readonly category: string
  readonly suggested: boolean
  readonly enabled: boolean
  readonly id: string
  readonly secretRelated: boolean
}[] {
  return listOperatorPaletteEntries().map((e) => ({
    name: e.commandName,
    title: e.title,
    category: e.category,
    suggested: e.suggest,
    enabled: e.executable,
    id: e.id,
    secretRelated: e.secretRelated,
  }))
}

export * as OperatorPalette from "./palette"
