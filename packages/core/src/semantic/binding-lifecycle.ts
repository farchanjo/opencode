/**
 * Feature 006 / T017 (S8) — the pinned-binding lifecycle state machine.
 *
 * Encodes exactly the closed `draft → staged → active → degraded → unavailable`
 * machine drawn in `plan.md` "State machines" and `data-model.md` (FR31, FR32,
 * C12, C20). The machine is pure: it maps a `(state, trigger)` pair to a typed
 * `TransitionResult` and never performs I/O, mirroring
 * `packages/core/src/outputspool/group-state.ts` and
 * `packages/core/src/jobs/occurrence-state-machine.ts`. An illegal pair surfaces
 * as an observable anomaly rather than throwing.
 *
 * Semantics faithful to the statechart (AC27, AC29, AC31, AC33):
 *   - `select` stages a candidate version: it creates `draft` from the initial
 *     pseudo-state (`create`) and re-stages an `active` binding to `staged`.
 *   - `validate`/`reindex` move `draft`/`staged` forward WITHOUT activating the
 *     live alias (activation is `cutover` only, C12).
 *   - `cutover` under CAS + confirmation activates `staged → active`.
 *   - a provider/model `outage` degrades `active → degraded`; a persistent
 *     outage reaches `unavailable`; `recover` returns `degraded → active`.
 *   - `rollback` restores a superseded version (the `active → active` self-loop).
 *   - `degraded`/`unavailable` NEVER auto-substitute another model — the binding
 *     ref is carried unchanged across every transition (FR31, C20, AC29).
 *
 * The binding VERSION is authored by the Feature 007 operator, never this machine
 * (C12): `degrade`/`stay` carry the pinned version and refs unchanged, and
 * `pinForTask`/`resolvePinned` freeze an in-flight Task's version at Task start so
 * a mid-task operator cutover never switches the running Task's binding (FR32,
 * AC33).
 */
export * as BindingLifecycle from "./binding-lifecycle"

import type { BindingState } from "@opencode-ai/schema/semantic/enums-state"

export type { BindingState }

/** The closed trigger vocabulary driving the binding machine (statechart labels). */
export type Trigger =
  | "select"
  | "validate"
  | "reindex"
  | "cutover"
  | "outage"
  | "outage_persists"
  | "recover"
  | "rollback"

/** The five binding states (C12, C20); mirrors `enums-state.cue` `#BindingState`. */
export const BINDING_STATES = ["draft", "staged", "active", "degraded", "unavailable"] as const satisfies ReadonlyArray<BindingState>

/**
 * The legal transition table — exactly the labeled edges of the statechart.
 * `active --rollback--> active` is a self-loop; `unavailable --select--> draft`
 * lets an operator re-select before a fresh cutover (the statechart's
 * "operator re-selects and cutover" path). No edge auto-substitutes a model.
 */
export const TRANSITIONS: Readonly<Record<BindingState, Readonly<Partial<Record<Trigger, BindingState>>>>> =
  Object.freeze({
    draft: Object.freeze({ validate: "staged", reindex: "staged" }),
    staged: Object.freeze({ cutover: "active", reindex: "staged" }),
    active: Object.freeze({ outage: "degraded", select: "staged", rollback: "active" }),
    degraded: Object.freeze({ outage_persists: "unavailable", recover: "active" }),
    unavailable: Object.freeze({ select: "draft" }),
  })

/** The single-valued target of each trigger, for idempotent-redelivery no-ops. */
const TRIGGER_TARGET: Readonly<Partial<Record<Trigger, BindingState>>> = Object.freeze({
  validate: "staged",
  cutover: "active",
  outage: "degraded",
  outage_persists: "unavailable",
  recover: "active",
})

/** The outcome of applying a trigger to a binding state. */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: BindingState; readonly to: BindingState; readonly trigger: Trigger }
  | { readonly kind: "unchanged"; readonly state: BindingState; readonly trigger: Trigger }
  | { readonly kind: "illegal"; readonly from: BindingState; readonly trigger: Trigger }

const transition = (from: BindingState, to: BindingState, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, trigger })
const unchanged = (state: BindingState, trigger: Trigger): TransitionResult => Object.freeze({ kind: "unchanged", state, trigger })
const illegal = (from: BindingState, trigger: Trigger): TransitionResult => Object.freeze({ kind: "illegal", from, trigger })

/** The initial `select` that stages a candidate version: `[*] --select--> draft`. */
export const create = (
  trigger: Trigger,
): { readonly ok: true; readonly state: BindingState } | { readonly ok: false; readonly trigger: Trigger } =>
  trigger === "select" ? { ok: true, state: "draft" } : { ok: false, trigger }

/**
 * Apply a trigger to a binding state and return the typed outcome. Pure and
 * total: every `(state, trigger)` pair resolves to `transition`, `unchanged`, or
 * `illegal` and the machine never throws (FR31, C12, C20).
 */
export const apply = (state: BindingState, trigger: Trigger): TransitionResult => {
  const next = TRANSITIONS[state][trigger]
  if (next !== undefined) return next === state ? unchanged(state, trigger) : transition(state, next, trigger)
  if (TRIGGER_TARGET[trigger] === state) return unchanged(state, trigger)
  return illegal(state, trigger)
}

/** A binding's state plus its operator-authored version and refs, carried unchanged (C12). */
export interface BindingSnapshot {
  readonly state: BindingState
  readonly version: number
  /** The model ref pinned in the slot; NEVER substituted on degrade (FR31, C20). */
  readonly model_ref: string
  readonly result: TransitionResult
}

/**
 * Apply a trigger while carrying the operator-authored version and the pinned
 * model ref. The machine never re-authors the version and never substitutes the
 * model ref — a legal or illegal trigger leaves both untouched, so a `degraded`
 * or `unavailable` outcome provably keeps the same model (FR31, C20, AC29).
 */
export const step = (
  snapshot: Pick<BindingSnapshot, "state" | "version" | "model_ref">,
  trigger: Trigger,
): BindingSnapshot => {
  const result = apply(snapshot.state, trigger)
  const state = result.kind === "transition" ? result.to : snapshot.state
  return Object.freeze({ state, version: snapshot.version, model_ref: snapshot.model_ref, result })
}

/** An in-flight Task's binding version, frozen at Task start (FR32, AC33). */
export interface PinnedBinding {
  readonly version: number
  readonly model_ref: string
}

/** Freeze the effective binding version/ref for the duration of one Task (FR32). */
export const pinForTask = (snapshot: Pick<BindingSnapshot, "version" | "model_ref">): PinnedBinding =>
  Object.freeze({ version: snapshot.version, model_ref: snapshot.model_ref })

/**
 * Resolve the binding a running Task must use: always the version pinned at Task
 * start, never a mid-task operator cutover (FR32, AC33). A changed live version is
 * ignored until the Task completes, so no in-flight switch is ever observed.
 */
export const resolvePinned = (pinned: PinnedBinding, _liveVersion: number): PinnedBinding => pinned
