/**
 * Feature 006 / T022 (S13) — the agent/skill/chunk projection engine.
 *
 * Framework-free, deterministic, zero I/O. Projects `AgentDoc`/`SkillDoc`/
 * `SkillChunkDoc` from live core (FR10, FR11, C6, C9): a content hash drives
 * incremental upsert vs tombstone (`decideMutation`), the sanitized-field
 * allowlist strips secrets/prompts/reasoning/paths (`isForbiddenField`,
 * `sanitizeFields`, `scrubText`), and descriptions/domains/triggers are RANKING
 * signals only — never an authority field — so a malicious description can never
 * alter router policy or a hard gate (FR17, FR23, FR36, C4, C9, AC10, AC11).
 *
 * Skill bodies are indexed summary-first; a full body is chunked into bounded
 * token windows with a fixed overlap (`chunkBody`), each window carrying
 * `parent_skill_id`/`chunk_id` and reached only through a Feature 005 OutputRef
 * (never stored inline, never a path) (FR39, FR40, C9). The projection is a
 * derived, rebuildable view — AgentV2/SkillV2/Permission stay the sources of
 * truth (FR1, FR2, C21).
 */
export * as Projection from "./projection"

/** The incremental index mutation implied by a content-hash comparison (FR13, AC10). */
export type MutationKind = "upsert" | "tombstone" | "unchanged"

/**
 * Decide the index mutation from the previous and current content hashes. A live
 * entity removed since the last projection (`current === null`) tombstones; a new
 * or changed hash upserts; an unchanged hash is a no-op (FR13, AC10). Pure.
 */
export const decideMutation = (previous: string | null, current: string | null): MutationKind => {
  if (current === null) return previous === null ? "unchanged" : "tombstone"
  if (previous === null || previous !== current) return "upsert"
  return "unchanged"
}

/**
 * Field-name base pattern for content that MUST never enter the index — raw
 * secrets, prompts, reasoning traces, inline bodies, and filesystem paths (FR17,
 * C4, C9). An opaque handle suffixed `_ref` (a SecretRef/OutputRef) or a
 * `_hash` digest is NOT forbidden — it carries no raw material.
 */
const FORBIDDEN_BASE = /(^|_)(secret|password|credential|apikey|api_key|prompt|reasoning|body|content|path|file|cwd|dir)($|_)/i

/** Whether a field name carries forbidden raw content (secret/prompt/reasoning/path). */
export const isForbiddenField = (name: string): boolean =>
  FORBIDDEN_BASE.test(name) && !/(_ref|_hash)$/i.test(name)

/**
 * Strip every forbidden-content field from a projected record, keeping only the
 * sanitized allowlist. Refs (`*_ref`) and digests (`*_hash`) are retained (FR17,
 * C4, C9). Pure; never mutates the input.
 */
export const sanitizeFields = (fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  Object.freeze(Object.fromEntries(Object.entries(fields).filter(([name]) => !isForbiddenField(name))))

/**
 * Scrub path- and secret-shaped substrings out of a free-text ranking field so a
 * description/trigger never smuggles a filesystem path or a credential into the
 * index (FR17, C4). Best-effort and pure; leaves ordinary prose intact.
 */
export const scrubText = (text: string): string =>
  text
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}\/?/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .replace(/\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}\b/g, "[redacted]")

/** The ranking-signal fields — used for relevance only, never authority (FR23, FR36, AC11). */
export const RANKING_SIGNAL_FIELDS = ["description", "domains", "triggers", "capabilities", "name"] as const

/** The authority fields — sourced strictly from live core, never from a document claim (FR34, AC11). */
export const AUTHORITY_FIELDS = ["permission_ref", "enabled", "available", "scope", "visibility"] as const

const rankingSet = new Set<string>(RANKING_SIGNAL_FIELDS)
const authoritySet = new Set<string>(AUTHORITY_FIELDS)

/** Whether a field is a ranking signal only (never a routing/gate authority). */
export const isRankingSignal = (field: string): boolean => rankingSet.has(field)

/** Whether a field is an authority field (sourced from live core, not a doc claim). */
export const isAuthorityField = (field: string): boolean => authoritySet.has(field)

/** A live-core source row for a projection; authority fields come from core, never the doc text. */
export interface LiveSource {
  readonly content_hash: string
  /** Ranking signal — may be attacker-controlled; sanitized, never trusted as authority. */
  readonly description: string
  /** Authority — the live PermissionV2 ref (FR34, AC11). */
  readonly permission_ref: string
  readonly enabled: boolean
  readonly available: boolean
}

/** A projected document split into sanitized ranking signals and live-core authority. */
export interface Projected {
  readonly ranking: { readonly description: string }
  readonly authority: {
    readonly permission_ref: string
    readonly enabled: boolean
    readonly available: boolean
  }
}

/**
 * Project a live source into a document. Ranking text is scrubbed and carried for
 * relevance only; the authority block is copied strictly from live core, so a
 * malicious description can never elevate the projected permission (FR23, FR34,
 * FR36, AC11). Pure.
 */
export const project = (source: LiveSource): Projected =>
  Object.freeze({
    ranking: Object.freeze({ description: scrubText(source.description) }),
    authority: Object.freeze({
      permission_ref: source.permission_ref,
      enabled: source.enabled,
      available: source.available,
    }),
  })

/** One bounded chunk window over a skill body, reached later via a Feature 005 ref (FR40, C9). */
export interface ChunkWindow {
  readonly chunk_index: number
  readonly start_token: number
  readonly token_length: number
  readonly overlap: number
}

/**
 * Compute the bounded, fixed-overlap chunk windows over a skill body of
 * `totalTokens`. Each window advances by `chunkSize - overlap`; windows never
 * exceed `totalTokens` and carry a zero-based `chunk_index` for the `chunk_id`
 * (FR11, C9, AC12). Pure; a non-positive size or an overlap ≥ size yields no
 * windows rather than looping.
 */
export const chunkBody = (totalTokens: number, chunkSize: number, overlap: number): readonly ChunkWindow[] => {
  if (chunkSize <= 0 || overlap < 0 || overlap >= chunkSize || totalTokens <= 0) return Object.freeze([])
  const stride = chunkSize - overlap
  const windows: ChunkWindow[] = []
  for (let start = 0, index = 0; start < totalTokens; start += stride, index += 1) {
    windows.push(Object.freeze({
      chunk_index: index,
      start_token: start,
      token_length: Math.min(chunkSize, totalTokens - start),
      overlap,
    }))
  }
  return Object.freeze(windows)
}
