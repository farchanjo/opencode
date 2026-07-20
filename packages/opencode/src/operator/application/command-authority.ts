/**
 * Feature 017 fix-round (ADR-0017 superseding decision) — per-command authority
 * resolution for the mutation preflight.
 *
 * The mutation preflight (`/operator/v1/preflight`) must return the version of the
 * SAME Config authority the command's `OperatorMutationPlan` will commit to, so the
 * client threads the correct `expectedVersion` (CAS token). The naive
 * `commandId.split(".")[0]` prefix drifts from the real authority — the shared
 * globals (`global:telemetry`, `global:mcp`, `global:mcp-connections`,
 * `global:mcp-auth`, `global:output-admin`, ...) never match `telemetry`/`mcp`/
 * `output`, so preflight reported `configured:false`/`currentVersion:null` and the
 * second mutation on any shared authority failed `mutations require version`.
 *
 * This registry resolves the authority a command commits to. It is SOURCED from the
 * domains — the static authorities are the domain modules' own exported constants
 * (no re-typed string table to drift), and the scope-dependent ones consult the
 * SAME resolver lambdas the composition root passes to the backends. An unknown /
 * non-mutating id resolves to `null`; the caller then falls back to the prefix.
 */
import { AUTHORITY as TELEMETRY_AUTHORITY } from "../telemetry/backend-live"
import { AUTHORITY as SEMANTIC_AUTHORITY } from "../semantic/registry-backend"
import { AUTHORITY as SMART_AUTHORITY } from "../smart/backend-live"
import { AUTHORITY as BUDGET_AUTHORITY } from "../budget/backend-live"
import { PROJECT_AUTHORITY as POOLS_AUTHORITY } from "../pools/backend-live"
import { AUTHORITY as JOBS_AUTHORITY } from "../jobs/persistence"
import { OUTPUT_ADMIN_AUTHORITY } from "../outputspool/backend-live"
import { MCP_CONFIG_AUTHORITY, MCP_CONNECTIONS_AUTHORITY, MCP_AUTH_AUTHORITY } from "../mcp/backend-live"

export type AuthorityScopeCtx = {
  readonly scopeKind: string
  readonly scopeRef: string | null
}

/** Resolve the Config authority a mutating command commits to, or null when unknown. */
export type OperatorAuthorityResolver = (commandId: string, scope: AuthorityScopeCtx) => string | null

export interface AuthorityResolverDeps {
  /** langlock.set/reset/override authority — the SAME resolver the langlock backend commits under. */
  readonly langlockAuthorityFor?: (scope: "global" | "project", scopeId: string) => string
  /** output.retention.set authority — the SAME lambda the outputspool backend commits under. */
  readonly retentionAuthorityFor?: (scope: "global" | "project", scopeId: string) => string
  /** output.quota.set authority — the SAME lambda the outputspool backend commits under. */
  readonly quotaAuthorityFor?: (scope: "global" | "project", scopeId: string) => string
}

/** The config-backed mcp verbs that commit through the single `global:mcp` document authority. */
const MCP_CONFIG_VERBS: ReadonlySet<string> = new Set([
  "mcp.server.add",
  "mcp.server.update",
  "mcp.server.delete",
  "mcp.server.disable",
  "mcp.logging.level.set",
  "mcp.experimental.enable",
  "mcp.experimental.disable",
  "mcp.extension.enable",
  "mcp.extension.disable",
  "mcp.resource.admin.policy.set",
])

/** The live-service mcp actions that record their outcome under the store-scoped connections authority. */
const MCP_CONNECTION_VERBS: ReadonlySet<string> = new Set([
  "mcp.server.connect",
  "mcp.server.disconnect",
  "mcp.server.reconnect",
])

/** The store-scoped outputspool admin verbs that record under the single `global:output-admin` authority. */
const OUTPUT_ADMIN_VERBS: ReadonlySet<string> = new Set(["output.release", "output.delete", "output.purge"])

/**
 * Build the authority resolver. Static authorities come from the domain modules'
 * exported constants; scope-dependent ones use the injected resolver lambdas (the
 * same ones the composition root binds to the backends). Absent lambdas resolve
 * their verbs to null so the preflight falls back to the prefix (no regression).
 */
export function createOperatorAuthorityResolver(deps: AuthorityResolverDeps = {}): OperatorAuthorityResolver {
  const norm = (kind: string): "global" | "project" => (kind === "global" ? "global" : "project")
  return (commandId, scope) => {
    const s = norm(scope.scopeKind)
    const scopeId = scope.scopeRef ?? ""
    const domain = commandId.includes(".") ? commandId.slice(0, commandId.indexOf(".")) : commandId
    switch (domain) {
      case "telemetry":
        return TELEMETRY_AUTHORITY
      case "semantic":
        return SEMANTIC_AUTHORITY
      case "smart":
        return SMART_AUTHORITY[s]
      case "budget":
        return BUDGET_AUTHORITY[s]
      case "pools":
        return POOLS_AUTHORITY
      case "jobs":
        return JOBS_AUTHORITY
      // routing shares the same per-scope routing document authority as smart/budget.
      case "routing":
        return SMART_AUTHORITY[s]
      case "langlock":
        return deps.langlockAuthorityFor ? deps.langlockAuthorityFor(s, scopeId) : null
      case "output":
        if (commandId === "output.retention.set")
          return deps.retentionAuthorityFor ? deps.retentionAuthorityFor(s, scopeId) : null
        if (commandId === "output.quota.set")
          return deps.quotaAuthorityFor ? deps.quotaAuthorityFor(s, scopeId) : null
        if (OUTPUT_ADMIN_VERBS.has(commandId)) return OUTPUT_ADMIN_AUTHORITY
        return null
      case "mcp":
        if (MCP_CONNECTION_VERBS.has(commandId)) return MCP_CONNECTIONS_AUTHORITY
        if (commandId === "mcp.auth.remove") return MCP_AUTH_AUTHORITY
        if (MCP_CONFIG_VERBS.has(commandId)) return MCP_CONFIG_AUTHORITY
        return null
      default:
        return null
    }
  }
}

export * as OperatorCommandAuthority from "./command-authority"
