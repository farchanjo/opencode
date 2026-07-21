/**
 * Feature 050 / T002 — the pure `Skill.Info -> SkillDoc` field-mapping builder,
 * sibling to `agent-doc.ts`.
 *
 * Framework-free, deterministic, zero I/O. `identity.content_hash` is derived
 * over `{description(scrubbed), slash}` ONLY — never `content`, which feeds
 * `skill-chunk.ts` exclusively; the forbidden-field guard (`projection.ts:41`)
 * would reject a raw `content` field on this document outright (`data-model.md`
 * "SkillDoc field mapping"). `cost.token_estimate` is a summary-level estimate
 * over the whole body via `Token.estimate`, distinct from the per-chunk
 * estimate on `SkillChunkDoc`. Skills carry no ruleset of their own — permission
 * evaluation happens externally against the REQUESTING agent
 * (`PermissionV2.evaluate("skill", ...)`, `core/skill.ts:31`) — so
 * `compat.permission_ref` is an identity-scoped placeholder hash of the skill
 * name alone, never an authority by itself (FR34 stays the query-time gate).
 */
export * as SkillDocBuilder from "./skill-doc"

import { createHash } from "node:crypto"
import type { SkillDoc } from "@opencode-ai/schema/semantic/documents"
import { Projection } from "./projection"
import { Token } from "../util/token"

/** The minimal structural shape this builder reads off a live skill — never the full `Skill.Info` schema type (C2). */
export interface SkillInfoLike {
  readonly name: string
  readonly description?: string
  readonly slash?: boolean
  /** The whole skill body — feeds `Token.estimate` here and `skill-chunk.ts` exclusively; NEVER stored on the doc. */
  readonly content: string
}

const stableHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/**
 * Build one `SkillDoc` from a live skill. Pure and deterministic; the same
 * input always yields the same document, including both independent hashes
 * (identity vs. compat.permission_ref) (FR7).
 */
export const build = (input: SkillInfoLike): SkillDoc => {
  const description = Projection.scrubText(input.description ?? "")
  const contentHash = stableHash({ description, slash: input.slash ?? false })
  const permissionRef = stableHash(input.name)

  return {
    id: input.name as SkillDoc["id"],
    identity: {
      version: 1,
      content_hash: contentHash,
      source: "skill" as SkillDoc["identity"]["source"],
    },
    descriptor: {
      name: input.name,
      description,
    },
    taxonomy: {
      triggers: [] as SkillDoc["taxonomy"]["triggers"],
      domains: [] as SkillDoc["taxonomy"]["domains"],
      capabilities: [] as SkillDoc["taxonomy"]["capabilities"],
    },
    compat: {
      roles: [] as SkillDoc["compat"]["roles"],
      agents: [] as SkillDoc["compat"]["agents"],
      permission_ref: permissionRef as SkillDoc["compat"]["permission_ref"],
    },
    cost: {
      token_estimate: Token.estimate(input.content),
      languages: [] as SkillDoc["cost"]["languages"],
    },
    availability: {
      enabled: true,
      available: true,
    },
  }
}
