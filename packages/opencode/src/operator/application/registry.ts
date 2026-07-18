/**
 * OperatorCommandRegistry (Feature 007 / T008).
 * register/lookup/alias generation; reserved/plugin/MCP/custom authority boundaries.
 * Instance-scoped — no process-global singleton.
 */
import {
  commandDomain,
  getReservedEntry,
  isReservedCommandId,
  parseCommandId,
  requiresConfirmation,
  RESERVED_CATALOG,
  type CommandAuthority,
  type CommandId,
  type DescriptorDraft,
  type OperatorCommandDescriptor,
  type ScopeKind,
} from "@opencode-ai/core/operator"

export type RegisterResult =
  | { readonly ok: true; readonly descriptor: OperatorCommandDescriptor }
  | { readonly ok: false; readonly code: "invalid_argument" | "reserved_name" | "conflict"; readonly reason: string }

export type AliasSet = {
  readonly slash: string
  readonly cli: readonly string[]
  readonly palette: string
}

/** Deterministic alias generation from canonical dotted id. */
export function generateAliases(id: string): AliasSet {
  const segments = id.split(".")
  const domain = segments[0] ?? id
  const rest = segments.slice(1)
  return {
    slash: `/op.${id}`,
    cli: ["op", domain, ...rest],
    palette: id,
  }
}

function toDescriptor(draft: DescriptorDraft, aliases: readonly string[]): OperatorCommandDescriptor | null {
  const parsed = parseCommandId(draft.id)
  if (!parsed.ok) return null
  const domain = commandDomain(parsed.value)
  return {
    id: parsed.value,
    aliases: [...aliases],
    mutates: draft.mutates,
    scopesAllowed: [...draft.scopesAllowed] as ScopeKind[],
    confirmRequired: draft.confirmRequired ?? requiresConfirmation(parsed.value),
    offlineCapable: draft.offlineCapable ?? true,
    schemaVersion: draft.schemaVersion ?? "1.0.0",
    authority: draft.authority ?? "native",
    domain,
    ...(draft.title !== undefined ? { title: draft.title } : {}),
  }
}

export type OperatorCommandRegistry = {
  readonly register: (draft: DescriptorDraft) => RegisterResult
  readonly lookup: (id: string) => OperatorCommandDescriptor | undefined
  readonly lookupByAlias: (alias: string) => OperatorCommandDescriptor | undefined
  readonly list: () => readonly OperatorCommandDescriptor[]
  readonly has: (id: string) => boolean
  readonly catalogVersion: () => string
  readonly size: () => number
}

/**
 * Create an empty registry. Call `seedReservedCatalog` to load native reserved IDs.
 * Dual register of same ID fails. Non-native authorities cannot claim reserved IDs.
 */
export function createOperatorCommandRegistry(): OperatorCommandRegistry {
  const byId = new Map<string, OperatorCommandDescriptor>()
  const byAlias = new Map<string, string>()
  /** Insertion order for deterministic list(). */
  const order: string[] = []

  function registerAlias(alias: string, id: string): RegisterResult | null {
    const existing = byAlias.get(alias)
    if (existing !== undefined && existing !== id) {
      return {
        ok: false,
        code: "conflict",
        reason: `alias "${alias}" already bound to ${existing}`,
      }
    }
    byAlias.set(alias, id)
    return null
  }

  function register(draft: DescriptorDraft): RegisterResult {
    const parsed = parseCommandId(draft.id)
    if (!parsed.ok) {
      return { ok: false, code: "invalid_argument", reason: parsed.reason }
    }
    const id = parsed.value as string
    const authority: CommandAuthority = draft.authority ?? "native"

    if (authority !== "native" && isReservedCommandId(id)) {
      return {
        ok: false,
        code: "reserved_name",
        reason: `command id "${id}" is reserved for native operator authority`,
      }
    }

    if (byId.has(id)) {
      return {
        ok: false,
        code: "conflict",
        reason: `command id "${id}" already registered`,
      }
    }

    const aliases = generateAliases(id)
    const aliasList = [aliases.slash, aliases.palette, aliases.cli.join(" ")] as const
    for (const alias of aliasList) {
      const conflict = registerAlias(alias, id)
      if (conflict) return conflict
    }
    // Also index bare id as alias
    const bare = registerAlias(id, id)
    if (bare) return bare

    const descriptor = toDescriptor({ ...draft, authority }, aliasList)
    if (!descriptor) {
      return { ok: false, code: "invalid_argument", reason: "failed to build descriptor" }
    }

    byId.set(id, descriptor)
    order.push(id)
    return { ok: true, descriptor }
  }

  return {
    register,
    lookup(id: string) {
      return byId.get(id)
    },
    lookupByAlias(alias: string) {
      const id = byAlias.get(alias)
      if (!id) return undefined
      return byId.get(id)
    },
    list() {
      return order.map((id) => byId.get(id)!).filter(Boolean)
    },
    has(id: string) {
      return byId.has(id)
    },
    catalogVersion() {
      return RESERVED_CATALOG.version
    },
    size() {
      return byId.size
    },
  }
}

/** Seed all reserved catalog entries as native descriptors. Deterministic order. */
export function seedReservedCatalog(registry: OperatorCommandRegistry): void {
  for (const draft of RESERVED_CATALOG.entries) {
    const result = registry.register(draft)
    if (!result.ok) {
      throw new Error(`failed to seed reserved catalog: ${draft.id}: ${result.reason}`)
    }
  }
}

/** Factory: registry preloaded with reserved catalog. Fresh instance per call (test isolation). */
export function createSeededOperatorCommandRegistry(): OperatorCommandRegistry {
  const registry = createOperatorCommandRegistry()
  seedReservedCatalog(registry)
  return registry
}

export function getCatalogEntryAsDraft(id: string): DescriptorDraft | undefined {
  return getReservedEntry(id)
}

export type { CommandId, OperatorCommandDescriptor }

export * as OperatorRegistry from "./registry"
