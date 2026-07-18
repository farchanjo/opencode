/**
 * Feature 003 / T014 (S6) — the occurrence claim state machine.
 *
 * Encodes exactly the occurrence transition table drawn in
 * `doc/arch/statecharts/job-occurrence.md` (C6, FR10, FR11): the happy path
 * `due → claimed → admitted → executing → terminal` plus the misfire, overlap,
 * and reconciliation branches. Every edge is labeled by the `job.*` event from
 * the 30-member vocabulary that triggers it. The machine is pure: it maps a
 * `(state, eventType)` pair to a `TransitionResult` and never performs I/O — the
 * trigger service and projection drive it, surfacing an `illegal` result as an
 * observable anomaly rather than throwing (mirrors
 * `packages/core/src/lifecycle/state-machine.ts`).
 *
 * Authority boundaries faithful to the statechart and ADR-0004:
 *   - `sequence`, `attempt`, and `generation` belong to the canonical Feature
 *     002 executor, NEVER this machine (C6); nothing here authors them.
 *   - `misfired`, `skipped`, `coalesced`, `overlap_rejected`, `reconciled`,
 *     `completed`, `failed`, `cancelled`, `timed_out`, and `unknown` are
 *     absorbing terminals; only bounded retention cleanup leaves them.
 *   - `reconciled` confirms — never regresses or invents — a claimed-but-
 *     undispatched or already-terminal occurrence (C5, C7); it is a real edge
 *     only from `admitted`, matching the statechart.
 *   - Duplicate delivery for one idempotency tuple resolves to a single
 *     execution with an observable `duplicate_of` outcome (FR10, AC6), never a
 *     second admitted path.
 */
export * as OccurrenceStateMachine from "./occurrence-state-machine"

import type { OccurrenceState } from "@opencode-ai/schema/jobs/enums"
import type { JobEventType } from "@opencode-ai/schema/jobs/event-types"

export type { OccurrenceState, JobEventType }

/** The fifteen occurrence states (C6); mirrors `enums.cue` `#OccurrenceState`. */
export const OCCURRENCE_STATES = [
  "due",
  "claimed",
  "admitted",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "skipped",
  "coalesced",
  "misfired",
  "overlap_rejected",
  "overlap_replaced",
  "reconciled",
  "unknown",
] as const satisfies ReadonlyArray<OccurrenceState>

/** The ten absorbing terminal occurrence states (statechart `[*]` exits). */
export const TERMINAL_STATES = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "skipped",
  "coalesced",
  "misfired",
  "overlap_rejected",
  "reconciled",
  "unknown",
] as const satisfies ReadonlyArray<OccurrenceState>

const terminalSet = new Set<OccurrenceState>(TERMINAL_STATES)

/** True when `state` is an absorbing terminal state. */
export const isTerminal = (state: OccurrenceState): boolean => terminalSet.has(state)

/** The single creation event: `[*] --job.trigger_due--> due`. */
export const CREATION_EVENT = "job.trigger_due" as const satisfies JobEventType

/**
 * The legal transition table — exactly the labeled edges of the statechart.
 * Terminal states have no outgoing edges (absorbing). A `(state, event)` pair
 * absent here is either an idempotent redelivery, an event outside the
 * occurrence sub-vocabulary, or illegal.
 */
export const TRANSITIONS: Readonly<Record<OccurrenceState, Readonly<Partial<Record<JobEventType, OccurrenceState>>>>> =
  Object.freeze({
    due: Object.freeze({
      "job.occurrence_claimed": "claimed",
      "job.misfired": "misfired",
      "job.skipped": "skipped",
      "job.coalesced": "coalesced",
    }),
    claimed: Object.freeze({
      "job.admitted": "admitted",
      "job.overlap_rejected": "overlap_rejected",
      "job.overlap_replaced": "overlap_replaced",
      "job.unknown": "unknown",
    }),
    overlap_replaced: Object.freeze({
      "job.admitted": "admitted",
    }),
    admitted: Object.freeze({
      "job.execution_started": "executing",
      "job.reconciled": "reconciled",
    }),
    executing: Object.freeze({
      "job.execution_completed": "completed",
      "job.execution_failed": "failed",
      "job.execution_cancelled": "cancelled",
      "job.execution_timed_out": "timed_out",
      "job.unknown": "unknown",
    }),
    completed: Object.freeze({}),
    failed: Object.freeze({}),
    cancelled: Object.freeze({}),
    timed_out: Object.freeze({}),
    skipped: Object.freeze({}),
    coalesced: Object.freeze({}),
    misfired: Object.freeze({}),
    overlap_rejected: Object.freeze({}),
    reconciled: Object.freeze({}),
    unknown: Object.freeze({}),
  })

/**
 * Canonical target state of each transition-driving event, used to treat an
 * idempotent redelivery of the same event as a no-op (at-least-once delivery,
 * C6) rather than an illegal transition. `job.admitted` targets a single
 * well-defined state (`admitted`) reachable from both `claimed` and
 * `overlap_replaced`; `job.unknown` targets `unknown` from either non-terminal
 * source. Both are single-valued targets, so redelivery is unambiguous.
 */
const EVENT_TARGET: Readonly<Partial<Record<JobEventType, OccurrenceState>>> = Object.freeze({
  "job.occurrence_claimed": "claimed",
  "job.misfired": "misfired",
  "job.skipped": "skipped",
  "job.coalesced": "coalesced",
  "job.admitted": "admitted",
  "job.overlap_rejected": "overlap_rejected",
  "job.overlap_replaced": "overlap_replaced",
  "job.execution_started": "executing",
  "job.execution_completed": "completed",
  "job.execution_failed": "failed",
  "job.execution_cancelled": "cancelled",
  "job.execution_timed_out": "timed_out",
  "job.reconciled": "reconciled",
  "job.unknown": "unknown",
})

/**
 * The outcome of applying a `job.*` event to an occurrence state.
 *   - `transition`: a legal edge moved the occurrence to a new state.
 *   - `unchanged`: a legal idempotent redelivery that leaves the state as-is.
 *   - `illegal`: no legal edge applies; the caller records an anomaly and never
 *     invents terminal state (C6).
 */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: OccurrenceState; readonly to: OccurrenceState; readonly event: JobEventType }
  | { readonly kind: "unchanged"; readonly state: OccurrenceState; readonly event: JobEventType }
  | { readonly kind: "illegal"; readonly from: OccurrenceState; readonly event: JobEventType }

const transition = (from: OccurrenceState, to: OccurrenceState, event: JobEventType): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, event })

const unchanged = (state: OccurrenceState, event: JobEventType): TransitionResult =>
  Object.freeze({ kind: "unchanged", state, event })

const illegal = (from: OccurrenceState, event: JobEventType): TransitionResult =>
  Object.freeze({ kind: "illegal", from, event })

/**
 * Resolve the initial occurrence state from a creation event:
 * `[*] --job.trigger_due--> due`. Any other event is not a valid creation.
 */
export const create = (
  event: JobEventType,
): { readonly ok: true; readonly state: OccurrenceState } | { readonly ok: false; readonly event: JobEventType } =>
  event === CREATION_EVENT ? { ok: true, state: "due" } : { ok: false, event }

/**
 * Apply a `job.*` event to a current occurrence state and return the typed
 * transition outcome. Pure and total: every `(state, event)` pair resolves to a
 * `transition`, `unchanged`, or `illegal` result — the machine never throws.
 */
export const apply = (state: OccurrenceState, event: JobEventType): TransitionResult => {
  if (isTerminal(state)) {
    // Absorbing: only an idempotent redelivery of this state's own terminal
    // event is a no-op; anything else is illegal (never leave a terminal state).
    if (EVENT_TARGET[event] === state) return unchanged(state, event)
    return illegal(state, event)
  }

  const next = TRANSITIONS[state][event]
  if (next !== undefined) return transition(state, next, event)

  // Idempotent redelivery of a transition event whose target is already current.
  if (EVENT_TARGET[event] === state) return unchanged(state, event)

  // A transition event fired from an illegal source state, or an event outside
  // the occurrence sub-vocabulary, is rejected for the caller to surface as an
  // anomaly (C6) — the machine never invents a terminal state.
  return illegal(state, event)
}

// =============================================================================
// Duplicate delivery resolution (FR10, AC6)
// =============================================================================

export interface DuplicateInput {
  /** The occurrence just delivered for an idempotency tuple. */
  readonly incomingOccurrenceId: string
  /** A prior occurrence already claimed for the same tuple, or `null` if first. */
  readonly existingOccurrenceId: string | null
}

/**
 * The resolution of a delivery for one idempotency tuple: either the primary
 * (first) occurrence that proceeds to admission, or a duplicate carrying an
 * observable `duplicate_of` pointer to the primary (FR10, AC6).
 */
export type DuplicateDecision =
  | { readonly kind: "primary" }
  | { readonly kind: "duplicate"; readonly duplicate_of: string }

/**
 * Resolve duplicate delivery for one idempotency tuple to a single execution.
 * A delivery with no prior occurrence — or a redelivery of the same occurrence
 * id — is the primary; any distinct prior occurrence makes this delivery a
 * duplicate that never opens a second admitted path (FR10, AC6). Pure.
 */
export const resolveDuplicate = (input: DuplicateInput): DuplicateDecision =>
  input.existingOccurrenceId === null || input.existingOccurrenceId === input.incomingOccurrenceId
    ? { kind: "primary" }
    : { kind: "duplicate", duplicate_of: input.existingOccurrenceId }
