/**
 * Versioned reserved operator ID catalog (Feature 007 / T007).
 * Source of aliases/metadata for all Phase 1 domains. No duplicate IDs.
 */
import { requiresConfirmation } from "./confirmation"
import type { ScopeKind } from "./scope"
import type { DescriptorDraft } from "./descriptor"

/** Catalog document version (semver). Additive bumps only. */
export const RESERVED_CATALOG_VERSION = "1.1.0" as const

export const OPERATOR_DOMAINS = [
  "telemetry",
  "smart",
  "routing",
  "budget",
  "pools",
  "process",
  "task",
  "jobs",
  "langlock",
  "output",
  "semantic",
  "mcp",
] as const

export type OperatorDomain = (typeof OPERATOR_DOMAINS)[number]

type EntrySpec = {
  readonly id: string
  readonly mutates: boolean
  readonly scopesAllowed: readonly ScopeKind[]
  readonly offlineCapable?: boolean
  readonly title?: string
}

function entry(spec: EntrySpec): DescriptorDraft {
  return {
    id: spec.id,
    mutates: spec.mutates,
    scopesAllowed: spec.scopesAllowed,
    confirmRequired: requiresConfirmation(spec.id),
    offlineCapable: spec.offlineCapable ?? !spec.mutates,
    schemaVersion: "1.0.0",
    authority: "native",
    title: spec.title,
  }
}

const GP: readonly ScopeKind[] = ["global", "project"]
const P: readonly ScopeKind[] = ["project"]
const S: readonly ScopeKind[] = ["session"]
const SP: readonly ScopeKind[] = ["session", "project"]
const RT: readonly ScopeKind[] = ["root-tree"]

/**
 * Complete reserved catalog entries for Phase 1 domains.
 * Semantic and MCP lists are exhaustive per research/ADR-0003.
 */
const ENTRIES: readonly EntrySpec[] = [
  // telemetry
  { id: "telemetry.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "telemetry.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "telemetry.on", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "telemetry.off", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "telemetry.configure", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "telemetry.test", mutates: true, scopesAllowed: GP, offlineCapable: false },

  // smart
  { id: "smart.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "smart.on", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "smart.off", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "smart.auto", mutates: true, scopesAllowed: GP, offlineCapable: true },

  // routing
  { id: "routing.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "routing.configure", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "routing.test", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "routing.explain", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "routing.capability.inspect", mutates: false, scopesAllowed: GP, offlineCapable: true },

  // budget
  { id: "budget.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "budget.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "budget.set", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "budget.reset", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "budget.validate", mutates: false, scopesAllowed: GP, offlineCapable: true },

  // pools
  { id: "pools.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "pools.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "pools.set", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "pools.reset", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "pools.validate", mutates: false, scopesAllowed: GP, offlineCapable: true },

  // process (session-bound mutate)
  { id: "process.status", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "process.list", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "process.pause", mutates: true, scopesAllowed: S, offlineCapable: true },
  { id: "process.resume", mutates: true, scopesAllowed: S, offlineCapable: true },
  { id: "process.kill", mutates: true, scopesAllowed: S, offlineCapable: true },

  // task
  { id: "task.status", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "task.list", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "task.cancel", mutates: true, scopesAllowed: S, offlineCapable: true },

  // jobs
  { id: "jobs.list", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "jobs.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "jobs.create", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "jobs.update", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "jobs.enable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "jobs.disable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "jobs.delete", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "jobs.run-now", mutates: true, scopesAllowed: P, offlineCapable: false },

  // langlock
  { id: "langlock.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "langlock.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "langlock.set", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "langlock.reset", mutates: true, scopesAllowed: GP, offlineCapable: true },

  // output (consume + admin)
  { id: "output.stat", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "output.read", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "output.follow", mutates: false, scopesAllowed: SP, offlineCapable: true },
  { id: "output.export", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "output.share", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "output.release", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "output.delete", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "output.purge", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "output.retention.set", mutates: true, scopesAllowed: GP, offlineCapable: true },
  { id: "output.quota.set", mutates: true, scopesAllowed: GP, offlineCapable: true },

  // semantic (exhaustive)
  { id: "semantic.provider.list", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.provider.add", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.provider.update", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.provider.test", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "semantic.provider.disable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.provider.delete", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.provider.rotate-secret", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.model.list", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.model.discover", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "semantic.model.register", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.model.validate", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "semantic.model.disable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.embedding.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.embedding.select", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.embedding.validate", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "semantic.embedding.reindex", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "semantic.embedding.cutover", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.embedding.rollback", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.reranker.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.reranker.select", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.reranker.validate", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "semantic.reranker.cutover", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.reranker.rollback", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "semantic.binding.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.binding.history", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.index.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "semantic.index.test", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "semantic.index.reindex", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "semantic.index.reconcile", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "semantic.index.show-collections", mutates: false, scopesAllowed: GP, offlineCapable: true },

  // mcp (exhaustive)
  { id: "mcp.server.list", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.server.add", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.server.update", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.server.test", mutates: false, scopesAllowed: GP, offlineCapable: false },
  { id: "mcp.server.connect", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "mcp.server.disconnect", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.server.reconnect", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "mcp.server.disable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.server.delete", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.server.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.server.capabilities", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.auth.start", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "mcp.auth.finish", mutates: true, scopesAllowed: P, offlineCapable: false },
  { id: "mcp.auth.remove", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.auth.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.resource.admin.list", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.resource.admin.templates", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.resource.admin.read", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.resource.admin.subscribe", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.resource.admin.unsubscribe", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.resource.admin.policy.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.resource.admin.policy.set", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.logging.level.show", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.logging.level.set", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.experimental.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.experimental.enable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.experimental.disable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.extension.status", mutates: false, scopesAllowed: GP, offlineCapable: true },
  { id: "mcp.extension.enable", mutates: true, scopesAllowed: P, offlineCapable: true },
  { id: "mcp.extension.disable", mutates: true, scopesAllowed: P, offlineCapable: true },

  // root-tree workspace ops reserved for future workspace integration
  { id: "process.workspace.status", mutates: false, scopesAllowed: RT, offlineCapable: true },
]

function assertNoDuplicates(entries: readonly EntrySpec[]): void {
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.id)) {
      throw new Error(`duplicate reserved operator id: ${e.id}`)
    }
    seen.add(e.id)
  }
}

assertNoDuplicates(ENTRIES)

export type ReservedCatalogDocument = {
  readonly version: typeof RESERVED_CATALOG_VERSION
  readonly domains: readonly OperatorDomain[]
  readonly ids: readonly string[]
  readonly entries: readonly DescriptorDraft[]
}

const drafts: readonly DescriptorDraft[] = ENTRIES.map(entry)

export const RESERVED_CATALOG: ReservedCatalogDocument = {
  version: RESERVED_CATALOG_VERSION,
  domains: OPERATOR_DOMAINS,
  ids: drafts.map((d) => d.id),
  entries: drafts,
}

export function isReservedCommandId(id: string): boolean {
  return RESERVED_ID_SET.has(id)
}

export function getReservedEntry(id: string): DescriptorDraft | undefined {
  return RESERVED_BY_ID.get(id)
}

export function listReservedIds(): readonly string[] {
  return RESERVED_CATALOG.ids
}

const RESERVED_ID_SET: ReadonlySet<string> = new Set(RESERVED_CATALOG.ids)
const RESERVED_BY_ID: ReadonlyMap<string, DescriptorDraft> = new Map(drafts.map((d) => [d.id, d]))

export function catalogVersion(): string {
  return RESERVED_CATALOG.version
}

export function reservedCatalogSnapshot(): {
  version: string
  domainCount: number
  idCount: number
  domains: readonly string[]
} {
  return {
    version: RESERVED_CATALOG.version,
    domainCount: RESERVED_CATALOG.domains.length,
    idCount: RESERVED_CATALOG.ids.length,
    domains: [...RESERVED_CATALOG.domains],
  }
}

export * as OperatorCatalog from "./catalog"
