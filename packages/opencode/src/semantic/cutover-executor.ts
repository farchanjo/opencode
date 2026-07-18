/**
 * Feature 006 / T031 (S20) — the blue/green cutover executor.
 *
 * Swaps the live alias for EVERY collection in a binding generation together
 * under one CAS token and an operator confirmation, so `agents`/`skills`/
 * `skill_chunks` (and the Feature 009 `tools` extension) never split. An
 * embedding dimension/metric change forces a full reindex into a NEW generation
 * before an explicit cutover — `select`/`reindex` alone never activate the live
 * alias. Rollback reverses the swap under policy, caches are invalidated by
 * binding/version, and a reranker cutover requires NO re-embedding (FR12, FR32,
 * C12, AC31, AC32).
 *
 * The CAS decision reuses the framework-free core `index-generation.cutoverAll`
 * so the atomicity rule has one owner; the atomic swap is applied through the
 * injected Milvus port.
 */
export * as CutoverExecutor from "./cutover-executor"

import { Effect } from "effect"
import { IndexGeneration } from "@opencode-ai/core/semantic/index-generation"
import type { CollectionKind, MetricKind } from "@opencode-ai/protocol/semantic/commands"
import type { MilvusGap, MilvusPort } from "./milvus-adapter"

/** A vector space: the embedding dimension and distance metric stored with the generation (FR12). */
export interface VectorSpace {
  readonly dimension: number
  readonly metric: MetricKind
}

/** Whether an embedding change forces a fresh blue/green generation (never mixes vectors, FR12, AC9). */
export const requiresReindex = (current: VectorSpace, next: VectorSpace): boolean =>
  IndexGeneration.requiresNewGeneration(current, next)

/** `select`/`reindex` never activate the live alias — only `cutover` does (FR32, C12). */
export const activatesAlias = (action: "select" | "reindex" | "cutover"): boolean => action === "cutover"

export interface CutoverInput {
  readonly collections: readonly CollectionKind[]
  readonly fromGeneration: string
  readonly toGeneration: string
  readonly casExpected: string
  readonly casActual: string
  readonly confirmed: boolean
  readonly bindingVersion: number
}

export type CutoverOutcome =
  | { readonly kind: "committed"; readonly swapped: readonly CollectionKind[]; readonly invalidatedBindingVersion: number }
  | { readonly kind: "confirmation_required" }
  | { readonly kind: "cas_conflict"; readonly expected: string; readonly actual: string }

/**
 * Execute an embedding cutover: require confirmation, decide the CAS atomically
 * over all collections, then apply the atomic alias swap through Milvus and
 * report the binding version whose caches are now invalidated. A CAS contention
 * swaps NONE (FR32, C12, AC31, AC32).
 */
export const cutoverEmbedding = (
  deps: { readonly milvus: MilvusPort },
  input: CutoverInput,
): Effect.Effect<CutoverOutcome, MilvusGap> =>
  Effect.gen(function* () {
    if (!input.confirmed) return { kind: "confirmation_required" }
    const swaps = input.collections.map((collection) => ({
      collection,
      from_generation: input.fromGeneration,
      to_generation: input.toGeneration,
    }))
    const decision = IndexGeneration.cutoverAll(swaps, input.casExpected, input.casActual)
    if (decision.kind === "contended") {
      return { kind: "cas_conflict", expected: decision.expected, actual: decision.actual }
    }
    yield* deps.milvus.swapAliases({
      targets: input.collections.map((collection) => ({ collection, generationId: input.toGeneration })),
      casToken: input.casExpected,
    })
    return { kind: "committed", swapped: input.collections, invalidatedBindingVersion: input.bindingVersion }
  })

export interface RollbackInput {
  readonly collections: readonly CollectionKind[]
  readonly targetGeneration: string
  readonly casExpected: string
  readonly casActual: string
  readonly confirmed: boolean
  readonly bindingVersion: number
}

/** Reverse a cutover under policy: swap every alias back to the target generation atomically (FR32, C12). */
export const rollbackEmbedding = (
  deps: { readonly milvus: MilvusPort },
  input: RollbackInput,
): Effect.Effect<CutoverOutcome, MilvusGap> =>
  cutoverEmbedding(deps, {
    collections: input.collections,
    fromGeneration: input.targetGeneration,
    toGeneration: input.targetGeneration,
    casExpected: input.casExpected,
    casActual: input.casActual,
    confirmed: input.confirmed,
    bindingVersion: input.bindingVersion,
  })

export type RerankerCutoverOutcome =
  | { readonly kind: "committed"; readonly invalidatedBindingVersion: number; readonly reEmbedded: false }
  | { readonly kind: "confirmation_required" }

/**
 * Execute a reranker cutover: activate the new reranker binding version and
 * invalidate the rerank cache/eval version WITHOUT any re-embedding — the vector
 * index is untouched by a reranker change (FR32, AC32).
 */
export const cutoverReranker = (
  input: { readonly confirmed: boolean; readonly bindingVersion: number },
): RerankerCutoverOutcome => {
  if (!input.confirmed) return { kind: "confirmation_required" }
  return { kind: "committed", invalidatedBindingVersion: input.bindingVersion, reEmbedded: false }
}
