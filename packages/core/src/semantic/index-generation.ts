/**
 * Feature 006 / T018 (S9) — the blue/green index-generation lifecycle machine.
 *
 * Encodes exactly the closed `building → validated → live → superseded → retired`
 * machine drawn in `plan.md` "State machines" and `data-model.md` (FR12, C12,
 * C21). The machine is pure and never performs I/O, mirroring
 * `packages/core/src/semantic/binding-lifecycle.ts` and the jobs/outputspool
 * state-machine precedents. An illegal `(state, trigger)` pair surfaces as an
 * observable anomaly rather than throwing.
 *
 * Semantics faithful to the statechart (AC9, AC31, AC41):
 *   - `reindex` builds a NEW generation (`[*] --reindex--> building`); a
 *     `select`/`reindex` never activates the live alias — activation is `cutover`
 *     only (C12).
 *   - `validate` reaches `validated` once index/metadata checks pass.
 *   - `cutover` swaps ALL collection aliases together under one CAS
 *     (`validated → live`); `rollback` reverts the alias (`live → validated`).
 *   - a newer generation `supersede`s the live one; a `retire` closes the
 *     dual-write window; an aborted build reaches `retired` directly.
 *
 * A generation stores its embedding dimension + metric (carried, never
 * re-authored here) so incompatible vectors are NEVER mixed in one search space:
 * `requiresNewGeneration`/`vectorsCompatible` force a fresh generation on any
 * dimension or metric change (FR12, C12, AC9), and `cutoverAll` is atomic — every
 * collection in a binding generation cuts over together or none does (C21, AC31).
 */
export * as IndexGeneration from "./index-generation"

import type { Metric } from "@opencode-ai/schema/semantic/enums"
import type { Collection, GenerationState } from "@opencode-ai/schema/semantic/enums-state"

export type { GenerationState }

/** The closed trigger vocabulary driving the generation machine (statechart labels). */
export type Trigger = "reindex" | "validate" | "cutover" | "supersede" | "rollback" | "retire" | "abort"

/** The five generation states (C12); mirrors `enums-state.cue` `#GenerationState`. */
export const GENERATION_STATES = ["building", "validated", "live", "superseded", "retired"] as const satisfies ReadonlyArray<GenerationState>

/** The single absorbing terminal state (`retired`). */
export const isTerminal = (state: GenerationState): boolean => state === "retired"

/** The legal transition table — exactly the labeled edges of the statechart. */
export const TRANSITIONS: Readonly<Record<GenerationState, Readonly<Partial<Record<Trigger, GenerationState>>>>> =
  Object.freeze({
    building: Object.freeze({ validate: "validated", abort: "retired" }),
    validated: Object.freeze({ cutover: "live" }),
    live: Object.freeze({ supersede: "superseded", rollback: "validated" }),
    superseded: Object.freeze({ retire: "retired" }),
    retired: Object.freeze({}),
  })

/** The single-valued target of each trigger, for idempotent-redelivery no-ops. */
const TRIGGER_TARGET: Readonly<Partial<Record<Trigger, GenerationState>>> = Object.freeze({
  validate: "validated",
  cutover: "live",
  supersede: "superseded",
  retire: "retired",
  abort: "retired",
})

/** The outcome of applying a trigger to a generation state. */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: GenerationState; readonly to: GenerationState; readonly trigger: Trigger }
  | { readonly kind: "unchanged"; readonly state: GenerationState; readonly trigger: Trigger }
  | { readonly kind: "illegal"; readonly from: GenerationState; readonly trigger: Trigger }

const transition = (from: GenerationState, to: GenerationState, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, trigger })
const unchanged = (state: GenerationState, trigger: Trigger): TransitionResult => Object.freeze({ kind: "unchanged", state, trigger })
const illegal = (from: GenerationState, trigger: Trigger): TransitionResult => Object.freeze({ kind: "illegal", from, trigger })

/** The initial `reindex` that builds a new generation: `[*] --reindex--> building`. */
export const create = (
  trigger: Trigger,
): { readonly ok: true; readonly state: GenerationState } | { readonly ok: false; readonly trigger: Trigger } =>
  trigger === "reindex" ? { ok: true, state: "building" } : { ok: false, trigger }

/**
 * Apply a trigger to a generation state and return the typed outcome. Pure and
 * total: every `(state, trigger)` pair resolves to `transition`, `unchanged`, or
 * `illegal` and the machine never throws (FR12, C12).
 */
export const apply = (state: GenerationState, trigger: Trigger): TransitionResult => {
  const next = TRANSITIONS[state][trigger]
  if (next !== undefined) return next === state ? unchanged(state, trigger) : transition(state, next, trigger)
  if (TRIGGER_TARGET[trigger] === state) return unchanged(state, trigger)
  return illegal(state, trigger)
}

/** Whether a trigger activates the live alias — ONLY `cutover` does (C12, AC41). */
export const activatesAlias = (trigger: Trigger): boolean => trigger === "cutover"

/** A generation's stored vector space: its embedding dimension and distance metric (FR12). */
export interface VectorSpace {
  readonly dimension: number
  readonly metric: Metric
}

/** Whether two vector spaces may share one search space — same dimension AND metric (FR12, AC9). */
export const vectorsCompatible = (a: VectorSpace, b: VectorSpace): boolean =>
  a.dimension === b.dimension && a.metric === b.metric

/**
 * Whether a dimension/metric change forces a fresh blue/green generation rather
 * than an in-place reindex, so incompatible vectors are never mixed (FR12, C12, AC9).
 */
export const requiresNewGeneration = (current: VectorSpace, next: VectorSpace): boolean =>
  !vectorsCompatible(current, next)

/** One collection's alias move from the live generation to the candidate generation. */
export interface AliasSwap {
  readonly collection: Collection
  readonly from_generation: string
  readonly to_generation: string
}

/**
 * The result of an atomic all-collections cutover: `committed` swaps every alias
 * together, or `contended` swaps NONE (a CAS token mismatch) (C21, AC31, AC32).
 */
export type CutoverResult =
  | { readonly kind: "committed"; readonly swaps: readonly AliasSwap[] }
  | { readonly kind: "contended"; readonly expected: string; readonly actual: string }

/**
 * Atomically cut over all collection aliases in a binding generation under one
 * CAS token. Every collection moves together or none does — the `tools` extension
 * never splits from the others (C21, AC31). Pure: the swap set is computed, the
 * caller applies it in the adapter (T031).
 */
export const cutoverAll = (
  swaps: readonly AliasSwap[],
  casExpected: string,
  casActual: string,
): CutoverResult =>
  casExpected === casActual
    ? Object.freeze({ kind: "committed", swaps: Object.freeze([...swaps]) })
    : Object.freeze({ kind: "contended", expected: casExpected, actual: casActual })
