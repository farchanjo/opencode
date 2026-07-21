/**
 * Feature 050 / T001 — the pure `Agent.Info -> AgentDoc` field-mapping builder.
 *
 * Framework-free, deterministic, zero I/O (mirrors `projection.ts`/
 * `tool-projection.ts`'s pattern). Reuses `Projection.scrubText` to sanitize the
 * ranking-signal description and derives two INDEPENDENT stable hashes: the
 * document `identity.content_hash` (ranking/upsert-tombstone key) and
 * `scope.permission_ref` (a ruleset-only fingerprint), so a description-only
 * edit and a permissions-only edit are each independently detectable (`data-model.md`
 * "AgentDoc field mapping").
 *
 * The input is a MINIMAL structural shape mirroring `Agent.Info`
 * (`packages/schema/src/agent.ts:20-31`) — this module never imports the live
 * opencode `Agent`/`AgentV2` runtime, so core stays pure and framework-free
 * (C2). `Agent.Info` carries no `domains`/`capabilities`/`tools`/`languages`
 * field; every one of those defaults to an honest empty `TagSet`/`[]` rather
 * than inventing ranking signal (`research.md` "`Agent.Info`/`Skill.Info` are
 * thinner"). No prompt/body ever crosses into the doc — only the sanitized
 * description, closed enums, and opaque hashes (FR17, the forbidden-field guard
 * at `projection.ts:41-44`).
 */
export * as AgentDocBuilder from "./agent-doc"

import { createHash } from "node:crypto"
import type { AgentDoc } from "@opencode-ai/schema/semantic/documents"
import { Projection } from "./projection"

/** The minimal structural shape this builder reads off a live agent — never the full `Agent.Info` schema type (C2). */
export interface AgentInfoLike {
  readonly id: string
  readonly description?: string
  readonly mode: "subagent" | "primary" | "all"
  readonly hidden: boolean
  readonly color?: string
  /** The full `Permission.Ruleset`; hashed opaquely — never interpreted or re-evaluated here (FR34, C11). */
  readonly permissions: unknown
}

/** Builder-supplied context the caller injects rather than reading off `Agent.Info` (`data-model.md`). */
export interface AgentDocContext {
  readonly projectId: string
}

/** `mode: "primary"` claims the elevated `architect` role; `subagent`/`all` stay the conservative `worker` default. */
const roleForMode = (mode: AgentInfoLike["mode"]): AgentDoc["classification"]["role"] =>
  mode === "primary" ? "architect" : "worker"

/** Stable-key JSON hash — reused for both the ranking content hash and the ruleset-only `permission_ref` (mirrors `ToolProjection.contentHash`). */
const stableHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/**
 * Build one `AgentDoc` from a live agent + the caller-injected project context.
 * Pure and deterministic: the same input always yields the same document,
 * including the two independent hashes (FR7).
 */
export const build = (input: AgentInfoLike, context: AgentDocContext): AgentDoc => {
  const description = Projection.scrubText(input.description ?? "")
  const contentHash = stableHash({
    description,
    mode: input.mode,
    hidden: input.hidden,
    permissions: input.permissions,
    color: input.color ?? null,
  })
  const permissionRef = stableHash(input.permissions)
  const enabled = !input.hidden

  return {
    id: input.id as AgentDoc["id"],
    identity: {
      version: 1,
      content_hash: contentHash,
      source: "agent" as AgentDoc["identity"]["source"],
    },
    classification: {
      role: roleForMode(input.mode),
      mode: input.mode as AgentDoc["classification"]["mode"],
      description,
    },
    taxonomy: {
      domains: [] as AgentDoc["taxonomy"]["domains"],
      capabilities: [] as AgentDoc["taxonomy"]["capabilities"],
      tools: [] as AgentDoc["taxonomy"]["tools"],
    },
    scope: {
      project_id: context.projectId as AgentDoc["scope"]["project_id"],
      scope: "project" as AgentDoc["scope"]["scope"],
      visibility: "project" as AgentDoc["scope"]["visibility"],
      permission_ref: permissionRef as AgentDoc["scope"]["permission_ref"],
    },
    languages: [] as AgentDoc["languages"],
    availability: {
      enabled,
      available: enabled,
    },
  }
}
