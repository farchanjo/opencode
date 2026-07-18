/**
 * Feature 005 / T017 (S7) — the OutputGroup channel-generation state machine.
 *
 * Encodes exactly the closed `open->sealing->sealed/aborted/corrupt/expired/
 * unknown` machine drawn in `data-model.md` and `plan.md` "State machines"
 * (FR19, C20). The machine is pure: it maps a `(state, trigger)` pair to a typed
 * `TransitionResult` and never performs I/O, mirroring
 * `packages/core/src/jobs/occurrence-state-machine.ts` and
 * `packages/core/src/lifecycle/state-machine.ts`. An illegal `(state, trigger)`
 * pair surfaces as an observable anomaly rather than throwing, and a terminal
 * state is never invented or regressed.
 *
 * Semantics faithful to the statechart (AC8, AC10):
 *   - `seal` commits finality of the committed bytes (`sealing -> sealed`).
 *   - `abort` stops append while preserving the committed bytes (`-> aborted`).
 *   - a persistent admission fault or a seal that fails after loss reaches
 *     `corrupt`; an indeterminate crash recovery reaches `unknown`.
 *   - a released or TTL-elapsed group reaches `expired` from `sealed`/`aborted`.
 *   - `sealed`, `aborted`, `corrupt`, `expired`, and `unknown` are terminal.
 *
 * The committed-length authority belongs to the control store (C12); `settle`
 * carries the committed byte count unchanged across every transition — the state
 * machine never re-authors it, so `abort` provably preserves committed bytes.
 */
export * as GroupState from "./group-state"

import type { GroupState as GroupStateValue } from "@opencode-ai/schema/outputspool/enums"

export type { GroupStateValue }

/** The closed trigger vocabulary driving the machine (data-model.md state machine). */
export type Trigger =
  | "append"
  | "seal_requested"
  | "seal_committed"
  | "abort"
  | "fault_persistent"
  | "recover_indeterminate"
  | "release"

/** The seven channel-generation states (C20); mirrors `enums.cue` `#GroupState`. */
export const GROUP_STATES = [
  "open",
  "sealing",
  "sealed",
  "aborted",
  "corrupt",
  "expired",
  "unknown",
] as const satisfies ReadonlyArray<GroupStateValue>

/** The five absorbing terminal states (statechart `[*]` exits). */
export const TERMINAL_STATES = [
  "sealed",
  "aborted",
  "corrupt",
  "expired",
  "unknown",
] as const satisfies ReadonlyArray<GroupStateValue>

const terminalSet = new Set<GroupStateValue>(TERMINAL_STATES)

/** True when `state` is an absorbing terminal state. */
export const isTerminal = (state: GroupStateValue): boolean => terminalSet.has(state)

/**
 * The legal transition table — exactly the labeled edges of the statechart.
 * `append` is the `open -> open` self-loop; terminal states are absorbing.
 */
export const TRANSITIONS: Readonly<Record<GroupStateValue, Readonly<Partial<Record<Trigger, GroupStateValue>>>>> =
  Object.freeze({
    open: Object.freeze({
      append: "open",
      seal_requested: "sealing",
      abort: "aborted",
      fault_persistent: "corrupt",
      recover_indeterminate: "unknown",
    }),
    sealing: Object.freeze({
      seal_committed: "sealed",
      abort: "aborted",
      fault_persistent: "corrupt",
    }),
    sealed: Object.freeze({ release: "expired" }),
    aborted: Object.freeze({ release: "expired" }),
    corrupt: Object.freeze({}),
    expired: Object.freeze({}),
    unknown: Object.freeze({}),
  })

/**
 * The single-valued target state of each terminal-reaching trigger, used to
 * treat an idempotent redelivery as a no-op rather than an illegal transition.
 */
const TRIGGER_TARGET: Readonly<Partial<Record<Trigger, GroupStateValue>>> = Object.freeze({
  seal_requested: "sealing",
  seal_committed: "sealed",
  abort: "aborted",
  fault_persistent: "corrupt",
  recover_indeterminate: "unknown",
  release: "expired",
})

/** The outcome of applying a trigger to a state. */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: GroupStateValue; readonly to: GroupStateValue; readonly trigger: Trigger }
  | { readonly kind: "unchanged"; readonly state: GroupStateValue; readonly trigger: Trigger }
  | { readonly kind: "illegal"; readonly from: GroupStateValue; readonly trigger: Trigger }

const transition = (from: GroupStateValue, to: GroupStateValue, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, trigger })

const unchanged = (state: GroupStateValue, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "unchanged", state, trigger })

const illegal = (from: GroupStateValue, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "illegal", from, trigger })

/**
 * Apply a trigger to a current state and return the typed transition outcome.
 * Pure and total: every `(state, trigger)` pair resolves to a `transition`,
 * `unchanged`, or `illegal` result — the machine never throws (FR19, C20).
 *
 * `sealed` and `aborted` are terminal for the generation's content but retain a
 * legal `release -> expired` edge (retention), so the transition table — not a
 * blanket absorbing check — is the single authority: `corrupt`, `expired`, and
 * `unknown` have no outgoing edges and are truly absorbing.
 */
export const apply = (state: GroupStateValue, trigger: Trigger): TransitionResult => {
  const next = TRANSITIONS[state][trigger]
  if (next !== undefined) return next === state ? unchanged(state, trigger) : transition(state, next, trigger)
  if (TRIGGER_TARGET[trigger] === state) return unchanged(state, trigger)
  return illegal(state, trigger)
}

/** A settled state plus its committed-length authority, carried unchanged (C12). */
export interface Settlement {
  readonly state: GroupStateValue
  readonly committed_bytes: number
  readonly result: TransitionResult
}

/**
 * Apply a trigger while carrying the committed byte count. The state machine
 * never re-authors committed bytes (the control store owns them, C12), so a
 * legal or illegal trigger leaves `committed_bytes` untouched — `abort` provably
 * preserves committed bytes (FR24, AC10).
 */
export const settle = (state: GroupStateValue, committed_bytes: number, trigger: Trigger): Settlement => {
  const result = apply(state, trigger)
  const next = result.kind === "transition" ? result.to : state
  return Object.freeze({ state: next, committed_bytes, result })
}
