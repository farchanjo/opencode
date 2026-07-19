/**
 * Feature 006 / T036 (S6) — the retrieval facade and the Feature 001 seam.
 *
 * Exposes the `RetrievalPort` (`retrieveAgents`/`retrieveSkills`) that Feature 001
 * Architect/Manager candidate support would consume, wiring the deterministic
 * score / tie-break / post-retrieval revalidation into a ranked-candidate result.
 * Every returned candidate is `revalidated: true` (the pipeline's stage-9
 * revalidation ran), the effective embedding/reranker binding versions and the
 * Feature 004 language tag are recorded WITHOUT content, and `retrieveSkills` is
 * lazy — summary metadata first, chunk injection only after Agent selection under
 * the C8 budget (FR1, FR2, FR5, FR16, FR21, FR23, FR39, C2, C11).
 *
 * HONEST V1 SEAM (`FEATURE_001_SELECTION_SEAM`): this wave delivers the facade
 * module plus tests plus a DOCUMENTED wiring point where Feature 001
 * Architect/Manager selection would consume the port, mirroring the langlock
 * injection-seam precedent. The seam is an unreachable path until Feature 001
 * wires it, and the Worker path never calls it to create agents or children
 * (FR5). The nine-stage pipeline itself is the injected `PipelineRunnerPort`,
 * bound to `packages/core/src/semantic/pipeline.ts` at the composition root.
 */
export * as RetrievalFacade from "./retrieval-facade"

import { Effect } from "effect"
import type {
  DegradationOutcome,
  QueryFingerprint,
  RetrievalCandidate,
  RetrievalError,
  RetrievalRequest,
  RetrievalResult,
  SkillRetrievalRequest,
  ToolCandidate,
  ToolDegradationOutcome,
  ToolRetrievalError,
  ToolRetrievalRequest,
  ToolRetrievalResult,
  ToolSource,
} from "@opencode-ai/protocol/semantic/commands"
import type { RetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"

/** One ranked row from the pipeline: the score components and the canonical identity/version. */
export interface RankedRow {
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly rerank: number | null
  readonly dense: number
  readonly sparse: number
}

/** The content-free retrieval decision record: effective binding versions + Feature 004 tag, never content (FR16, C22). */
export interface RetrievalDecisionRecord {
  readonly embeddingBindingVersion: number
  readonly rerankerBindingVersion: number | null
  readonly languageTag: string | null
}

/** The outcome of one pipeline pass, carrying everything the facade needs to assemble a result. */
export interface PipelineOutcome {
  readonly rows: readonly RankedRow[]
  readonly degradation: DegradationOutcome
  readonly queryFingerprint: QueryFingerprint
  readonly cacheHit: boolean
  readonly effective: RetrievalDecisionRecord
}

/** One ranked tool row from the tool pass: the score components plus the tool identity and provenance (C3). */
export interface ToolRankedRow {
  readonly canonicalId: string
  readonly canonicalVersion: string // the C3 tool content hash (tie-break version leg)
  readonly source: ToolSource
  readonly mcpServerRef?: string
  readonly rerank: number | null
  readonly dense: number
  readonly sparse: number
}

/** The outcome of one tool pass, carrying everything the facade needs to assemble a tool result (C2). */
export interface ToolPipelineOutcome {
  readonly rows: readonly ToolRankedRow[]
  readonly degradation: ToolDegradationOutcome
  readonly queryFingerprint: QueryFingerprint
  readonly cacheHit: boolean
  readonly effective: RetrievalDecisionRecord
}

/** The injected nine-stage pipeline seam; bound to the core pipeline at the composition root. */
export interface PipelineRunnerPort {
  readonly runAgents: (request: RetrievalRequest) => Promise<PipelineOutcome>
  readonly runSkills: (request: SkillRetrievalRequest) => Promise<PipelineOutcome>
  /** Feature 009 tool pass (stages 1–6 + 9); bound to `packages/core/src/semantic/tool-pass.ts` (C2). */
  readonly runTools: (request: ToolRetrievalRequest) => Promise<ToolPipelineOutcome>
}

/** A content-free sink recording the effective binding versions and language tag on the decision (FR16, C22). */
export interface RetrievalRecorder {
  readonly record: (decision: RetrievalDecisionRecord) => void
}

export interface RetrievalFacadeDeps {
  readonly pipeline: PipelineRunnerPort
  readonly recorder: RetrievalRecorder
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Build one revalidated candidate from a ranked row; the confidence is bounded to `[0,1]` (FR22, C11). */
function toCandidate(row: RankedRow, kind: RetrievalCandidate["kind"], rank: number): RetrievalCandidate {
  return {
    canonicalId: row.canonicalId,
    canonicalVersion: row.canonicalVersion,
    kind,
    score: {
      rerankScore: row.rerank ?? undefined,
      denseScore: row.dense,
      sparseScore: row.sparse,
      canonicalId: row.canonicalId,
      canonicalVersion: row.canonicalVersion,
      confidence: clamp01(row.rerank ?? row.dense),
    },
    revalidated: true,
  }
}

/** Reject a request whose top_k exceeds the Feature 001 budget before any retrieval (FR38, C8). */
function budgetError(request: RetrievalRequest): RetrievalError | null {
  if (request.retrievalTopK <= 0) return { type: "budget_exceeded", field: "retrieval_top_k" }
  if (request.rerankTopK <= 0 || request.rerankTopK > request.retrievalTopK) return { type: "budget_exceeded", field: "rerank_top_k" }
  return null
}

function assemble(outcome: PipelineOutcome, kind: RetrievalCandidate["kind"]): RetrievalResult {
  return {
    candidates: outcome.rows.map((row, index) => toCandidate(row, kind, index)),
    degradation: outcome.degradation,
    queryFingerprint: outcome.queryFingerprint,
    cacheHit: outcome.cacheHit,
  }
}

/** Build one revalidated tool candidate from a ranked tool row; the confidence is bounded to `[0,1]` (FR3, C3). */
function toToolCandidate(row: ToolRankedRow): ToolCandidate {
  return {
    canonicalId: row.canonicalId,
    canonicalVersion: row.canonicalVersion,
    source: row.source,
    ...(row.mcpServerRef ? { mcpServerRef: row.mcpServerRef } : {}),
    score: {
      rerankScore: row.rerank ?? undefined,
      denseScore: row.dense,
      sparseScore: row.sparse,
      canonicalId: row.canonicalId,
      canonicalVersion: row.canonicalVersion,
      confidence: clamp01(row.rerank ?? row.dense),
    },
    revalidated: true,
  }
}

/** Reject a tool request whose top_k exceeds the reused Feature 006 budget before any retrieval (C5, FR13). */
function toolBudgetError(request: ToolRetrievalRequest): ToolRetrievalError | null {
  if (request.retrievalTopK <= 0) return { type: "budget_exceeded", field: "retrieval_top_k" }
  if (request.rerankTopK <= 0 || request.rerankTopK > request.retrievalTopK) {
    return { type: "budget_exceeded", field: "rerank_top_k" }
  }
  return null
}

function assembleTools(outcome: ToolPipelineOutcome): ToolRetrievalResult {
  return {
    candidates: outcome.rows.map(toToolCandidate),
    degradation: outcome.degradation,
    queryFingerprint: outcome.queryFingerprint,
    cacheHit: outcome.cacheHit,
  }
}

/**
 * Build the `RetrievalPort` facade over the injected pipeline runner. `retrieveAgents`
 * runs the agent pass; `retrieveSkills` runs the constrained skill pass. Both
 * record the content-free decision and assemble a ranked, revalidated result; a
 * budget overflow is a typed error, never a silent truncation (FR38, C8).
 */
export const createRetrievalFacade = (deps: RetrievalFacadeDeps): RetrievalPort & ToolRetrievalPort => {
  const retrieveAgents = (request: RetrievalRequest): Effect.Effect<RetrievalResult, RetrievalError> => {
    const overflow = budgetError(request)
    if (overflow) return Effect.fail(overflow)
    return Effect.tryPromise({
      try: () => deps.pipeline.runAgents(request),
      catch: (): RetrievalError => ({ type: "timeout" }),
    }).pipe(
      Effect.map((outcome) => {
        deps.recorder.record(outcome.effective)
        return assemble(outcome, "agent")
      }),
    )
  }

  const retrieveSkills = (request: SkillRetrievalRequest): Effect.Effect<RetrievalResult, RetrievalError> => {
    const overflow = budgetError(request)
    if (overflow) return Effect.fail(overflow)
    return Effect.tryPromise({
      try: () => deps.pipeline.runSkills(request),
      catch: (): RetrievalError => ({ type: "timeout" }),
    }).pipe(
      Effect.map((outcome) => {
        deps.recorder.record(outcome.effective)
        return assemble(outcome, "skill")
      }),
    )
  }

  /**
   * Feature 009 tool pass (C2, C15). Runs the injected `runTools` (stages 1–6 + 9),
   * records the content-free decision, and assembles a bounded, revalidated ranked
   * tool result; a budget overflow is a typed error, never a silent truncation (C5).
   * A sibling port on the same facade — never a second router (NFR5).
   */
  const retrieveTools = (request: ToolRetrievalRequest): Effect.Effect<ToolRetrievalResult, ToolRetrievalError> => {
    const overflow = toolBudgetError(request)
    if (overflow) return Effect.fail(overflow)
    return Effect.tryPromise({
      try: () => deps.pipeline.runTools(request),
      catch: (): ToolRetrievalError => ({ type: "timeout" }),
    }).pipe(
      Effect.map((outcome) => {
        deps.recorder.record(outcome.effective)
        return assembleTools(outcome)
      }),
    )
  }

  return { retrieveAgents, retrieveSkills, retrieveTools }
}

/**
 * DOCUMENTED Feature 001 wiring point (unreachable in V1). Feature 001
 * Architect/Manager selection would call `port.retrieveAgents` (Architect) then
 * `port.retrieveSkills` (Manager, constrained by the selected Agent) to obtain
 * revalidated ranked candidates; the Worker path never calls this. Until Feature
 * 001 wires it, this seam is present, typed, and covered by a seam test but not
 * invoked by any live route (FR1, FR2, FR5, FR21, NFR5). It returns the port so
 * the composition root can hand it to Feature 001 unchanged.
 */
export const FEATURE_001_SELECTION_SEAM = (port: RetrievalPort): RetrievalPort => port

/**
 * HONEST V1 SEAM (`FEATURE_009_TOOL_SELECTION_SEAM`, C15): mirrors the
 * `FEATURE_001_SELECTION_SEAM` above exactly. `session/tools.ts` `resolve()` and
 * `registry.ts` `tools()`/`describeCodeMode` would call `port.retrieveTools(...)`
 * here once a per-surface flag (C9) is deliberately turned on; with every surface
 * at its C9 default (off), this function is reachable only from tests, never from a
 * live route, and the live LLM tool list is not narrowed (FR1, FR11, NFR5). It
 * returns the port so the composition root can hand it to the seam unchanged.
 */
export const FEATURE_009_TOOL_SELECTION_SEAM = (port: ToolRetrievalPort): ToolRetrievalPort => port
