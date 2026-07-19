/**
 * Feature 008 / T017 (S9) — the resource-update policy engine.
 *
 * Encodes the default `notify_cache` policy and its opt-in gates drawn in `plan.md`
 * "State machines" / "Resource subscription lifecycle", `flags.cue`, and the
 * C9/C21/C22 matrix (FR23, FR24, C9, C21, C22). Pure and deterministic: the wall
 * clock is an injected VALUE (`nowMillis`) supplied by the `packages/opencode`
 * `ClockPort`; the `mcp.resource_updated` emission is the adapter's.
 *
 * On `resources/updated` the default path COALESCES/DEDUPES/DEBOUNCES updates into a
 * bounded per-URI queue carrying sequence + correlation, then updates UI and cache
 * only — no re-read, reindex, or wake. The `conditional_reread`, `reindex`
 * (semantic-reindex), and `wake` steps sit behind SEPARATE per-server opt-in gates
 * and NEVER auto-fire; `wake` is additionally admission-gated (C22). No configuration
 * ever produces an automatic model turn per update (FR24, C9, C22).
 *
 * Reconciliation: the schema `ResourceUpdatePolicy` enum spells the reindex rung
 * `reindex` (the `data-model.md` / `enums-state.cue` authority); the tasks prose
 * "semantic_reindex" is the same rung. This module follows the schema spelling.
 */
export * as ResourcePolicy from "./resource-policy"

import type { ResourceUpdatePolicy } from "@opencode-ai/schema/mcp/enums-state"

export type { ResourceUpdatePolicy }

/** The default resource-update policy — notify + cache only, no re-read/reindex/wake (FR23, C9). */
export const DEFAULT_POLICY: ResourceUpdatePolicy = "notify_cache"

/** True when the policy is the safe default (notify + cache only) (FR23, C9). */
export const isDefaultPolicy = (policy: ResourceUpdatePolicy): boolean => policy === DEFAULT_POLICY

/** The bounded coalescing-queue parameters; exact bounds are provisional plan constants (C9). */
export interface CoalesceConfig {
  /** The maximum number of distinct in-flight resource URIs held before drop (C9). */
  readonly capacity: number
  /** The debounce window in millis within which a repeat update is a rapid-burst merge (C9). */
  readonly debounceMillis: number
}

/** One coalesced update frame for a resource URI, carrying sequence + correlation (FR23, C9). */
export interface UpdateFrame {
  readonly resourceUri: string
  readonly correlationId: string
  /** Per-frame monotonic sequence, bumped on every coalesced merge (FR23, C9). */
  readonly sequence: number
  /** How many raw `resources/updated` notifications merged into this frame. */
  readonly count: number
  /** True once at least one repeat update merged into the frame (deduped/coalesced). */
  readonly coalesced: boolean
  readonly lastMillis: number
}

/** The outcome of offering one `resources/updated` notification to the queue (never thrown). */
export type EnqueueOutcome =
  | { readonly kind: "queued"; readonly frame: UpdateFrame }
  | { readonly kind: "coalesced"; readonly frame: UpdateFrame; readonly debounced: boolean }
  | { readonly kind: "dropped"; readonly reason: "queue_full"; readonly resourceUri: string }

/** A bounded per-URI coalescing/dedupe/debounce queue for `resources/updated` (FR23, FR24, C9). */
export interface CoalescingQueue {
  /** Offer one notification; a repeat URI coalesces, a new URI queues unless the cap is hit. */
  readonly offer: (input: { readonly resourceUri: string; readonly correlationId: string; readonly nowMillis: number }) => EnqueueOutcome
  /** Drain and clear all pending frames in insertion order for a single notify+cache pass. */
  readonly drain: () => ReadonlyArray<UpdateFrame>
  /** Current number of distinct pending URIs. */
  readonly depth: () => number
}

/**
 * Construct a bounded coalescing queue. A repeat update to a pending URI is deduped
 * into its frame (count++/sequence++, `coalesced`), flagged `debounced` when it
 * arrived within the debounce window; a new URI queues unless `capacity` distinct
 * URIs are already pending, in which case it is dropped `queue_full` (FR23, FR24, C9).
 */
export const createCoalescingQueue = (config: CoalesceConfig): CoalescingQueue => {
  const frames = new Map<string, UpdateFrame>()
  let nextSequence = 0

  const offer: CoalescingQueue["offer"] = ({ resourceUri, correlationId, nowMillis }) => {
    const existing = frames.get(resourceUri)
    if (existing !== undefined) {
      const debounced = nowMillis - existing.lastMillis < config.debounceMillis
      const merged: UpdateFrame = Object.freeze({
        ...existing,
        sequence: existing.sequence + 1,
        count: existing.count + 1,
        coalesced: true,
        lastMillis: nowMillis,
      })
      frames.set(resourceUri, merged)
      return Object.freeze({ kind: "coalesced", frame: merged, debounced })
    }
    if (frames.size >= config.capacity) return Object.freeze({ kind: "dropped", reason: "queue_full", resourceUri })
    const frame: UpdateFrame = Object.freeze({
      resourceUri,
      correlationId,
      sequence: nextSequence++,
      count: 1,
      coalesced: false,
      lastMillis: nowMillis,
    })
    frames.set(resourceUri, frame)
    return Object.freeze({ kind: "queued", frame })
  }

  return {
    offer,
    drain: () => {
      const drained = Object.freeze(Array.from(frames.values()))
      frames.clear()
      return drained
    },
    depth: () => frames.size,
  }
}

/** The closed set of resource-update steps; there is deliberately no `turn` step (FR24, C9, C22). */
export type ResourceStep = "notify" | "cache" | "conditional_reread" | "reindex" | "wake"

/** The independent per-server opt-in gates beyond the notify+cache default (C9, C21, C22). */
export interface PolicyGates {
  /** Whether the operator opted the scheduler into an admission-gated wake (C22). */
  readonly wakeAdmitted: boolean
}

/** No gate admitted — the safe default posture (C9, C22). */
export const DEFAULT_GATES: PolicyGates = Object.freeze({ wakeAdmitted: false })

/**
 * The ordered steps a `resources/updated` triggers under `policy`. Every policy
 * includes notify + cache; `conditional_reread` and `reindex` add exactly their
 * one opt-in rung; `wake` adds its rung ONLY when the scheduler admitted it, else
 * it degrades to notify + cache. No policy ever yields a model turn (FR24, C9, C22).
 */
export const planSteps = (policy: ResourceUpdatePolicy, gates: PolicyGates = DEFAULT_GATES): ReadonlyArray<ResourceStep> => {
  const base: ResourceStep[] = ["notify", "cache"]
  switch (policy) {
    case "notify_cache":
      return Object.freeze(base)
    case "conditional_reread":
      return Object.freeze([...base, "conditional_reread"])
    case "reindex":
      return Object.freeze([...base, "reindex"])
    case "wake":
      return Object.freeze(gates.wakeAdmitted ? [...base, "wake"] : base)
  }
}

/** No resource-update policy ever produces an automatic model turn per update (FR24, C9). */
export const producesAutomaticTurn = (): false => false
