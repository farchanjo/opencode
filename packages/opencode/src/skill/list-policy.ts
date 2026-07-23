/**
 * Feature 058 — Tier-1 skill listing: ranked-first, hard cap, format.
 *
 * Natural order:
 * 1. Semantic ranked ids (when present) — preserve rank order, never re-sort A–Z
 * 2. Else path/trigger match order (deterministic relevance)
 * 3. Else light lexical score against prompt (name+description tokens)
 * 4. Cap to max_listed
 *
 * Never dump the full catalog alphabetically as the primary path.
 */
import type { ResolvedSkillListConfig, SkillListFormat } from "@opencode-ai/core/config/experimental"
import { escapeHtml } from "@/util/html"
import { matchSkills, type SkillMeta } from "./match"

export type SkillListMode = "ranked" | "matched" | "lexical" | "passthrough"

export interface SkillListApplyResult<T extends { name: string; description?: string; location: string }> {
  readonly list: readonly T[]
  readonly mode: SkillListMode
  readonly total: number
  readonly listed: number
  readonly format: SkillListFormat
  readonly capped: boolean
}

export interface SkillListOrderInput {
  /** Semantic ranking from F051; when set, mode=ranked and order is preserved. */
  readonly ranked?: readonly string[]
  /** Optional SkillMeta for path/trigger match (cwd files + prompt). */
  readonly metaByName?: ReadonlyMap<string, SkillMeta>
  readonly cwdFiles?: readonly string[]
  readonly prompt?: string
}

function lexicalScore(skill: { name: string; description?: string }, prompt: string): number {
  if (!prompt.trim()) return 0
  const tokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/)
    .filter((t) => t.length >= 3)
  if (tokens.length === 0) return 0
  const hay = `${skill.name} ${skill.description ?? ""}`.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (skill.name.toLowerCase() === t) score += 5
    else if (skill.name.toLowerCase().includes(t)) score += 3
    else if (hay.includes(t)) score += 1
  }
  return score
}

/**
 * Order + cap the visible skill list for system prompt injection.
 */
export function applySkillListCap<T extends { name: string; description?: string; location: string }>(
  visible: readonly T[],
  policy: ResolvedSkillListConfig,
  order: SkillListOrderInput = {},
): SkillListApplyResult<T> {
  const total = visible.length
  const byName = new Map(visible.map((s) => [s.name, s] as const))
  let ordered: T[] = []
  let mode: SkillListMode = "passthrough"

  // Explicit ranked array (including empty) is the semantic path — never fall through
  // to full catalog when the gate returned a (possibly empty) rank list.
  if (order.ranked !== undefined) {
    mode = "ranked"
    for (const id of order.ranked) {
      const item = byName.get(id)
      if (item) ordered.push(item)
    }
    // Fill remainder only when hardCap is off (tool can still discover more names).
    if (!policy.hardCap) {
      const seen = new Set(ordered.map((s) => s.name))
      for (const item of visible) {
        if (!seen.has(item.name)) ordered.push(item)
      }
    }
  } else if (order.metaByName && (order.cwdFiles?.length || order.prompt)) {
    const catalog = visible
      .map((s) => order.metaByName!.get(s.name))
      .filter((m): m is SkillMeta => m !== undefined)
    const matched = matchSkills(order.cwdFiles ?? [], order.prompt, catalog)
    if (matched.length > 0) {
      mode = "matched"
      const seen = new Set<string>()
      for (const m of matched) {
        const item = byName.get(m.bodySource) ?? byName.get(m.name)
        if (item && !seen.has(item.name)) {
          seen.add(item.name)
          ordered.push(item)
        }
      }
      // Fill with lexical for remaining slots under cap
      const rest = visible
        .filter((s) => !seen.has(s.name))
        .map((s) => ({ s, score: lexicalScore(s, order.prompt ?? "") }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
      for (const { s } of rest) {
        if (ordered.length >= policy.maxListed) break
        ordered.push(s)
      }
    }
  }

  if (ordered.length === 0 && order.prompt?.trim()) {
    mode = "lexical"
    ordered = [...visible]
      .map((s) => ({ s, score: lexicalScore(s, order.prompt!) }))
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .map((x) => x.s)
  }

  if (ordered.length === 0) {
    mode = "passthrough"
    ordered = [...visible]
  }

  const shouldCap = policy.hardCap || mode === "ranked" || mode === "matched" || mode === "lexical"
  const list = shouldCap ? ordered.slice(0, policy.maxListed) : ordered

  return {
    list,
    mode,
    total,
    listed: list.length,
    format: policy.format,
    capped: list.length < total,
  }
}

export function formatSkillListStatus(result: {
  mode: SkillListMode
  total: number
  listed: number
  format: SkillListFormat
  capped: boolean
}): string {
  const cap = result.capped ? ` capped ${result.total}→${result.listed}` : ` listed ${result.listed}`
  return `[skill_list: mode=${result.mode}${cap} format=${result.format}]`
}

/** Render Tier-1 skill list at the configured density. Preserves input order (rank order). */
export function formatSkillListBlock<T extends { name: string; description?: string; location: string }>(
  list: readonly T[],
  format: SkillListFormat,
): string {
  if (list.length === 0) return "No skills are currently available."

  if (format === "names") {
    return [
      "<available_skills>",
      ...list.flatMap((skill) => ["  <skill>", `    <name>${skill.name}</name>`, "  </skill>"]),
      "</available_skills>",
    ].join("\n")
  }

  if (format === "compact") {
    return [
      "<available_skills>",
      ...list.flatMap((skill) => {
        const desc = (skill.description ?? "").replace(/\s+/g, " ").trim()
        const short = desc.length > 120 ? desc.slice(0, 117) + "…" : desc
        return [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          ...(short ? [`    <description>${short}</description>`] : []),
          "  </skill>",
        ]
      }),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "<available_skills>",
    ...list.flatMap((skill) => [
      "  <skill>",
      `    <name>${skill.name}</name>`,
      ...(skill.description !== undefined ? [`    <description>${skill.description}</description>`] : []),
      `    <location>${escapeHtml(skill.location)}</location>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n")
}
