/**
 * Feature 051 / Phase 2 (FR1–FR8) — the live per-turn narrowing orchestrator.
 *
 * `narrowForTurn` computes the turn's `NarrowedSets` (agents/skills/tools ranked-id
 * lists) exactly once per user turn and memoizes it in the injected session-scoped
 * store, keyed by `lastUser.id`. It owns ONLY IO orchestration — the gates-off
 * short-circuit, the degenerate-input guard, the concurrent fail-open fan-out over the
 * Feature 050 retrieval facade under the shared latency budget, the degenerate→passthrough
 * normalization, the essential-tool floor for the tools surface, and the memo write. The
 * actual filtering stays in `tool-retrieval.ts`'s pure gate; the capability floors here are
 * a union, never a bespoke intersection.
 *
 * The query plane fails OPEN (the deliberate opposite of Feature 050's fail-closed index
 * plane): any surface's failure/timeout/empty/revalidation-emptied result resolves that
 * surface to passthrough (`undefined`) with exactly one content-free warning per turn, and
 * ZERO retries — `narrowForTurn` NEVER throws (FR7).
 */
export * as LiveNarrowing from "./live-narrowing"

import { Duration, Effect } from "effect"
import type { RetrievalPort, SkillChunkRetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"
import type {
  RetrievalFilters,
  RetrievalRequest,
  SkillChunkRetrievalRequest,
  SkillRetrievalRequest,
  TaskProfile,
  ToolRetrievalRequest,
} from "@opencode-ai/protocol/semantic/commands"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import type { SessionID } from "@/session/schema"
import type { AutoSkillChunkRef, NarrowedSets, NarrowedSetsMemo, RoutingSessionStateStore } from "@/session/routing-state"
export type { NarrowedSets } from "@/session/routing-state"

// =============================================================================
// Essential-tool floor (FR4-tools) — the CLOSED always-keep list
// =============================================================================

/**
 * The CLOSED essential-tool floor (spec FR4, CUE `#EssentialToolFloor`): the tool ids
 * always kept in a narrowed tool set regardless of ranking. Verified against the live
 * registry builtin ids (`tool/registry.ts`): `bash` (shell), `todowrite`, `question`,
 * `read`, `edit`, `write`, `task`, `skill`, `glob`, `grep`. `StructuredOutput` needs no
 * entry — it is appended AFTER narrowing (`prompt.ts:1517`) and never enters the gate.
 */
export const ESSENTIAL_TOOL_FLOOR: readonly string[] = Object.freeze([
  "task",
  "skill",
  "todowrite",
  "question",
  "read",
  "edit",
  "write",
  "bash",
  "grep",
  "glob",
])

/**
 * Union the essential-tool floor into a ranked tools list: ranked order first, then any
 * missing floor id appended, with no duplicates. The reranker may reorder the floor
 * relative to the rest, but a floor id is never dropped (FR4-tools). Pure.
 */
export const mergeFloor = (ranked: readonly string[]): readonly string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...ranked, ...ESSENTIAL_TOOL_FLOOR]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// =============================================================================
// Orchestration-child detector (FR5)
// =============================================================================

interface PermissionRule {
  readonly permission: string
  readonly pattern: string
  /** The live `PermissionV1.Ruleset` action domain is `deny | allow | ask`; the detector only
   * matches `deny`/`allow`, so `ask` (or any other value) simply fails the structural test. */
  readonly action: string
}

/**
 * FR5 — pure structural test for the fail-closed orchestration-child ruleset
 * `orchestrationChildToolRules()` produces (`tool/task.ts:74-83`): a leading catch-all
 * deny (`*`/`*`/deny) followed exclusively by per-id `*`-pattern allow rules. A caller
 * passes the result as `NarrowForTurnInput.isOrchestrationChild`; keeping the test here
 * (not an import of the tool graph) leaves the semantic module dependency-free.
 */
export const isOrchestrationChildRuleset = (rules: ReadonlyArray<PermissionRule>): boolean => {
  const [head, ...rest] = rules
  if (!head || head.permission !== "*" || head.pattern !== "*" || head.action !== "deny") return false
  return rest.every((rule) => rule.action === "allow" && rule.pattern === "*")
}

// =============================================================================
// Orchestrator surface + deps
// =============================================================================

export type NarrowingSurfaceName = "agents" | "skills" | "tools"

/** The resolved gate config `narrowForTurn` consumes: the two live-narrowing surface gates
 * (`agents`/`skills`), the tools gate (resolved by the caller from the Feature 009
 * `tool_search` surface gate), and the shared per-turn knobs. */
export interface NarrowingGates {
  readonly agents: boolean
  readonly skills: boolean
  readonly tools: boolean
  readonly minPromptLength: number
  readonly latencyBudgetMs: number
  readonly debugLog: boolean
}

/** Minimal read/write view of the session-scoped memo, adapted by the caller from
 * `RoutingSessionStateStore` (`get().narrowedSets` / `recordNarrowedSets`). */
export interface NarrowingStateAccessors {
  readonly readMemo: (sessionID: SessionID) => NarrowedSetsMemo | null
  readonly writeMemo: (sessionID: SessionID, key: string, sets: NarrowedSets) => void
}

/**
 * Bridge the shared `RoutingSessionStateStore` (`routing-state.ts`) into the memo view
 * `narrowForTurn` consumes — the ONE adapter the per-turn call site (`session/prompt.ts`)
 * threads, so the memo read/write path is defined once and unit-testable in isolation (FR1).
 */
export const narrowingAccessors = (store: RoutingSessionStateStore): NarrowingStateAccessors => ({
  readMemo: (sessionID) => store.get(sessionID).narrowedSets,
  writeMemo: (sessionID, key, sets) => {
    store.recordNarrowedSets(sessionID, key, sets)
  },
})

/**
 * Feature 052 (FR1, FR2, FR4) — the resolved `skill_autoprime` config the fourth surface
 * consumes. `enabled` is the COMPOSED gate (`skill_autoprime.enabled &&
 * semantic_narrowing.skills.enabled`) the caller resolves; `scoreFloor` is the FR2 confidence
 * floor consulted here; `maxChunks`/`maxTokens` are the FR4 render budgets threaded through to
 * `SystemPrompt.autoSkills` unchanged (never spent by this pass). A minimal structural type so
 * the concurrent config resolver plugs in without this module importing it.
 */
export interface AutoSkillNarrowConfig {
  readonly enabled: boolean
  readonly scoreFloor: number
  readonly maxChunks: number
  readonly maxTokens: number
}

/**
 * Feature 052 (FR5, FR6) — the parent-skill metadata one chunk id resolves to, supplied by an
 * injected resolver (the concurrent provenance surface plugs in here). `undefined` from the
 * resolver means the parent skill no longer resolves live OR its provenance is unknown — the
 * chunk is dropped (revalidation, fail-safe: no injection). `skillName` is the FR6 dedup key.
 */
export interface AutoSkillChunkMeta {
  readonly skillName: string
  readonly source: "local" | "remote-pack"
  readonly autoprimeOptIn: boolean
}

export interface NarrowForTurnDeps {
  readonly gates: NarrowingGates
  readonly retrieval: RetrievalPort & ToolRetrievalPort & Partial<SkillChunkRetrievalPort>
  readonly state: NarrowingStateAccessors
  readonly warn: (message: string) => void
  readonly debugLog?: (surface: NarrowingSurfaceName, kept: readonly string[], dropped: readonly string[]) => void
  /** Project scope for the retrieval requests; defaults to the empty project when absent. */
  readonly projectId?: string
  /** Feature 052 (FR1) — the composed `skill_autoprime` config; absent/disabled skips the
   * fourth pass entirely (no retrieval call, no `chunks` memo field). */
  readonly autoSkill?: AutoSkillNarrowConfig
  /** Feature 052 (FR5, FR6) — resolve one chunk id to its parent skill's provenance + name;
   * absent (or an unresolved id) drops the chunk before the confidence floor is consulted. */
  readonly resolveChunkMeta?: (chunkId: string) => AutoSkillChunkMeta | undefined
}

export interface NarrowForTurnInput {
  readonly sessionID: SessionID
  readonly promptText: string
  readonly lastUserID: string
  readonly agent: string
  readonly isOrchestrationChild: boolean
}

// =============================================================================
// Per-surface fail-open runner
// =============================================================================

interface RankedCandidateLike {
  readonly canonicalId: string
  readonly revalidated: boolean
}

interface SurfaceOutcome {
  /** The non-empty ranked ids, or `undefined` for passthrough (empty/degenerate/degraded). */
  readonly ranked?: readonly string[]
  readonly dropped: readonly string[]
  readonly degraded: boolean
}

const PASSTHROUGH_OUTCOME: SurfaceOutcome = { dropped: [], degraded: false }

/** Keep only revalidated candidates, deduped, in rank order (FR3 — degenerate → passthrough). */
const revalidatedIds = (candidates: readonly RankedCandidateLike[]): readonly string[] => {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const candidate of candidates) {
    if (!candidate.revalidated || seen.has(candidate.canonicalId)) continue
    seen.add(candidate.canonicalId)
    ids.push(candidate.canonicalId)
  }
  return ids
}

/**
 * Run one surface's retrieval under the shared deadline, fail-open. A rejection or timeout
 * resolves to a degraded passthrough; a zero-hit / revalidation-emptied / dedup-emptied
 * result resolves to a (non-degraded) passthrough (FR3, FR7). No retries.
 */
const runSurface = async (
  retrieve: () => Effect.Effect<{ readonly candidates: readonly RankedCandidateLike[] }, unknown>,
  budgetMs: number,
): Promise<SurfaceOutcome> => {
  try {
    const result = await Effect.runPromise(retrieve().pipe(Effect.timeout(Duration.millis(budgetMs))))
    const ranked = revalidatedIds(result.candidates)
    const kept = new Set(ranked)
    const dropped = result.candidates.map((candidate) => candidate.canonicalId).filter((id) => !kept.has(id))
    return { ranked: ranked.length > 0 ? ranked : undefined, dropped, degraded: false }
  } catch {
    return { dropped: [], degraded: true }
  }
}

// =============================================================================
// Fourth surface (FR1, FR2, FR5) — skill_chunks
// =============================================================================

/** The minimal chunk-candidate shape the fourth surface reads off `RetrievalResult` (FR1). */
interface ChunkCandidateLike {
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly chunkRef?: string
  readonly score: { readonly confidence: number }
}

interface ChunkSurfaceOutcome {
  readonly chunks?: readonly AutoSkillChunkRef[]
  readonly degraded: boolean
}

const CHUNK_PASSTHROUGH: ChunkSurfaceOutcome = { degraded: false }

/** Derive a chunk's parent skill id by stripping the `_c<n>` suffix the chunker mints (`skill-chunk.ts:77`). */
const parentSkillIdOf = (chunkId: string): string => chunkId.replace(/_c\d+$/, "")

/**
 * Provenance-filter (FR5), confidence-floor (FR2), and dedup a chunk candidate set into ranked
 * `AutoSkillChunkRef`s. A candidate is dropped when: its parent skill no longer resolves
 * (`resolveMeta` → undefined, revalidation); its provenance is not auto-prime-eligible
 * (`local`, or `remote-pack` with explicit opt-in); or its confidence is below the floor. Pure.
 */
const toChunkRefs = (
  candidates: readonly ChunkCandidateLike[],
  autoSkill: AutoSkillNarrowConfig,
  resolveMeta: ((chunkId: string) => AutoSkillChunkMeta | undefined) | undefined,
): readonly AutoSkillChunkRef[] => {
  const out: AutoSkillChunkRef[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.canonicalId)) continue
    const meta = resolveMeta?.(parentSkillIdOf(candidate.canonicalId))
    if (!meta) continue
    if (!(meta.source === "local" || (meta.source === "remote-pack" && meta.autoprimeOptIn))) continue
    if (candidate.score.confidence < autoSkill.scoreFloor) continue
    seen.add(candidate.canonicalId)
    out.push({
      chunkId: candidate.canonicalId,
      skillName: meta.skillName,
      score: candidate.score.confidence,
      bodyRef: { outputRef: candidate.chunkRef ?? candidate.canonicalVersion, offset: 0, limit: 0 },
    })
  }
  return out
}

/**
 * Run the fourth (skill_chunks) surface under the SAME shared deadline, fail-open. A rejection
 * or timeout resolves to a degraded passthrough; a zero-hit / below-floor / provenance-excluded
 * / revalidation-emptied result resolves to a (non-degraded) passthrough (FR2, FR7). No retries.
 */
const runChunkSurface = async (
  retrieve: () => Effect.Effect<{ readonly candidates: readonly ChunkCandidateLike[] }, unknown>,
  budgetMs: number,
  autoSkill: AutoSkillNarrowConfig,
  resolveMeta: ((chunkId: string) => AutoSkillChunkMeta | undefined) | undefined,
): Promise<ChunkSurfaceOutcome> => {
  try {
    const result = await Effect.runPromise(retrieve().pipe(Effect.timeout(Duration.millis(budgetMs))))
    const refs = toChunkRefs(result.candidates, autoSkill, resolveMeta)
    return { chunks: refs.length > 0 ? refs : undefined, degraded: false }
  } catch {
    return { degraded: true }
  }
}

// =============================================================================
// Request assembly
// =============================================================================

interface SurfaceRequests {
  readonly agents: RetrievalRequest
  readonly skills: SkillRetrievalRequest
  readonly tools: ToolRetrievalRequest
  readonly chunks: SkillChunkRetrievalRequest
}

/** Build the three surface requests from ONE per-turn `TaskProfile` (single embed, FR1). */
const buildRequests = (deps: NarrowForTurnDeps, input: NarrowForTurnInput): SurfaceRequests => {
  const projectId = deps.projectId ?? ""
  const profile: TaskProfile = { taskId: input.lastUserID, queryText: input.promptText, projectId }
  const filters: RetrievalFilters = { projectId }
  const base: RetrievalRequest = {
    profile,
    retrievalTopK: ConfigExperimental.TOOL_SEARCH_DEFAULTS.retrievalTopK,
    rerankTopK: ConfigExperimental.TOOL_SEARCH_DEFAULTS.rerankTopK,
    filters,
  }
  return {
    agents: base,
    skills: { ...base, selectedAgentCanonicalId: input.agent, maxSkillChunks: 0 },
    tools: { ...base, collection: "tools" },
    chunks: { ...base, collection: "skill_chunks" },
  }
}

// =============================================================================
// Result assembly + debug
// =============================================================================

/** Assemble the memo: absent surface = passthrough; tools gets the essential-tool floor merged (FR4). */
const assembleSets = (
  agents: SurfaceOutcome,
  skills: SurfaceOutcome,
  tools: SurfaceOutcome,
  chunk: ChunkSurfaceOutcome,
): NarrowedSets => {
  const sets: {
    agents?: readonly string[]
    skills?: readonly string[]
    tools?: readonly string[]
    chunks?: readonly AutoSkillChunkRef[]
  } = {}
  if (agents.ranked) sets.agents = agents.ranked
  if (skills.ranked) sets.skills = skills.ranked
  if (tools.ranked) sets.tools = mergeFloor(tools.ranked)
  if (chunk.chunks) sets.chunks = chunk.chunks
  return sets
}

/** Opt-in, content-free debug log of kept/dropped canonical ids per surface (FR8). */
const emitDebug = (
  deps: NarrowForTurnDeps,
  outcomes: Record<NarrowingSurfaceName, SurfaceOutcome>,
): void => {
  if (!deps.gates.debugLog || !deps.debugLog) return
  for (const surface of ["agents", "skills", "tools"] as const) {
    deps.debugLog(surface, outcomes[surface].ranked ?? [], outcomes[surface].dropped)
  }
}

// =============================================================================
// Orchestrator
// =============================================================================

/**
 * Compute the turn's `NarrowedSets` once and memoize it keyed by `lastUser.id`. Gates-off
 * short-circuits before any I/O (FR6); a memo hit for the same turn is returned verbatim
 * (FR1); a below-threshold prompt reuses any prior memo or passes through without embedding
 * (FR2). Otherwise the enabled surfaces run concurrently, fail-open, under the shared
 * deadline (FR1, FR3, FR7). Never throws.
 */
export const narrowForTurn = async (deps: NarrowForTurnDeps, input: NarrowForTurnInput): Promise<NarrowedSets> => {
  const { gates } = deps
  const toolsEnabled = gates.tools && !input.isOrchestrationChild
  if (!gates.agents && !gates.skills && !toolsEnabled) return {}

  const memo = deps.state.readMemo(input.sessionID)
  if (memo && memo.key === input.lastUserID) return memo.sets
  if (input.promptText.length < gates.minPromptLength) return memo ? memo.sets : {}

  // Feature 052 (FR1) — the fourth surface's composed gate: `skill_autoprime.enabled` (the
  // resolved `deps.autoSkill.enabled`) AND the existing Feature 051 skills gate must both be on,
  // and the facade must expose the chunk pass. Either gate off skips the pass entirely — no
  // retrieval call, no `chunks` memo field.
  const chunksEnabled = !!deps.autoSkill?.enabled && gates.skills && typeof deps.retrieval.retrieveSkillChunks === "function"

  const requests = buildRequests(deps, input)
  const budget = gates.latencyBudgetMs
  const [agents, skills, tools, chunk] = await Promise.all([
    gates.agents ? runSurface(() => deps.retrieval.retrieveAgents(requests.agents), budget) : Promise.resolve(PASSTHROUGH_OUTCOME),
    gates.skills ? runSurface(() => deps.retrieval.retrieveSkills(requests.skills), budget) : Promise.resolve(PASSTHROUGH_OUTCOME),
    toolsEnabled ? runSurface(() => deps.retrieval.retrieveTools(requests.tools), budget) : Promise.resolve(PASSTHROUGH_OUTCOME),
    chunksEnabled && deps.autoSkill
      ? runChunkSurface(() => deps.retrieval.retrieveSkillChunks!(requests.chunks), budget, deps.autoSkill, deps.resolveChunkMeta)
      : Promise.resolve(CHUNK_PASSTHROUGH),
  ])

  if (agents.degraded || skills.degraded || tools.degraded || chunk.degraded) {
    deps.warn("semantic narrowing degraded: one or more surfaces passed through to the full catalog")
  }
  emitDebug(deps, { agents, skills, tools })

  const sets = assembleSets(agents, skills, tools, chunk)
  deps.state.writeMemo(input.sessionID, input.lastUserID, sets)
  return sets
}
