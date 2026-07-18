/**
 * Feature 005 / T015 (S5) — OutputGroupRef / OutputRef minting and generation
 * fencing.
 *
 * Framework-free and deterministic: no I/O, no Effect runtime, no wall-clock or
 * randomness read. All opacity comes from an injected `EntropyPort` (mirrors the
 * `nowMs` injected-clock style of `packages/core/src/lifecycle/watchdog.ts` and
 * `admission/token-bucket.ts`), so the whole module is trivially reproducible
 * under test (C18, AC11).
 *
 * Two invariants are load-bearing (FR14, FR27, C1, C18):
 *   - One `OutputGroupRef` maps to exactly one generation subtree; a stale
 *     generation never shares a file with its successor. `subtreeKey` is a pure
 *     function of the group id, generation, and channel, so a new generation
 *     always resolves to a distinct subtree.
 *   - `fence` rejects an append/seal from a superseded writer (a writer whose
 *     generation is behind the active generation) and returns the new active
 *     generation when a later writer supersedes a predecessor.
 *
 * `OutputRef` is a bounded opaque handle, never a path and never a saved
 * permission resource (FR12, FR17, FR48, C18); the filesystem subtree layout is
 * derived separately by the application layer from `subtreeKey`, never exposed to
 * a consumer.
 */
export * as Identity from "./identity"

import type { Channel } from "@opencode-ai/schema/outputspool/enums"
import type { GroupId, OutputRef, ProcessId, ProjectId, RootSessionId } from "@opencode-ai/schema/outputspool/ids"
import type { Attempt, Generation } from "@opencode-ai/schema/outputspool/values"
import type { Group } from "@opencode-ai/schema/outputspool/group"

export type { Channel, GroupId, OutputRef, ProcessId, ProjectId, RootSessionId, Attempt, Generation }

/** Injected opaque-token source; deterministic under test (C18). */
export interface EntropyPort {
  /** Return one fresh opaque token. Never a path, never a secret (FR12, C22). */
  readonly token: () => string
}

const asGroupId = (value: string): GroupId => value as unknown as GroupId
const asOutputRef = (value: string): OutputRef => value as unknown as OutputRef

/** The fencing-key components of one OutputGroupRef (FR14, C1, C18). */
export interface MintGroupInput {
  readonly project_id: ProjectId
  readonly root_session_id: RootSessionId
  readonly process_id: ProcessId
  readonly attempt: Attempt
  readonly generation: Generation
}

/** A minted group aggregate: its opaque `id` plus the composite fencing `key`. */
export interface MintedGroup {
  readonly id: GroupId
  readonly key: Group.OutputGroupRef
}

/**
 * Mint one OutputGroup: an opaque `GroupId` from the entropy port plus the
 * composite `OutputGroupRef` fencing key. Pure given the entropy port.
 */
export const mintGroup = (input: MintGroupInput, entropy: EntropyPort): MintedGroup =>
  Object.freeze({
    id: asGroupId(entropy.token()),
    key: Object.freeze({
      project_id: input.project_id,
      root_session_id: input.root_session_id,
      process_id: input.process_id,
      attempt: input.attempt,
      generation: input.generation,
    }),
  })

/** Identity of one channel within a group (FR15, FR17). */
export interface MintChannelInput {
  readonly group_id: GroupId
  readonly generation: Generation
  readonly channel: Channel
}

/** A minted channel: its opaque `OutputRef` plus the one subtree it owns. */
export interface MintedChannel {
  readonly output_ref: OutputRef
  readonly subtree_key: string
}

/**
 * The canonical subtree key for a channel generation. A pure function of the
 * group id, generation, and channel: distinct generations always resolve to
 * distinct subtrees, so a stale generation never overwrites its successor's
 * committed content (FR14, FR27, C1, C18). Never exposed to a consumer.
 */
export const subtreeKey = (group_id: GroupId, generation: Generation, channel: Channel): string =>
  `${group_id}/${generation}/${channel}`

/**
 * Mint one channel OutputRef and bind it to exactly one generation subtree. The
 * ref is an opaque entropy token; the subtree is derived deterministically so
 * one ref maps to one subtree (FR17, C18, AC11).
 */
export const mintOutputRef = (input: MintChannelInput, entropy: EntropyPort): MintedChannel =>
  Object.freeze({
    output_ref: asOutputRef(entropy.token()),
    subtree_key: subtreeKey(input.group_id, input.generation, input.channel),
  })

/**
 * The outcome of fencing an incoming writer's generation against the active
 * generation for a group (FR27, C18, AC11).
 */
export type FenceDecision =
  | { readonly accepted: true; readonly active_generation: Generation }
  | { readonly accepted: false; readonly reason: "stale_generation" }

/**
 * Fence an incoming writer against the active generation. A writer behind the
 * active generation is a superseded predecessor and is rejected; a writer at or
 * ahead of the active generation is accepted and its generation becomes (or
 * stays) active. Pure and total (FR14, FR27, C18, AC11).
 */
export const fence = (active_generation: Generation, writer_generation: Generation): FenceDecision => {
  if (writer_generation < active_generation) return Object.freeze({ accepted: false, reason: "stale_generation" })
  return Object.freeze({ accepted: true, active_generation: writer_generation })
}
