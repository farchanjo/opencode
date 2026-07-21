/**
 * Feature 044 / Phase 3 — the pure hierarchy-orchestration domain engine.
 *
 * Framework-free value objects + functions for the four orchestration leaves a
 * Manager composes over the ALREADY-SHIPPED F042 dispatch and F043 admission:
 *
 *   - Leaf A (FR-A) — the `ManagerWorkerAggregate` roll-up: one `WorkerOutcome`
 *     per delegated child (lifecycle + a bounded `TodoRollup`, never full item
 *     content), a `failed`/`aborted` Worker first-class, and `WorkerRollupCounters`
 *     that ALWAYS sum to the delegated total.
 *   - Leaf B (FR-B) — `managerCompletionGate`: `blocked` with a pending count
 *     while any Worker is `pending`, `ok` when every Worker is terminal (a
 *     `failed`/`aborted` Worker is terminal and settles the gate, FR-B2).
 *   - Leaf C (FR-C) — `workerValidationChain`: an ordered, fail-fast
 *     SHAPE -> POLICY -> DOMAIN chain over a completed Worker result + its Todo
 *     snapshot, each stage with a defined fail-action.
 *   - Leaf D (FR-D) — the coalesced wake transition (`applyWorkerTransition` is
 *     idempotent on an already-terminal child) and the operator-tunable
 *     `WORKER_MAX_WAIT_MS` force-abort floor.
 *
 * Zero framework deps (mirrors `budget-consume.ts`): no I/O, no Effect runtime
 * import. The caller (the spawn seam + the processor gate) owns the
 * hang/crash-safety wrap (FR-F1); these helpers only compute. Bound by the CUE
 * corpus under `doc/arch/schemas/orchestration/`.
 */
export * as OrchestrationAggregate from "./orchestration-aggregate"

import type { Enums } from "@opencode-ai/schema/routing/enums"
import { TodoAuthority } from "@/routing/domain/todo-authority"

// =============================================================================
// Bounded scalars (ids.cue).
// =============================================================================

/** `#FailureReason` upper bound — a bounded, non-secret explanation. */
export const MAX_REASON_LENGTH = 256

/** Clamp a free-text reason to the bounded `#FailureReason` shape (FR-A3). Never
 * carries message content or a secret — only a short, bounded explanation. */
export function boundReason(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  const nonEmpty = trimmed.length === 0 ? "unspecified" : trimmed
  return nonEmpty.length > MAX_REASON_LENGTH ? nonEmpty.slice(0, MAX_REASON_LENGTH) : nonEmpty
}

/**
 * The operator-tunable MAX-WAIT that bounds a single Worker before it is
 * force-aborted with a `timeout` reason (FR-D3), mirroring the F042
 * `RESOLVE_TIMEOUT_MS` model. Deliberately generous (10 min) so it is a genuine
 * hang/crash safety FLOOR — a hung/crashed Worker escalates rather than blocking
 * the Manager turn forever — never an aggressive cut-off of real long work.
 */
export const WORKER_MAX_WAIT_MS = 600_000

// =============================================================================
// Leaf A — the Todo aggregate roll-up (aggregate.cue).
// =============================================================================

/** Terminal-or-pending state of one delegated Worker (FR-A2). */
export type WorkerLifecycle = "pending" | "done" | "failed" | "aborted"

const TERMINAL_LIFECYCLES: ReadonlyArray<WorkerLifecycle> = ["done", "failed", "aborted"]

/** True iff `lifecycle` is a terminal state (`done | failed | aborted`). */
export function isTerminal(lifecycle: WorkerLifecycle): boolean {
  return TERMINAL_LIFECYCLES.includes(lifecycle)
}

export interface TodoStatusCounts {
  readonly pending: number
  readonly in_progress: number
  readonly completed: number
  readonly cancelled: number
}

/** Bounded, read-only projection of a child's Todo aggregate — counts only,
 * never full item content (FR-A1, FR-A4, Security). */
export interface TodoRollup {
  readonly ref: string
  readonly version: string
  readonly itemCount: number
  readonly statusCounts: TodoStatusCounts
}

/** The degraded roll-up recorded when a child's Todo snapshot cannot be read —
 * the lifecycle still tracks the terminal state (FR-F1). */
export const UNKNOWN_ROLLUP: TodoRollup = {
  ref: "unknown",
  version: "unknown",
  itemCount: 0,
  statusCounts: { pending: 0, in_progress: 0, completed: 0, cancelled: 0 },
}

/** Map the pure `TodoAuthority.summarize` projection to the bounded roll-up. */
export function rollupFromSummary(summary: TodoAuthority.TodoSummary): TodoRollup {
  return {
    ref: summary.ref,
    version: summary.version,
    itemCount: summary.itemCount,
    statusCounts: {
      pending: summary.statusCounts.pending,
      in_progress: summary.statusCounts.in_progress,
      completed: summary.statusCounts.completed,
      cancelled: summary.statusCounts.cancelled,
    },
  }
}

/**
 * Whether a delegated Worker was awaited within the launching turn (`foreground`)
 * or launched fire-and-continue (`background`, incl. a promoted foreground Worker).
 * The ENFORCING completion gate (FR-B1) holds a turn open ONLY for a `foreground`
 * pending Worker — a `background` Worker is fire-and-continue by the experimental
 * background-subagent contract (`tool/task.ts` BACKGROUND_STARTED), so it is tracked
 * INFORMATIONALLY and woken on every terminal signal, never error-blocking the
 * launching turn. See ADR-0044 Decision #3 and the rejected block-on-background
 * alternative.
 */
export type WorkerDelivery = "foreground" | "background"

/** One delegated Worker's immutable entry in the Manager aggregate (FR-A1..A3). */
export interface WorkerOutcome {
  readonly childSessionId: string
  readonly lifecycle: WorkerLifecycle
  /** Foreground (awaited, gate-enforced) vs background (fire-and-continue, informational). */
  readonly delivery: WorkerDelivery
  readonly todo: TodoRollup
  /** Present only for a failed or aborted Worker (FR-A3). */
  readonly reason?: string
  /** For a validation-rejected Worker, the first failed stage's fail-action
   * (`reject` / `reject_redispatch` / `surface_blocked`) so the Manager can act
   * on it downstream (re-dispatch vs surface) (FR-C2). */
  readonly failAction?: ValidationFailAction
}

/** The aggregate's invariant summary — the counts ALWAYS sum to `total` (FR-A3). */
export interface WorkerRollupCounters {
  readonly total: number
  readonly pending: number
  readonly done: number
  readonly failed: number
  readonly aborted: number
}

/** The Manager's roll-up of every delegated Worker (FR-A1, aggregate root). */
export interface ManagerWorkerAggregate {
  readonly managerSessionId: string
  readonly roster: ReadonlyArray<WorkerOutcome>
  readonly counters: WorkerRollupCounters
}

/** An empty aggregate for a Manager that has delegated nothing yet. */
export function emptyAggregate(managerSessionId: string): ManagerWorkerAggregate {
  return { managerSessionId, roster: [], counters: countersFor([]) }
}

/** Recompute the roll-up counters so the invariant sum always holds (FR-A3). */
export function countersFor(roster: ReadonlyArray<WorkerOutcome>): WorkerRollupCounters {
  const counters = { total: roster.length, pending: 0, done: 0, failed: 0, aborted: 0 }
  for (const entry of roster) counters[entry.lifecycle]++
  return counters
}

function withRoster(aggregate: ManagerWorkerAggregate, roster: ReadonlyArray<WorkerOutcome>): ManagerWorkerAggregate {
  return { managerSessionId: aggregate.managerSessionId, roster, counters: countersFor(roster) }
}

/**
 * Record a newly delegated Worker as `pending` (FR-A1). Re-recording the same
 * child id replaces its entry (a resumed dispatch), never duplicates it, so the
 * counters stay consistent with the delegated set.
 */
export function recordWorker(aggregate: ManagerWorkerAggregate, outcome: WorkerOutcome): ManagerWorkerAggregate {
  const others = aggregate.roster.filter((entry) => entry.childSessionId !== outcome.childSessionId)
  return withRoster(aggregate, [...others, outcome])
}

/**
 * Apply a Worker terminal transition (the wake, FR-D1/FR-D2). COALESCED +
 * idempotent: a child already recorded terminal is a no-op (a repeat signal —
 * an `Idle` event plus a `background.wait` resolution — collapses to one), so a
 * burst of near-simultaneous signals produces one settled aggregate.
 */
export function applyWorkerTransition(aggregate: ManagerWorkerAggregate, outcome: WorkerOutcome): ManagerWorkerAggregate {
  const existing = aggregate.roster.find((entry) => entry.childSessionId === outcome.childSessionId)
  if (existing && isTerminal(existing.lifecycle)) return aggregate
  return recordWorker(aggregate, outcome)
}

/** The recorded delivery of a Worker (defaults `foreground` for an unknown child),
 * so a terminal fold PRESERVES whether the Worker was gate-enforced or informational. */
export function deliveryOf(aggregate: ManagerWorkerAggregate | null, childSessionId: string): WorkerDelivery {
  return aggregate?.roster.find((entry) => entry.childSessionId === childSessionId)?.delivery ?? "foreground"
}

// =============================================================================
// Leaf B — the completion gate (gates.cue).
// =============================================================================

export type CompletionGateOutcome = "ok" | "blocked"

export interface CompletionGateResult {
  readonly outcome: CompletionGateOutcome
  readonly pendingWorkers: number
}

/**
 * The ENFORCING completion gate (FR-B1). A Manager turn settles only when every
 * FOREGROUND (awaited) delegated Worker is terminal; a `failed`/`aborted` Worker is
 * terminal and SETTLES the gate — surfaced, not held forever (FR-B2). Reuses the
 * `todo-authority.ts` `completionGate` `ok`/`blocked` vocabulary (FR-B3).
 *
 * BACKGROUND (fire-and-continue) Workers are DELIBERATELY EXCLUDED from the block:
 * hard-blocking a launching turn on a by-design background launch would regress the
 * experimental background-subagent fire-and-continue contract (ADR-0044 Decision #3,
 * rejected alternative "block-on-background"). They stay in the roll-up counters
 * (informational) and are woken on every terminal signal, but never error-block the
 * turn. A foreground Worker is structurally terminal by the turn boundary anyway
 * (its Task tool call blocks the turn until it settles), so the gate is a typed
 * consistency assertion of that invariant — never a false or wake-starving block.
 */
export function managerCompletionGate(aggregate: ManagerWorkerAggregate): CompletionGateResult {
  const pendingWorkers = aggregate.roster.filter(
    (entry) => entry.lifecycle === "pending" && entry.delivery === "foreground",
  ).length
  if (pendingWorkers > 0) return { outcome: "blocked", pendingWorkers }
  return { outcome: "ok", pendingWorkers: 0 }
}

// =============================================================================
// Leaf C — the ordered SHAPE -> POLICY -> DOMAIN validation chain (gates.cue).
// =============================================================================

export type ValidationStage = "shape" | "policy" | "domain"
export type ValidationFailAction = "reject" | "reject_redispatch" | "surface_blocked"
export type StageVerdict = "passed" | "failed"
export type AcceptanceVerdict = "accepted" | "rejected"

export interface ValidationStageResult {
  readonly stage: ValidationStage
  readonly verdict: StageVerdict
  readonly failAction?: ValidationFailAction
  readonly reason?: string
}

export interface WorkerValidationChain {
  readonly childSessionId: string
  readonly stages: ReadonlyArray<ValidationStageResult>
  readonly acceptance: AcceptanceVerdict
}

/** SHAPE — the completed result is a well-formed, decodable envelope (FR-C1). */
export interface ShapeInput {
  readonly hasEnvelope: boolean
}

/** POLICY — the result is legal for the child's role + the `orchestration_only`
 * boundary; a non-Worker child must not have escaped the F042 allowlist (FR-C1). */
export interface PolicyInput {
  readonly executionAllowed: boolean
  readonly toolsUsed: ReadonlyArray<string>
  readonly allowedTools: ReadonlyArray<string>
}

/** DOMAIN — the child's required Todo items are completed (FR-C1). */
export interface DomainInput {
  readonly snapshot: TodoAuthority.TodoAggregate
  readonly validationPerformed: boolean
}

export interface WorkerValidationInput {
  readonly childSessionId: string
  readonly shape: ShapeInput
  readonly policy: PolicyInput
  readonly domain: DomainInput
}

function passed(stage: ValidationStage): ValidationStageResult {
  return { stage, verdict: "passed" }
}

function failed(stage: ValidationStage, failAction: ValidationFailAction, reason: string): ValidationStageResult {
  return { stage, verdict: "failed", failAction, reason: boundReason(reason) }
}

function evaluateShape(input: ShapeInput): ValidationStageResult {
  if (!input.hasEnvelope) return failed("shape", "reject", "result is not a decodable task_result envelope")
  return passed("shape")
}

function evaluatePolicy(input: PolicyInput): ValidationStageResult {
  if (input.executionAllowed) return passed("policy")
  const escaped = input.toolsUsed.filter((tool) => !input.allowedTools.includes(tool))
  if (escaped.length > 0) {
    return failed("policy", "reject_redispatch", `result escaped orchestration_only allowlist: ${escaped.join(",")}`)
  }
  return passed("policy")
}

function evaluateDomain(input: DomainInput): ValidationStageResult {
  const gate = TodoAuthority.completionGate(input.snapshot, {
    expectedVersion: input.snapshot.version,
    validationPerformed: input.validationPerformed,
  })
  if (gate.outcome === "blocked") {
    return failed("domain", "surface_blocked", gate.reason ?? "required items are not all completed")
  }
  return passed("domain")
}

/**
 * The ordered, fail-fast acceptance chain (FR-C1, FR-C2, FR-C3): SHAPE then
 * POLICY then DOMAIN, each evaluated ONLY if the prior passed. A rejected result
 * stops the chain — no stage silently passes a failing result. Acceptance is
 * `accepted` only when every stage passed.
 */
export function workerValidationChain(input: WorkerValidationInput): WorkerValidationChain {
  const stages: ValidationStageResult[] = []
  const shape = evaluateShape(input.shape)
  stages.push(shape)
  if (shape.verdict === "passed") {
    const policy = evaluatePolicy(input.policy)
    stages.push(policy)
    if (policy.verdict === "passed") stages.push(evaluateDomain(input.domain))
  }
  const acceptance: AcceptanceVerdict = stages.every((s) => s.verdict === "passed") ? "accepted" : "rejected"
  return { childSessionId: input.childSessionId, stages, acceptance }
}

/** The first failed stage of a chain, if any — the fail-action + reason the fold surfaces. */
export function firstFailure(chain: WorkerValidationChain): ValidationStageResult | undefined {
  return chain.stages.find((stage) => stage.verdict === "failed")
}

// =============================================================================
// Leaf D — the terminal fold + wake trigger (wake-and-events.cue).
// =============================================================================

/** The observed terminal status of a Worker (`background.wait` result status,
 * plus the synthetic `timeout` for a max-wait force-abort). */
export type BackgroundStatus = "completed" | "error" | "cancelled" | "timeout"

export type WakeTrigger =
  | "child_completed"
  | "child_failed"
  | "child_aborted"
  | "session_idle"
  | "max_wait_expired"

/** Map a terminal status to its wake trigger (wake-and-events.cue `#WakeTrigger`). */
export function wakeTriggerFromStatus(status: BackgroundStatus): WakeTrigger {
  switch (status) {
    case "completed":
      return "child_completed"
    case "error":
      return "child_failed"
    case "cancelled":
      return "child_aborted"
    case "timeout":
      return "max_wait_expired"
  }
}

export interface TerminalFoldInput {
  readonly childSessionId: string
  /** Preserve whether the Worker was gate-enforced (foreground) or informational. */
  readonly delivery: WorkerDelivery
  readonly status: BackgroundStatus
  readonly todo: TodoRollup
  /** Present only for a `completed` status — the ordered acceptance chain (FR-C3). */
  readonly chain?: WorkerValidationChain
  /** Bounded source text for a failure/abort reason (an error message / cause). */
  readonly failureText?: string
}

/**
 * Fold an observed terminal signal into the Worker's `WorkerOutcome` (FR-A2, FR-C).
 * A `completed` result is `done` ONLY when the chain accepted it; a rejected chain
 * marks the Worker `failed` with the failed stage's reason AND its fail-action (so a
 * `reject_redispatch` is distinguishable from a `surface_blocked` downstream, FR-C2)
 * — never silently `done`. `error` -> failed, `cancelled`/`timeout` -> aborted —
 * each terminal + surfaced.
 */
export function foldTerminalOutcome(input: TerminalFoldInput): WorkerOutcome {
  const base = { childSessionId: input.childSessionId, delivery: input.delivery, todo: input.todo }
  if (input.status === "completed") {
    if (input.chain && input.chain.acceptance === "rejected") {
      const failure = firstFailure(input.chain)
      return {
        ...base,
        lifecycle: "failed",
        reason: failure?.reason ?? boundReason("result rejected at validation"),
        failAction: failure?.failAction,
      }
    }
    return { ...base, lifecycle: "done" }
  }
  if (input.status === "error") {
    return { ...base, lifecycle: "failed", reason: boundReason(input.failureText ?? "worker errored") }
  }
  const abortReason = input.status === "timeout" ? "timeout: worker exceeded max-wait" : input.failureText ?? "worker cancelled"
  return { ...base, lifecycle: "aborted", reason: boundReason(abortReason) }
}
