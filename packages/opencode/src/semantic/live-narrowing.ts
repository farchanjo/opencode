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
import type { RetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"
import type {
  RetrievalFilters,
  RetrievalRequest,
  SkillRetrievalRequest,
  TaskProfile,
  ToolRetrievalRequest,
} from "@opencode-ai/protocol/semantic/commands"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import type { SessionID } from "@/session/schema"
import type { NarrowedSets, NarrowedSetsMemo, RoutingSessionStateStore } from "@/session/routing-state"

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

export interface NarrowForTurnDeps {
  readonly gates: NarrowingGates
  readonly retrieval: RetrievalPort & ToolRetrievalPort
  readonly state: NarrowingStateAccessors
  readonly warn: (message: string) => void
  readonly debugLog?: (surface: NarrowingSurfaceName, kept: readonly string[], dropped: readonly string[]) => void
  /** Project scope for the retrieval requests; defaults to the empty project when absent. */
  readonly projectId?: string
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
// Request assembly
// =============================================================================

interface SurfaceRequests {
  readonly agents: RetrievalRequest
  readonly skills: SkillRetrievalRequest
  readonly tools: ToolRetrievalRequest
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
  }
}

// =============================================================================
// Result assembly + debug
// =============================================================================

/** Assemble the memo: absent surface = passthrough; tools gets the essential-tool floor merged (FR4). */
const assembleSets = (agents: SurfaceOutcome, skills: SurfaceOutcome, tools: SurfaceOutcome): NarrowedSets => {
  const sets: { agents?: readonly string[]; skills?: readonly string[]; tools?: readonly string[] } = {}
  if (agents.ranked) sets.agents = agents.ranked
  if (skills.ranked) sets.skills = skills.ranked
  if (tools.ranked) sets.tools = mergeFloor(tools.ranked)
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

  const requests = buildRequests(deps, input)
  const budget = gates.latencyBudgetMs
  const [agents, skills, tools] = await Promise.all([
    gates.agents ? runSurface(() => deps.retrieval.retrieveAgents(requests.agents), budget) : Promise.resolve(PASSTHROUGH_OUTCOME),
    gates.skills ? runSurface(() => deps.retrieval.retrieveSkills(requests.skills), budget) : Promise.resolve(PASSTHROUGH_OUTCOME),
    toolsEnabled ? runSurface(() => deps.retrieval.retrieveTools(requests.tools), budget) : Promise.resolve(PASSTHROUGH_OUTCOME),
  ])

  if (agents.degraded || skills.degraded || tools.degraded) {
    deps.warn("semantic narrowing degraded: one or more surfaces passed through to the full catalog")
  }
  emitDebug(deps, { agents, skills, tools })

  const sets = assembleSets(agents, skills, tools)
  deps.state.writeMemo(input.sessionID, input.lastUserID, sets)
  return sets
}
