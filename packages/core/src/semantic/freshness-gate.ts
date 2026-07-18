/**
 * Feature 006 / T021 (S12) — the freshness gate and post-retrieval revalidation
 * contract.
 *
 * Framework-free, deterministic, zero I/O. Encodes the C11 gate (FR20, FR27,
 * FR34): EVERY candidate is revalidated against live AgentV2/SkillV2/Permission
 * before injection, so a disabled agent or a removed / over-permission skill that
 * lingers in a stale index is dropped, and a stale-confidence candidate degrades
 * (contributes NO semantic score) rather than being trusted. Stale-index safety
 * NEVER relies on freshness alone — the live core facts are checked first on every
 * candidate regardless of its freshness bucket (FR20, FR27, C11, AC4, AC5).
 *
 * `bucketOf` maps a projection staleness age to the bounded `fresh|bounded|stale`
 * bucket (`freshness_bucket_edges`, provisional plan constants). `revalidate`
 * resolves one candidate to `kept`, `dropped` (with a typed reason), or `degraded`
 * (stale-confidence); `revalidateAll` partitions a candidate list. The gate never
 * throws and never invents authority — Permission/AgentV2/SkillV2 remain the
 * source of truth (FR1, FR2, C11).
 */
export * as FreshnessGate from "./freshness-gate"

import type { EnumsEvent } from "@opencode-ai/schema/semantic/enums-event"

/** The bounded staleness bucket gating semantic-score contribution (FR27, C11, AC5). */
export type FreshnessBucket = EnumsEvent.FreshnessBucket

/** The fresh/bounded/stale age thresholds in milliseconds (provisional plan constants). */
export interface FreshnessEdges {
  readonly boundedMs: number
  readonly staleMs: number
}

/**
 * Map a projection staleness age to its freshness bucket: `fresh` below the
 * bounded edge, `bounded` up to the stale edge, `stale` beyond it. Pure (FR27, C11).
 */
export const bucketOf = (ageMs: number, edges: FreshnessEdges): FreshnessBucket =>
  ageMs < edges.boundedMs ? "fresh" : ageMs < edges.staleMs ? "bounded" : "stale"

/** The live-core facts a candidate is revalidated against before injection (FR20, C11). */
export interface LiveFacts {
  /** Live AgentV2/SkillV2 enabled state. */
  readonly enabled: boolean
  /** Live availability of the underlying agent/skill. */
  readonly available: boolean
  /** Live PermissionV2 authorization — authoritative over any indexed claim (FR34, AC11). */
  readonly permitted: boolean
}

/** Why a candidate was dropped by post-retrieval revalidation (FR20, C11). */
export type DropReason = "over_permission" | "disabled" | "unavailable"

/**
 * The revalidation outcome for one candidate.
 *   - `kept`: live core confirms it; it contributes its semantic score.
 *   - `dropped`: a stale-index authority mismatch — never injected (FR20, C11).
 *   - `degraded`: a stale-confidence candidate that contributes NO semantic score
 *     but is not a safety violation; it degrades to the C20 ladder (FR27, AC5).
 */
export type RevalidationOutcome =
  | { readonly kind: "kept"; readonly bucket: FreshnessBucket }
  | { readonly kind: "dropped"; readonly reason: DropReason }
  | { readonly kind: "degraded"; readonly reason: "stale_confidence" }

/**
 * Revalidate one candidate against live core. The live facts are checked FIRST
 * regardless of freshness (stale-index safety never relies on freshness alone):
 * a live permission/enabled/availability failure drops the candidate; only a
 * live-valid but `stale`-bucketed candidate degrades to stale-confidence (FR20,
 * FR27, C11, AC4, AC5). Pure and total.
 */
export const revalidate = (facts: LiveFacts, bucket: FreshnessBucket): RevalidationOutcome => {
  if (!facts.permitted) return Object.freeze({ kind: "dropped", reason: "over_permission" })
  if (!facts.enabled) return Object.freeze({ kind: "dropped", reason: "disabled" })
  if (!facts.available) return Object.freeze({ kind: "dropped", reason: "unavailable" })
  if (bucket === "stale") return Object.freeze({ kind: "degraded", reason: "stale_confidence" })
  return Object.freeze({ kind: "kept", bucket })
}

/** One candidate reference plus the live facts and freshness observed for it. */
export interface CandidateFacts<Ref> {
  readonly ref: Ref
  readonly facts: LiveFacts
  readonly bucket: FreshnessBucket
}

/** The partition of a revalidated candidate list into kept, dropped, and degraded. */
export interface RevalidationPartition<Ref> {
  readonly kept: readonly Ref[]
  readonly dropped: ReadonlyArray<{ readonly ref: Ref; readonly reason: DropReason }>
  readonly degraded: readonly Ref[]
}

/**
 * Revalidate a candidate list, partitioning it into the injectable `kept` set, the
 * `dropped` set (stale-index authority mismatches, never injected), and the
 * `degraded` set (stale-confidence, no semantic score) (FR20, FR27, C11). Pure.
 */
export const revalidateAll = <Ref>(candidates: readonly CandidateFacts<Ref>[]): RevalidationPartition<Ref> => {
  const kept: Ref[] = []
  const dropped: Array<{ ref: Ref; reason: DropReason }> = []
  const degraded: Ref[] = []
  for (const candidate of candidates) {
    const outcome = revalidate(candidate.facts, candidate.bucket)
    if (outcome.kind === "kept") kept.push(candidate.ref)
    else if (outcome.kind === "degraded") degraded.push(candidate.ref)
    else dropped.push({ ref: candidate.ref, reason: outcome.reason })
  }
  return Object.freeze({ kept: Object.freeze(kept), dropped: Object.freeze(dropped), degraded: Object.freeze(degraded) })
}
