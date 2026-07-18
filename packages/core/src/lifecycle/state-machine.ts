/**
 * Feature 002 / T017 (S7) — the ten-state Process Table lifecycle machine.
 *
 * Encodes exactly the ten permitted Process Table states (C7, FR25) and the
 * legal transition table drawn in `doc/arch/statecharts/task-lifecycle.md`
 * (mermaid + Notes). Every edge is labeled by the lifecycle event from the
 * 26-member vocabulary (FR20) that triggers it. The machine is pure: it maps a
 * `(state, eventType)` pair to a `TransitionResult` and never performs I/O — the
 * projection (T016) and Process Table (T018) drive it, surfacing an `illegal`
 * result as an observable anomaly (C9) rather than throwing.
 *
 * Non-transition semantics faithful to the statechart:
 *   - `handoff` is an event, never a state: it is projected onto the current
 *     state without altering it (statechart preamble).
 *   - `reconciled` is a durable audit event that confirms — but never regresses
 *     or invents — an absorbing terminal state (C13, FR29): legal from any state,
 *     never a transition.
 *   - `completed`, `failed`, `cancelled`, `zombie`, `unknown` are absorbing
 *     terminals; only a bounded retention cleanup leaves them (FR27), which is
 *     not modeled here as an application transition.
 *   - Per the statechart Notes and C7, the shared bucketed watchdog (C12) may
 *     fence ANY non-terminal state — including `cancelling` — to `zombie`
 *     (`zombie_detected`) or `unknown` (`owner_lost`); the mermaid omits the two
 *     `cancelling` edges but its own Notes and C7 mandate "any non-terminal
 *     state may transition to zombie or unknown", so they are encoded here.
 */
export * as StateMachine from "./state-machine"

import type { ProcessState, LifecycleEventType } from "@opencode-ai/schema/lifecycle/enums"

export type { ProcessState, LifecycleEventType }

/** The closed set of ten Process Table states (C7, FR25); `handoff` is not a state. */
export const PROCESS_STATES = [
  "created",
  "queued",
  "waiting",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "zombie",
  "unknown",
] as const satisfies ReadonlyArray<ProcessState>

/** The five absorbing terminal states (FR27). */
export const TERMINAL_STATES = ["completed", "failed", "cancelled", "zombie", "unknown"] as const satisfies ReadonlyArray<ProcessState>

const terminalSet = new Set<ProcessState>(TERMINAL_STATES)

/** True when `state` is an absorbing terminal state. */
export const isTerminal = (state: ProcessState): boolean => terminalSet.has(state)

/** The single creation event: `[*] --process_created--> created`. */
export const CREATION_EVENT = "lifecycle.process_created" as const satisfies LifecycleEventType

/**
 * The durable audit event that confirms an absorbing terminal state without
 * transitioning it (C13, FR29). Legal from any state; never changes state.
 */
export const AUDIT_EVENT = "lifecycle.reconciled" as const satisfies LifecycleEventType

/**
 * The legal transition table — exactly the labeled edges of the statechart,
 * plus the universal watchdog edges (`zombie_detected`/`owner_lost`) on every
 * non-terminal state per the statechart Notes and C7. Terminal states have no
 * outgoing edges (absorbing). A `(state, event)` pair absent here is either an
 * in-state observation event, an idempotent redelivery, or illegal.
 */
export const TRANSITIONS: Readonly<Record<ProcessState, Readonly<Partial<Record<LifecycleEventType, ProcessState>>>>> =
  Object.freeze({
    created: Object.freeze({
      "lifecycle.admitted": "queued",
      "lifecycle.zombie_detected": "zombie",
      "lifecycle.owner_lost": "unknown",
    }),
    queued: Object.freeze({
      "lifecycle.started": "running",
      "lifecycle.waiting": "waiting",
      "lifecycle.cancel_requested": "cancelling",
      "lifecycle.zombie_detected": "zombie",
      "lifecycle.owner_lost": "unknown",
    }),
    waiting: Object.freeze({
      "lifecycle.promoted": "running",
      "lifecycle.cancel_requested": "cancelling",
      "lifecycle.zombie_detected": "zombie",
      "lifecycle.owner_lost": "unknown",
    }),
    running: Object.freeze({
      "lifecycle.waiting": "waiting",
      "lifecycle.completed": "completed",
      "lifecycle.failed": "failed",
      "lifecycle.cancel_requested": "cancelling",
      "lifecycle.zombie_detected": "zombie",
      "lifecycle.owner_lost": "unknown",
    }),
    cancelling: Object.freeze({
      "lifecycle.cancelled": "cancelled",
      "lifecycle.failed": "failed",
      "lifecycle.unknown": "unknown",
      // Universal watchdog fences (statechart Notes, C7): a cancelling row may
      // still be declared a zombie or lose its owner before an outcome lands.
      "lifecycle.zombie_detected": "zombie",
      "lifecycle.owner_lost": "unknown",
    }),
    completed: Object.freeze({}),
    failed: Object.freeze({}),
    cancelled: Object.freeze({}),
    zombie: Object.freeze({}),
    unknown: Object.freeze({}),
  })

/**
 * Canonical target state of each transition-driving event, used to treat an
 * idempotent redelivery of the same event as a no-op (C9, at-least-once delivery)
 * rather than an illegal transition. Every value is a single well-defined target.
 */
const EVENT_TARGET: Readonly<Partial<Record<LifecycleEventType, ProcessState>>> = Object.freeze({
  "lifecycle.admitted": "queued",
  "lifecycle.started": "running",
  "lifecycle.promoted": "running",
  "lifecycle.waiting": "waiting",
  "lifecycle.cancel_requested": "cancelling",
  "lifecycle.completed": "completed",
  "lifecycle.failed": "failed",
  "lifecycle.cancelled": "cancelled",
  "lifecycle.zombie_detected": "zombie",
  "lifecycle.owner_lost": "unknown",
  "lifecycle.unknown": "unknown",
})

/**
 * Progress / announcement events observed within a state without changing it.
 * These are the vocabulary members that never label a state-changing edge:
 * lineage, budget/turn, control-outcome, and tool-boundary events, plus the
 * `queued` and `cancelling` state announcements whose transitions are driven by
 * `admitted` and `cancel_requested` respectively. `handoff` is projected onto
 * the current state without altering it (statechart preamble, C16).
 */
export const IN_STATE_EVENTS = [
  "lifecycle.parent_attached",
  "lifecycle.queued",
  "lifecycle.extended",
  "lifecycle.handoff",
  "lifecycle.steer_requested",
  "lifecycle.steer_accepted",
  "lifecycle.steer_rejected",
  "lifecycle.turn_started",
  "lifecycle.turn_ended",
  "lifecycle.turn_failed",
  "lifecycle.tool_called",
  "lifecycle.tool_settled",
  "lifecycle.cancelling",
] as const satisfies ReadonlyArray<LifecycleEventType>

const inStateSet = new Set<LifecycleEventType>(IN_STATE_EVENTS)

/**
 * The outcome of applying a lifecycle event to a Process Table state.
 *   - `transition`: a legal edge moved the row to a new state.
 *   - `unchanged`: a legal observation, audit, or idempotent redelivery that
 *     leaves the state as-is.
 *   - `illegal`: no legal edge or observation applies; the projection records an
 *     anomaly and never invents terminal state (C9, FR29).
 */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: ProcessState; readonly to: ProcessState; readonly event: LifecycleEventType }
  | { readonly kind: "unchanged"; readonly state: ProcessState; readonly event: LifecycleEventType }
  | { readonly kind: "illegal"; readonly from: ProcessState; readonly event: LifecycleEventType }

const transition = (from: ProcessState, to: ProcessState, event: LifecycleEventType): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, event })

const unchanged = (state: ProcessState, event: LifecycleEventType): TransitionResult =>
  Object.freeze({ kind: "unchanged", state, event })

const illegal = (from: ProcessState, event: LifecycleEventType): TransitionResult =>
  Object.freeze({ kind: "illegal", from, event })

/**
 * Resolve the initial Process Table state from a creation event:
 * `[*] --process_created--> created`. Any other event is not a valid creation.
 */
export const create = (
  event: LifecycleEventType,
): { readonly ok: true; readonly state: ProcessState } | { readonly ok: false; readonly event: LifecycleEventType } =>
  event === CREATION_EVENT ? { ok: true, state: "created" } : { ok: false, event }

/**
 * Apply a lifecycle event to a current Process Table state and return the typed
 * transition outcome. Pure and total: every `(state, event)` pair resolves to a
 * `transition`, `unchanged`, or `illegal` result — the machine never throws.
 */
export const apply = (state: ProcessState, event: LifecycleEventType): TransitionResult => {
  // reconciled is a pure audit confirmation, legal from any state (C13, FR29).
  if (event === AUDIT_EVENT) return unchanged(state, event)

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

  // In-state observation/announcement events do not change the state.
  if (inStateSet.has(event)) return unchanged(state, event)

  // Everything else (a transition event fired from an illegal source state, or a
  // duplicate creation) is rejected for the projection to surface as an anomaly.
  return illegal(state, event)
}
