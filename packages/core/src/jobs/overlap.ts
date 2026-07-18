/**
 * Feature 003 / T015 (S7) — overlap policy evaluator.
 *
 * Framework-free, deterministic, zero I/O. Evaluates the four overlap policies
 * `allow | forbid(default) | queue | replace` when a new occurrence claim races
 * a sibling occurrence already running for the same schedule (FR16, C3, AC5).
 * Two invariants are load-bearing:
 *   - Capability gating: a non-`forbid` policy the adapter cannot enforce fails
 *     validation BEFORE registration with a typed capability gap, never an
 *     invented API (FR5, AC22).
 *   - Mutation safety: `replace` NEVER silently stops or kills a mutating
 *     handler/process (ADR-0004, C17, AC25); when the running sibling is
 *     mid-mutation, `replace` degrades to a safe, non-killing outcome.
 *
 * A long-running handler still pending past its next nominal due is resolved as
 * an explicit `misfired` outcome under in-process no-overlap, never a second
 * overlapping invocation (ADR-0004 "Overlap and misfire").
 */
export * as Overlap from "./overlap"

import type { OverlapPolicy, OccurrenceState } from "@opencode-ai/schema/jobs/enums"

export type { OverlapPolicy, OccurrenceState }

/** Provisional default overlap policy (AC5); `forbid` = no overlap. Overridable data. */
export const DEFAULT_OVERLAP_POLICY: OverlapPolicy = "forbid"

/**
 * Which non-default overlap policies the selected adapter/occurrence layer can
 * enforce. `forbid` is always enforceable (it needs no runtime support), so it
 * is not gated. A policy whose flag is `false` fails validation before
 * registration (FR5, C3, AC22).
 */
export interface OverlapCapabilities {
  readonly allow: boolean
  readonly queue: boolean
  readonly replace: boolean
}

export interface OverlapInput {
  readonly policy: OverlapPolicy
  /** True when a sibling occurrence for this schedule is currently active. */
  readonly running: boolean
  /** True when the active sibling handler is mid-mutation (guards `replace`, C17). */
  readonly runningIsMutating: boolean
  readonly capabilities: OverlapCapabilities
}

/**
 * The overlap decision. `admit` proceeds to admission; `reject`/`replace`
 * resolve the occurrence to a branch terminal; `queue` defers behind the
 * running sibling; `capability_gap` fails validation before registration.
 */
export type OverlapDecision =
  | { readonly kind: "admit" }
  | { readonly kind: "queue" }
  | { readonly kind: "reject"; readonly outcome: Extract<OccurrenceState, "overlap_rejected"> }
  | {
      readonly kind: "replace"
      readonly outcome: Extract<OccurrenceState, "overlap_replaced">
      /** Always `true`: this branch is only reached when the sibling is non-mutating (C17). */
      readonly mutationSafe: true
    }
  | { readonly kind: "capability_gap"; readonly capability: string }

const admit: OverlapDecision = Object.freeze({ kind: "admit" })
const queue: OverlapDecision = Object.freeze({ kind: "queue" })
const reject: OverlapDecision = Object.freeze({ kind: "reject", outcome: "overlap_rejected" })
const replace: OverlapDecision = Object.freeze({ kind: "replace", outcome: "overlap_replaced", mutationSafe: true })

const capabilityGap = (capability: string): OverlapDecision => Object.freeze({ kind: "capability_gap", capability })

const isSupported = (policy: OverlapPolicy, capabilities: OverlapCapabilities): boolean => {
  switch (policy) {
    case "forbid":
      return true
    case "allow":
      return capabilities.allow
    case "queue":
      return capabilities.queue
    case "replace":
      return capabilities.replace
  }
}

/**
 * Evaluate the overlap policy for a claim racing a running sibling. Pure and
 * total:
 *   - Any non-`forbid` policy the adapter cannot enforce → `capability_gap`
 *     (validation fails before registration).
 *   - No running sibling → `admit` regardless of policy (no overlap to resolve).
 *   - `allow` + running → `admit` (overlap permitted).
 *   - `forbid` + running → `reject` (`overlap_rejected`, the default).
 *   - `queue` + running → `queue` (defer behind the sibling; bounded elsewhere).
 *   - `replace` + running, sibling NOT mutating → `replace` (`overlap_replaced`,
 *     mutation-safe).
 *   - `replace` + running, sibling MID-MUTATION → NEVER kill: degrade to `queue`
 *     when queueing is supported, else `reject` — surfaced as a safe outcome,
 *     never a silent stop/kill of mutating work (C17, AC25).
 */
export const evaluateOverlap = (input: OverlapInput): OverlapDecision => {
  if (!isSupported(input.policy, input.capabilities)) return capabilityGap(input.policy)
  if (!input.running) return admit

  switch (input.policy) {
    case "allow":
      return admit
    case "forbid":
      return reject
    case "queue":
      return queue
    case "replace":
      // Mutation-safe replace: only supersede a non-mutating sibling. A
      // mid-mutation sibling is never killed — defer or reject instead (C17).
      if (!input.runningIsMutating) return replace
      return input.capabilities.queue ? queue : reject
  }
}

/**
 * Resolve a long-running handler still pending at its next nominal due under
 * in-process no-overlap. `forbid` yields an explicit `misfired` outcome for the
 * next occurrence (never a second overlapping invocation); a policy that does
 * permit concurrency (`allow`/`queue`/`replace`) yields `null` so the caller
 * runs the normal overlap evaluation instead (ADR-0004 "Overlap and misfire").
 * Pure.
 */
export const resolveLongHandler = (
  policy: OverlapPolicy,
  previousHandlerPending: boolean,
): Extract<OccurrenceState, "misfired"> | null =>
  policy === "forbid" && previousHandlerPending ? "misfired" : null
