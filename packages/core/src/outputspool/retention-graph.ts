/**
 * Feature 005 / T021 (S11) — the reference-aware retention reclaim evaluator.
 *
 * Framework-free and deterministic over an injected clock reading: no I/O. This
 * replaces mtime-only cleanup (`tool-output-store.ts`) with a reference graph —
 * a group is never deleted merely because it is old (FR28-FR30, C5, AC16, AC17).
 *
 * A group is reclaimable only when ALL hold (FR28, AC16):
 *   - its TTL has elapsed, AND
 *   - it holds no live lease, AND
 *   - it has no active reader or writer, AND
 *   - it has no inbound reference edge (transcript, Todo, handoff,
 *     NotificationEnvelope `output_ref`, Feature 002 `RowTelemetry.output_ref`,
 *     or a lease edge), AND
 *   - no legal/privacy hold applies.
 *
 * `release` drops exactly one holder edge; `selectBatch` reclaims only fully
 * unreferenced expired groups in bounded batches (FR29, FR30, AC17).
 */
export * as RetentionGraph from "./retention-graph"

import type { HolderRef } from "@opencode-ai/schema/outputspool/ids"
import type { RetentionDescriptor } from "@opencode-ai/schema/outputspool/retention"

export type { HolderRef, RetentionDescriptor }

/** The reclaim-evaluation input for one group. */
export interface ReclaimInput {
  readonly descriptor: RetentionDescriptor
  /** The instant the group was created, for TTL computation (C5, AC16). */
  readonly created_at_ms: number
  /** Whether a reader or writer is currently active on the group (FR28, AC16). */
  readonly active_reader_or_writer: boolean
}

/** Whether the group's TTL has elapsed at `now_ms`. */
export const isExpired = (input: ReclaimInput, now_ms: number): boolean =>
  now_ms - input.created_at_ms >= input.descriptor.ttl_ms

/** The reclaim decision and, when blocked, the single highest-priority reason. */
export type ReclaimDecision =
  | { readonly reclaimable: true }
  | { readonly reclaimable: false; readonly reason: "legal_hold" | "not_expired" | "leased" | "active" | "referenced" }

const blocked = (reason: "legal_hold" | "not_expired" | "leased" | "active" | "referenced"): ReclaimDecision =>
  Object.freeze({ reclaimable: false, reason })

/**
 * Decide whether a group is reclaimable at `now_ms`. Legal hold takes priority
 * (privacy), then TTL, then live lease, active reader/writer, and inbound
 * reference edges — every guard must clear for reclaim (FR28-FR30, C5, AC16).
 */
export const isReclaimable = (input: ReclaimInput, now_ms: number): ReclaimDecision => {
  const d = input.descriptor
  if (d.legal_hold === "hold") return blocked("legal_hold")
  if (!isExpired(input, now_ms)) return blocked("not_expired")
  if (d.lease !== null) return blocked("leased")
  if (input.active_reader_or_writer) return blocked("active")
  if (d.edges.length > 0) return blocked("referenced")
  return Object.freeze({ reclaimable: true })
}

/** The outcome of dropping one holder edge. */
export interface ReleaseResult {
  readonly descriptor: RetentionDescriptor
  readonly dropped: boolean
  readonly remaining_edge_count: number
}

/**
 * Drop exactly one inbound reference edge held by `holder_ref`. Removes the
 * first matching edge only; other holders' edges continue to block reclaim
 * (FR29, C5, AC16).
 */
export const release = (descriptor: RetentionDescriptor, holder_ref: HolderRef): ReleaseResult => {
  const idx = descriptor.edges.findIndex((e) => e.holder_ref === holder_ref)
  if (idx < 0)
    return Object.freeze({ descriptor, dropped: false, remaining_edge_count: descriptor.edges.length })
  const edges = descriptor.edges.filter((_, i) => i !== idx)
  return Object.freeze({
    descriptor: Object.freeze({ ...descriptor, edges }),
    dropped: true,
    remaining_edge_count: edges.length,
  })
}

/** A reclaim candidate: its opaque handle and its evaluation input. */
export interface Candidate<T> {
  readonly ref: T
  readonly input: ReclaimInput
}

/**
 * Select up to `batch_limit` fully-reclaimable candidates at `now_ms`, in input
 * order. Bounded selection: cleanup never scans or reclaims unboundedly (FR29,
 * FR30, C5, AC17).
 */
export const selectBatch = <T>(candidates: readonly Candidate<T>[], batch_limit: number, now_ms: number): readonly T[] => {
  const limit = Math.max(0, Math.floor(batch_limit))
  const out: T[] = []
  for (const candidate of candidates) {
    if (out.length >= limit) break
    if (isReclaimable(candidate.input, now_ms).reclaimable) out.push(candidate.ref)
  }
  return Object.freeze(out)
}
