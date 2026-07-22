/**
 * Feature 053 (ORCH) — the always-on, synchronous Data -> Composer interception that
 * runs BEFORE a manager-role spawn's prompt is finalized under `force_manager`.
 *
 * Both stages run as SYNCHRONOUS, in-binary sub-sessions created directly via
 * `Session.Service.create` and driven through the EXISTING `TaskPromptOps`
 * (`resolvePromptParts` + `prompt`) — never a delegation: `HierarchyDispatcher`,
 * `max_delegation_depth`, and `max_workers` are never consulted for either stage, so
 * they consume no depth edge and no fan-out budget (FR2, ADR-0053 "depth constraint").
 *
 * Safety contract (FR4): this module can NEVER fail into the spawn path. Any stage
 * failure, per-stage deadline expiry, an unresolved required agent binding, or a
 * retrieval failure degrades the WHOLE interception to `promptOverride: undefined`
 * (the raw Architect prompt) plus a content-free stage log — no new retry layer.
 *
 * Re-entrancy (FR5): every sub-session `spawnSyntheticSubSession` creates is stamped
 * `synthetic:true` on `RoutingSessionState` IMMEDIATELY after creation and BEFORE its
 * own turn runs, so a Data/Composer sub-session can never itself re-trigger the
 * interception — zero nested interceptions is a structural invariant.
 */
export * as OrchestrationHandoff from "./orchestration-handoff"

import { Duration, Effect, Option } from "effect"
import type { SessionID } from "../session/schema"
import type { SessionPrompt } from "../session/prompt"
import type {
  BriefValidationTally,
  HandoffStageOutcome,
  OrchestrationHandoffEmission,
} from "@/routing/application/telemetry-emitters"
import { validateBrief } from "@/session/brief-validator"

/** The default per-stage deadline (ms). Each stage runs under its OWN bounded deadline
 * (not the turn's shared latency budget) so a slow stage degrades to the raw prompt
 * rather than blocking indefinitely; overridable via `InterceptionDeps.deadlineMs`. */
export const INTERCEPTION_STAGE_DEADLINE_MS = 120_000

/** FR3/FR4 defense-in-depth — the ranked-retrieval/`listSpecialists` catalog build between
 * the Data and Composer stages runs under its OWN short bounded deadline, independent of
 * whatever internal bound the caller's `retrieveRanked`/`listSpecialists` implementation may
 * or may not already enforce, so a hung retrieval can never stall the interception past this
 * window (rather than only degrading at the coarse Manager force-abort). Timeout degrades
 * identically to a failure — fail-open to the full live registry, same as the existing
 * `catchCause` path; overridable via `InterceptionDeps.catalogDeadlineMs`. */
export const CATALOG_RETRIEVAL_DEADLINE_MS = 3_000

/** A specialist as the Composer prompt / brief validator sees it — a name and its
 * optional description, sourced from the full non-hidden live registry. */
export interface SpecialistLite {
  readonly name: string
  readonly description?: string
}

/** The full FR8 content-free record of one interception attempt. Reuses the telemetry
 * emission shape verbatim so the log and the emitted signal never drift. */
export type OrchestrationHandoffLog = OrchestrationHandoffEmission

type PromptParts = SessionPrompt.PromptInput["parts"]

/**
 * The minimal synchronous sub-session primitives `spawnSyntheticSubSession` needs,
 * adapted by the call site (`tool/task.ts`) from `Session.Service` + `TaskPromptOps` +
 * the `RoutingSessionState` store. `createSession` owns child creation AND the
 * `deriveSubagentSessionPermission` derivation the spawn path already performs.
 */
export interface SyntheticSessionOps {
  readonly createSession: (agentName: string) => Effect.Effect<SessionID>
  readonly markSynthetic: (sessionId: SessionID) => void
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptParts>
  readonly prompt: (input: { sessionID: SessionID; agentName: string; parts: PromptParts }) => Effect.Effect<string>
}

export interface InterceptionDeps {
  /** The bound Data-stage agent (defaults to `explore` at the call site, FR1). */
  readonly dataAgentName: string
  /** The bound Composer-stage agent; no default — absence skips the whole interception (FR1). */
  readonly composerAgentName?: string
  /** `Agent.Service.get` — resolves a binding, returning `undefined` when absent (FR7). */
  readonly resolveAgent: (name: string) => Effect.Effect<unknown | undefined>
  readonly sessionOps: SyntheticSessionOps
  /** FR3 — a FRESH `retrieveAgents` over the subtask text, returning ranked agent names
   * (empty on failure/empty result; the caller falls open to `listSpecialists`). */
  readonly retrieveRanked: (subtaskText: string) => Effect.Effect<readonly string[]>
  /** The full non-hidden live registry — the fail-open catalog and brief-validation source (FR3, FR6). */
  readonly listSpecialists: () => Effect.Effect<readonly SpecialistLite[]>
  readonly deadlineMs?: number
  /** Overrides `CATALOG_RETRIEVAL_DEADLINE_MS` for the catalog-build step (FR3/FR4). */
  readonly catalogDeadlineMs?: number
  readonly now?: () => number
}

export interface InterceptionInput {
  /** The Architect's original task text (`params.prompt`). */
  readonly intent: string
}

export interface InterceptionResult {
  readonly promptOverride?: string
  readonly log: OrchestrationHandoffLog
}

// =============================================================================
// Re-entrancy guard (FR5) — pure predicate
// =============================================================================

/** Feature 056 — manager-child Data/Composer handoff is retired (no Manager
 * child sessions). Parameters retained for call-site compatibility. */
export function interceptionEligible(childRole: string, forceManager: boolean, synthetic: boolean): boolean {
  void childRole
  void forceManager
  void synthetic
  return false
}

// =============================================================================
// Synchronous sub-session creation (FR2, FR5)
// =============================================================================

export interface SyntheticSubSessionResult {
  readonly sessionId: SessionID
  readonly resultText: string
}

/** Create a synthetic Data/Composer sub-session, stamp it `synthetic:true` BEFORE its
 * turn runs (FR5), then drive one synchronous `TaskPromptOps` turn and return its text. */
export const spawnSyntheticSubSession = (
  ops: SyntheticSessionOps,
  agentName: string,
  promptText: string,
): Effect.Effect<SyntheticSubSessionResult> =>
  Effect.gen(function* () {
    const sessionId = yield* ops.createSession(agentName)
    ops.markSynthetic(sessionId)
    const parts = yield* ops.resolvePromptParts(promptText)
    const resultText = yield* ops.prompt({ sessionID: sessionId, agentName, parts })
    return { sessionId, resultText }
  })

// =============================================================================
// Prompt builders (content-bearing, but internal to the interception)
// =============================================================================

/** Build the Data-stage recon prompt from the Architect's task text. */
export function reconPrompt(intent: string): string {
  return [
    "You are the DATA (reconnaissance) stage of a deterministic orchestration handoff.",
    "Reconnoiter the codebase/context for the task below and report the concrete facts,",
    "files, and constraints a planner needs — do NOT propose a plan or edit anything.",
    "",
    "--- Architect task ---",
    intent,
  ].join("\n")
}

/** Build the Composer-stage prompt from the intent, the Data recon, and the catalog. */
export function composePrompt(intent: string, recon: string, catalog: string): string {
  return [
    "You are the COMPOSER stage of a deterministic orchestration handoff.",
    "Decompose the Architect's task into independent, well-scoped subtasks and address",
    "each to ONE specialist from the catalog by its exact name. Draw only on real",
    "specialists listed below.",
    "",
    "--- Architect task ---",
    intent,
    "",
    "--- Reconnaissance ---",
    recon,
    "",
    "--- Specialist catalog ---",
    catalog,
  ].join("\n")
}

/** Render the fresh, ranked specialist catalog as a bounded name+description listing. */
export function renderCatalog(rankedNames: readonly string[], specialists: readonly SpecialistLite[]): string {
  const byName = new Map(specialists.map((s) => [s.name, s.description] as const))
  const lines = rankedNames.map((name) => `- ${name}: ${byName.get(name) ?? ""}`.trimEnd())
  return lines.length > 0 ? lines.join("\n") : "(no specialists available)"
}

// =============================================================================
// Stage runner (per-stage deadline + degrade, FR4)
// =============================================================================

interface StageRun {
  readonly ok: boolean
  readonly text: string
  readonly durationMs: number
}

/** Run one stage under its OWN bounded deadline; a failure or timeout degrades the
 * stage (`ok:false`) without ever failing the interception (FR4). */
const runStage = (effect: Effect.Effect<string>, deadlineMs: number, now: () => number): Effect.Effect<StageRun> =>
  Effect.gen(function* () {
    const start = now()
    const settled = yield* effect.pipe(
      Effect.timeoutOption(Duration.millis(deadlineMs)),
      Effect.catchCause(() => Effect.succeed(Option.none<string>())),
    )
    const durationMs = Math.max(0, now() - start)
    return Option.isSome(settled) ? { ok: true, text: settled.value, durationMs } : { ok: false, text: "", durationMs }
  })

/** Bound one catalog-build effect (`listSpecialists`/`retrieveRanked`) under `deadlineMs`,
 * the SAME `timeoutOption` pattern `runStage` uses for Data/Composer; a failure OR a timeout
 * both fail open to `fallback` (FR3/FR4 defense-in-depth). */
const runCatalogStep = <A>(effect: Effect.Effect<A>, deadlineMs: number, fallback: A): Effect.Effect<A> =>
  effect.pipe(
    Effect.timeoutOption(Duration.millis(deadlineMs)),
    Effect.catchCause(() => Effect.succeed(Option.none<A>())),
    Effect.map((settled) => Option.getOrElse(settled, () => fallback)),
  )

// =============================================================================
// Orchestrator (FR2, FR3, FR4, FR6, FR8)
// =============================================================================

/**
 * Sequence Data then, only if Data succeeds, Composer — each as a synchronous synthetic
 * sub-session under its own deadline. On success the validated composed brief becomes
 * `promptOverride`; any failure/timeout/missing binding degrades to `undefined` plus a
 * content-free stage log. NEVER fails.
 */
export const runInterception = (deps: InterceptionDeps, input: InterceptionInput): Effect.Effect<InterceptionResult> => {
  const stages: HandoffStageOutcome[] = []
  const now = deps.now ?? Date.now
  const deadline = deps.deadlineMs ?? INTERCEPTION_STAGE_DEADLINE_MS
  const done = (promptOverride?: string, tally?: BriefValidationTally): InterceptionResult => ({
    promptOverride,
    log: { synthetic: false, eligible: true, stages, tally },
  })

  return Effect.gen(function* () {
    // Gate (FR7): the required bindings for the stages about to run must resolve. The
    // Composer binding has no default, so its absence skips the whole interception.
    const dataResolves = (yield* deps.resolveAgent(deps.dataAgentName)) !== undefined
    const composerResolves =
      deps.composerAgentName !== undefined && (yield* deps.resolveAgent(deps.composerAgentName)) !== undefined
    if (deps.composerAgentName === undefined || !dataResolves || !composerResolves) {
      stages.push({ stage: "data", result: "skipped", durationMs: 0 })
      stages.push({ stage: "composer", result: "skipped", durationMs: 0 })
      return done(undefined)
    }

    const data = yield* runStage(
      spawnSyntheticSubSession(deps.sessionOps, deps.dataAgentName, reconPrompt(input.intent)).pipe(
        Effect.map((r) => r.resultText),
      ),
      deadline,
      now,
    )
    stages.push({ stage: "data", result: data.ok ? "ran" : "degraded", durationMs: data.durationMs })
    if (!data.ok) return done(undefined)

    // FR3/FR4 — fresh catalog over the SUBTASK text, bounded by its OWN short deadline
    // (defense-in-depth, independent of whatever bound the caller's implementation may
    // already enforce); a failure OR a timeout both fail open to the full live registry.
    const catalogDeadline = deps.catalogDeadlineMs ?? CATALOG_RETRIEVAL_DEADLINE_MS
    const specialists = yield* runCatalogStep(deps.listSpecialists(), catalogDeadline, [] as readonly SpecialistLite[])
    const retrieved = yield* runCatalogStep(deps.retrieveRanked(input.intent), catalogDeadline, [] as readonly string[])
    const rankedNames = retrieved.length > 0 ? retrieved : specialists.map((s) => s.name)

    const composer = yield* runStage(
      spawnSyntheticSubSession(
        deps.sessionOps,
        deps.composerAgentName,
        composePrompt(input.intent, data.text, renderCatalog(rankedNames, specialists)),
      ).pipe(Effect.map((r) => r.resultText)),
      deadline,
      now,
    )
    stages.push({ stage: "composer", result: composer.ok ? "ran" : "degraded", durationMs: composer.durationMs })
    if (!composer.ok) return done(undefined)

    // FR6 — validate every cited specialist name against the FULL live registry; repair
    // an unambiguous invalid name, flag the rest, never silently drop.
    const validated = validateBrief(composer.text, {
      resolveSpecialist: (id) => specialists.find((s) => s.name === id),
      listSpecialists: () => specialists,
      ranked: rankedNames,
    })
    const tally: BriefValidationTally = { repaired: validated.repairs.length, flagged: validated.flagged.length }
    return done(validated.brief, tally)
  }).pipe(Effect.catchCause(() => Effect.succeed(done(undefined))))
}
