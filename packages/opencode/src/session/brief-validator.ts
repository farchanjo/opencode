/**
 * Feature 053 / T014 — FR6 brief validation + repair.
 *
 * Pure module: no Effect runtime, no I/O, deterministic. Sits beside
 * `session/routing-state.ts` rather than `routing/application/` (the path
 * `plan.md`'s component table names) because this slice was implemented
 * concurrently with `tool/task.ts`/`routing-*`/schema work on the same
 * feature branch; the module boundary and exported contract are unchanged.
 *
 * The Composer emits a brief as free text with one specialist assignment per
 * subtask. This module recognizes a light structured convention —
 *
 *   - [subtask text] → specialist: <name>
 *
 * — and tolerates a looser `specialist: <name>` fallback anywhere on a line,
 * since the Composer's specialist name is itself untrusted LLM output and may
 * not always land in the structured form. Every cited name is checked against
 * the FULL live registry via `resolveSpecialist` (never the narrowed ranked
 * catalog, which is repair-candidate input only, per FR6): a hit is left
 * untouched; a miss is repaired to the single unambiguous valid candidate
 * (ranked order first, then case/hyphen-normalized fuzzy matching) when one
 * exists, else the subtask is flagged inline — a subtask is never silently
 * dropped from the brief.
 */
export * as BriefValidator from "./brief-validator"

// =============================================================================
// Contract
// =============================================================================

export interface SpecialistRef {
  readonly name: string
  readonly description?: string
}

export interface BriefValidatorDeps {
  readonly resolveSpecialist: (id: string) => SpecialistRef | undefined
  readonly listSpecialists: () => readonly SpecialistRef[]
  readonly ranked?: readonly string[]
}

export interface BriefRepair {
  readonly from: string
  readonly to: string
}

export interface BriefValidationResult {
  readonly brief: string
  readonly repairs: readonly BriefRepair[]
  readonly flagged: readonly string[]
}

const UNASSIGNED_ANNOTATION = " [unassigned — route explicitly]"

/**
 * Validates and, where unambiguous, repairs every specialist mention in a
 * Composer-emitted brief against the full live registry. Deterministic and
 * side-effect-free: the same `(brief, deps)` pair always yields the same
 * result.
 */
export function validateBrief(brief: string, deps: BriefValidatorDeps): BriefValidationResult {
  const repairs: BriefRepair[] = []
  const flagged: string[] = []
  const lines = brief.split("\n").map((line) => processLine(line, deps, repairs, flagged))
  return { brief: lines.join("\n"), repairs, flagged }
}

// =============================================================================
// Line-level assignment parsing + rewrite
// =============================================================================

interface ParsedAssignment {
  readonly name: string
  readonly subtask: string
  readonly start: number
  readonly end: number
}

// A specialist name is a kebab/snake-case identifier token; capturing just the
// token (not the rest of the line) keeps the fallback convention tolerant of
// surrounding free text ("... specialist: golang-pro for the fix.").
const STRUCTURED_LINE = /^\s*-\s*\[(?<subtask>[^\]]*)]\s*(?:→|->)\s*specialist:\s*(?<name>[A-Za-z0-9][\w-]*)/d
const FALLBACK_LINE = /\bspecialist:\s*(?<name>[A-Za-z0-9][\w-]*)/id

function parseAssignmentLine(line: string): ParsedAssignment | undefined {
  const structured = STRUCTURED_LINE.exec(line)
  const structuredSpan = structured?.indices?.groups?.name
  if (structured?.groups && structuredSpan) {
    return { name: structured.groups.name, subtask: structured.groups.subtask ?? "", start: structuredSpan[0], end: structuredSpan[1] }
  }
  const fallback = FALLBACK_LINE.exec(line)
  const fallbackSpan = fallback?.indices?.groups?.name
  if (fallback?.groups && fallbackSpan) {
    return { name: fallback.groups.name, subtask: line.trim(), start: fallbackSpan[0], end: fallbackSpan[1] }
  }
  return undefined
}

function processLine(line: string, deps: BriefValidatorDeps, repairs: BriefRepair[], flagged: string[]): string {
  const parsed = parseAssignmentLine(line)
  if (!parsed) return line
  if (deps.resolveSpecialist(parsed.name)) return line

  const candidate = findRepairCandidate(parsed.name, deps)
  if (candidate) {
    repairs.push({ from: parsed.name, to: candidate })
    return line.slice(0, parsed.start) + candidate + line.slice(parsed.end)
  }

  flagged.push(parsed.subtask.length > 0 ? parsed.subtask : parsed.name)
  return `${line}${UNASSIGNED_ANNOTATION}`
}

// =============================================================================
// Repair candidate search — ranked order first, then registry-wide fuzzy match
// =============================================================================

function findRepairCandidate(name: string, deps: BriefValidatorDeps): string | undefined {
  const normalizedName = normalizeSpecialistName(name)
  const rankedCandidate = findRankedCandidate(normalizedName, deps)
  if (rankedCandidate) return rankedCandidate
  return findFuzzyCandidate(normalizedName, deps.listSpecialists())
}

/** Best-tier ranked match, requiring a SINGLE distinct resolvable candidate — mirrors
 * `findFuzzyCandidate`'s ambiguity handling: two distinct ranked names fuzzy-matching at
 * the same best tier are never silently resolved by ranked order, they're left undefined
 * so the caller falls through to the full-registry search (and, if still ambiguous there,
 * flags the subtask instead of picking a first-wins guess). */
function findRankedCandidate(normalizedName: string, deps: BriefValidatorDeps): string | undefined {
  if (!deps.ranked) return undefined
  let bestTier = Number.POSITIVE_INFINITY
  let bestNames: string[] = []
  for (const candidate of deps.ranked) {
    if (!deps.resolveSpecialist(candidate)) continue
    const tier = fuzzyTier(normalizedName, normalizeSpecialistName(candidate))
    if (tier < 0) continue
    if (tier < bestTier) {
      bestTier = tier
      bestNames = [candidate]
    } else if (tier === bestTier && !bestNames.includes(candidate)) {
      bestNames.push(candidate)
    }
  }
  return bestNames.length === 1 ? bestNames[0] : undefined
}

function findFuzzyCandidate(normalizedName: string, specialists: readonly SpecialistRef[]): string | undefined {
  let bestTier = Number.POSITIVE_INFINITY
  let bestNames: string[] = []
  for (const specialist of specialists) {
    const tier = fuzzyTier(normalizedName, normalizeSpecialistName(specialist.name))
    if (tier < 0) continue
    if (tier < bestTier) {
      bestTier = tier
      bestNames = [specialist.name]
    } else if (tier === bestTier) {
      bestNames.push(specialist.name)
    }
  }
  return bestNames.length === 1 ? bestNames[0] : undefined
}

/**
 * Match tiers, best first: 0 = exact after normalization, 1 = one name is a
 * prefix of the other (length >= 3 each, guards against short-name noise),
 * 2 = a small Levenshtein-lite edit distance. -1 = no match.
 */
function fuzzyTier(a: string, b: string): number {
  if (a === b) return 0
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 1
  const distance = levenshteinLite(a, b)
  const threshold = Math.max(1, Math.floor(Math.min(a.length, b.length) / 3))
  return distance <= threshold ? 2 : -1
}

function normalizeSpecialistName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

function levenshteinLite(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dist: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array.from({ length: cols - 1 }, () => 0)])
  for (let j = 1; j < cols; j++) dist[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost)
    }
  }
  return dist[rows - 1][cols - 1]
}
