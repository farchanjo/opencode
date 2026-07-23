/**
 * Feature 058 — pure deterministic skill match (fapp skill-prime domain parity).
 * No I/O: cwd file list + optional prompt + SkillMeta catalog → ranked refs.
 */
import { minimatch } from "minimatch"

export const MAX_MATCHED_SKILLS = 7
export const RESERVED_TRIGGER_SLOTS = 2

export type SkillMatchReason = "path" | "trigger" | "variant"

export interface SkillMeta {
  name: string
  paths: string[]
  triggers: string[]
  variants: string[]
  userInvocable: boolean
}

export interface MatchedSkillRef {
  name: string
  reason: SkillMatchReason
  /** Body source name (variant name when hub resolved, else skill name). */
  bodySource: string
  hub: string | null
}

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/")
}

function pathHits(file: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false
  const normalized = normalizePath(file)
  return globs.some((pattern) => minimatch(normalized, pattern, { dot: true }))
}

/** Case-insensitive whole-word (or multi-word phrase) trigger match. */
export function triggerHits(prompt: string, triggers: readonly string[]): boolean {
  if (triggers.length === 0 || prompt.length === 0) return false
  const hay = prompt.toLowerCase()
  return triggers.some((raw) => {
    const needle = raw.trim().toLowerCase()
    if (!needle) return false
    // Escape regex specials; treat whitespace in trigger as flexible whitespace.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    const re = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, "i")
    return re.test(hay)
  })
}

function scoreSkill(meta: SkillMeta, cwdFiles: readonly string[], prompt: string | undefined): number {
  let score = 0
  for (const file of cwdFiles) {
    if (pathHits(file, meta.paths)) score += 1
  }
  if (prompt !== undefined && triggerHits(prompt, meta.triggers)) score += 1
  return score
}

function resolveVariant(
  hub: SkillMeta,
  lookup: Map<string, SkillMeta>,
  cwdFiles: readonly string[],
  prompt: string | undefined,
): string | null {
  if (hub.variants.length === 0) return null
  let best: string | null = null
  let bestScore = 0
  for (const name of hub.variants) {
    const variant = lookup.get(name)
    if (!variant) continue
    const s = scoreSkill(variant, cwdFiles, prompt)
    if (s > bestScore) {
      bestScore = s
      best = name
    }
  }
  return bestScore > 0 ? best : null
}

/**
 * Pure match: path-glob OR whole-word trigger. Cap at MAX_MATCHED_SKILLS.
 * Path matches lead; up to RESERVED_TRIGGER_SLOTS reserved for trigger-only.
 * Non-invocable skills only appear as hub variants.
 */
export function matchSkills(
  cwdFiles: readonly string[],
  prompt: string | undefined,
  catalog: readonly SkillMeta[],
): MatchedSkillRef[] {
  const lookup = new Map(catalog.map((s) => [s.name, s] as const))
  const pathMatched: MatchedSkillRef[] = []
  const triggerOnly: MatchedSkillRef[] = []
  const seen = new Set<string>()

  for (const meta of catalog) {
    if (!meta.userInvocable) continue
    if (seen.has(meta.name)) continue

    let byPath = false
    for (const file of cwdFiles) {
      if (pathHits(file, meta.paths)) {
        byPath = true
        break
      }
    }
    const byTrigger = prompt !== undefined && triggerHits(prompt, meta.triggers)
    if (!byPath && !byTrigger) continue

    seen.add(meta.name)
    const winning = resolveVariant(meta, lookup, cwdFiles, prompt)
    const ref: MatchedSkillRef = {
      name: meta.name,
      reason: byPath ? "path" : "trigger",
      bodySource: winning ?? meta.name,
      hub: winning ? meta.name : null,
    }
    if (winning) ref.reason = byPath || byTrigger ? (byPath ? "path" : "trigger") : "variant"
    // When a variant wins, surface reason as variant if only variant scored? Spec:
    // body source is variant; keep path/trigger as how hub matched.
    if (byPath) pathMatched.push(ref)
    else triggerOnly.push(ref)
  }

  // Also: if hub didn't match but a variant would — only via hub top-level.
  // (fapp: non-invocable variants never top-level; hub must match first.)

  const reserved = Math.min(triggerOnly.length, RESERVED_TRIGGER_SLOTS)
  const pathSlots = Math.min(pathMatched.length, MAX_MATCHED_SKILLS - reserved)
  const result = pathMatched.slice(0, pathSlots)
  const remaining = MAX_MATCHED_SKILLS - result.length
  result.push(...triggerOnly.slice(0, remaining))
  return result
}
