/**
 * Feature 005 / T030 (S18) — the reference-aware retention sweeper.
 *
 * Replaces the `ToolOutputStore` mtime cleanup with the framework-free domain
 * retention evaluator (`@opencode-ai/core/outputspool/retention-graph`, T021)
 * over the control-store reference graph. `release` drops exactly one holder
 * edge; `cleanup` reclaims ONLY fully unreferenced expired groups in bounded
 * per-cycle batches, so a still-referenced output is never deleted merely
 * because it is old, and legal-hold / privacy-erasure are explicit, content-free,
 * audited operations (FR28-FR30, FR37, FR50, C5, AC16, AC17). Every reclaim is a
 * content-free audit event carrying the OutputRef and the edge scope only, never
 * a path or content (C22).
 *
 * The clock, the group metadata (TTL, created-at, active reader/writer, legal
 * hold), the subtree remover, and the audit sink are injected, so the sweeper is
 * deterministic under test; the live stack binds the control store, Config.Service
 * TTLs, and the managed-tree remover.
 */
export * as RetentionSweeper from "./retention-sweeper"

import { RetentionGraph } from "@opencode-ai/core/outputspool/retention-graph"
import type { RetentionDescriptor } from "@opencode-ai/schema/outputspool/retention"
import type { RetentionEdgeKind } from "@opencode-ai/schema/outputspool/enums"
import type { ControlStore } from "./control-store"

/** The default bounded per-cycle cleanup batch size (provisional plan constant, C5, AC17). */
export const DEFAULT_BATCH_SIZE = 64

/** Per-group retention metadata the sweeper reads from the control store + Config.Service. */
export interface GroupRetentionMeta {
  readonly output_ref: string
  readonly ttl_ms: number
  readonly created_at_ms: number
  readonly active_reader_or_writer: boolean
  readonly legal_hold: boolean
}

/** A content-free reclaim audit event (never a path or content, C22, FR50). */
export interface ReclaimAudit {
  readonly output_ref: string
  readonly action: "reclaimed" | "released"
  readonly remaining_edges: number
}

export interface RetentionSweeperDeps {
  readonly store: ControlStore.ControlStore
  /** Remove one channel-generation subtree from the managed tree (content bytes). */
  readonly removeSubtree: (output_ref: string) => void | Promise<void>
  readonly audit?: (event: ReclaimAudit) => void | Promise<void>
  readonly batchSize?: number
  readonly now?: () => number
}

export interface CleanupResult {
  readonly reclaimed_count: number
  readonly scanned_count: number
}

/** Build the reclaim descriptor for a group from its control-store edges + metadata (C5). */
const descriptorFor = (store: ControlStore.ControlStore, meta: GroupRetentionMeta): RetentionDescriptor => {
  const edges = store.listEdges(meta.output_ref).map((e) => ({ kind: e.kind, holder_ref: e.holder_ref }))
  return {
    ttl_ms: meta.ttl_ms,
    legal_hold: meta.legal_hold ? "hold" : "none",
    lease: null,
    edges,
  } as unknown as RetentionDescriptor
}

export interface RetentionSweeper {
  readonly release: (output_ref: string, kind: RetentionEdgeKind, holder_ref: string) => number
  readonly cleanup: (groups: readonly GroupRetentionMeta[]) => Promise<CleanupResult>
}

/** Build the ref-aware retention sweeper over the control store and injected seams. */
export const createRetentionSweeper = (deps: RetentionSweeperDeps): RetentionSweeper => {
  const now = deps.now ?? Date.now
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE

  const release = (output_ref: string, kind: RetentionEdgeKind, holder_ref: string): number => {
    deps.store.removeEdge(output_ref, kind, holder_ref)
    const remaining = deps.store.listEdges(output_ref).length
    void deps.audit?.({ output_ref, action: "released", remaining_edges: remaining })
    return remaining
  }

  const cleanup = async (groups: readonly GroupRetentionMeta[]): Promise<CleanupResult> => {
    const at = now()
    const candidates: RetentionGraph.Candidate<string>[] = groups.map((meta) => ({
      ref: meta.output_ref,
      input: {
        descriptor: descriptorFor(deps.store, meta),
        created_at_ms: meta.created_at_ms,
        active_reader_or_writer: meta.active_reader_or_writer,
      },
    }))
    const selected = RetentionGraph.selectBatch(candidates, batchSize, at)
    for (const output_ref of selected) {
      await deps.removeSubtree(output_ref)
      deps.store.deleteGeneration(output_ref)
      void deps.audit?.({ output_ref, action: "reclaimed", remaining_edges: 0 })
    }
    return { reclaimed_count: selected.length, scanned_count: groups.length }
  }

  return { release, cleanup }
}
