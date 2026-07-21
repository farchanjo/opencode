/**
 * Feature 006 / T030 (S19) — content-hash index jobs on the Feature 002/003
 * lifecycle.
 *
 * Upsert / tombstone / reconcile jobs project live AgentV2/SkillV2 state into the
 * Milvus index by CONTENT HASH: a changed or new document upserts, a removed
 * document tombstones, an unchanged document is a no-op. Scheduled reconcile
 * (Feature 003) runs on the CURRENT pinned embedding binding without changing it,
 * coalesces overlapping triggers to one run, uses NO LLM by default, and spools
 * large job output as a Feature 005 `OutputRef` rather than inlining it (FR13,
 * FR40, C22). The job never carries a document body, a secret, or a path — only
 * bounded counts and opaque refs (C22).
 *
 * The Milvus and spool ports are injected seams; the content-hash decision reuses
 * the framework-free `packages/core/src/semantic/projection.ts` engine so the
 * upsert/tombstone rule has exactly one owner.
 */
export * as IndexJobs from "./index-jobs"

import { Effect } from "effect"
import { Projection } from "@opencode-ai/core/semantic/projection"
import type { CollectionKind } from "@opencode-ai/protocol/semantic/commands"
import type { ToolDoc } from "@opencode-ai/schema/semantic/tool-doc"
import type { AgentDoc, SkillChunkDoc, SkillDoc } from "@opencode-ai/schema/semantic/documents"
import type { DocumentRow, MandatoryFilters, MilvusGap, MilvusPort } from "./milvus-adapter"

/** A live-core document projected to its content hash and mandatory scalar fields (never a body, C22). */
export interface LiveDoc {
  readonly canonicalId: string
  readonly contentHash: string
  readonly row: DocumentRow
}

/** The prior indexed state for one document, keyed by canonical id. */
export interface IndexedDoc {
  readonly canonicalId: string
  readonly contentHash: string
}

/** The mutation plan for one reconcile run (bounded counts, content-free). */
export interface MutationPlan {
  readonly upserts: readonly DocumentRow[]
  readonly tombstones: readonly string[]
  readonly unchanged: readonly string[]
}

/**
 * Plan mutations by content hash: a new/changed live doc upserts, an indexed doc
 * absent from live tombstones, an unchanged doc is a no-op. Reuses the core
 * projection `decideMutation` so the rule is single-sourced (FR13, C9).
 */
export const planMutations = (live: readonly LiveDoc[], indexed: readonly IndexedDoc[]): MutationPlan => {
  const indexedByCanonical = new Map(indexed.map((doc) => [doc.canonicalId, doc.contentHash]))
  const liveIds = new Set(live.map((doc) => doc.canonicalId))
  const upserts: DocumentRow[] = []
  const unchanged: string[] = []
  for (const doc of live) {
    const previous = indexedByCanonical.get(doc.canonicalId) ?? null
    const decision = Projection.decideMutation(previous, doc.contentHash)
    if (decision === "upsert") upserts.push(doc.row)
    else unchanged.push(doc.canonicalId)
  }
  const tombstones = indexed.filter((doc) => !liveIds.has(doc.canonicalId)).map((doc) => doc.canonicalId)
  return { upserts, tombstones, unchanged }
}

/** Coalesce overlapping triggers to one run per collection (FR13, AC13). */
export const coalesceTriggers = (collections: readonly CollectionKind[]): readonly CollectionKind[] =>
  [...new Set(collections)]

/** The pinned dense + sparse vectors for one tool document, produced by the reused embedding client (I/O upstream). */
export interface ToolVectors {
  readonly dense: readonly number[]
  readonly terms: readonly string[]
}

/**
 * Feature 009 / T007 (S6) — project one sanitized `ToolDoc` into the generic
 * `LiveDoc` the existing `runReconcile` consumes for the `tools` collection. The
 * content hash keys the incremental content-hash upsert/tombstone (FR8, AC10); the
 * mandatory scalar `DocScope` fields become the per-search partition filters so a
 * tool never crosses a project (FR10, C13). No new lifecycle machinery — `tools`
 * reuses `planMutations` / `runReconcile` verbatim (C7). The dense/sparse vectors
 * are injected from the reused embedding client (I/O stays upstream, C2).
 */
export const toolLiveDoc = (doc: ToolDoc, vectors: ToolVectors): LiveDoc => ({
  canonicalId: doc.id,
  contentHash: doc.identity.content_hash,
  row: {
    canonicalId: doc.id,
    canonicalVersion: doc.identity.content_hash,
    dense: vectors.dense,
    terms: vectors.terms,
    filters: {
      projectId: doc.scope.project_id,
      scope: doc.scope.scope,
      visibility: doc.scope.visibility,
      permissionRef: doc.scope.permission_ref,
    },
  },
})

/**
 * Feature 019 / T008 (FR6) — project a sanitized `AgentDoc` into the generic
 * `LiveDoc` for the `agents` collection, joining the shipped `toolLiveDoc`. The
 * content hash keys the incremental upsert/tombstone; the mandatory `DocScope`
 * fields become the per-search partition filters so an agent never crosses a project
 * (FR9, C13). Content-free — never a body, only the hash + scalar filters. The
 * dense/sparse vectors are injected from the bound embedding client (I/O upstream).
 */
export const agentLiveDoc = (doc: AgentDoc, vectors: ToolVectors): LiveDoc => ({
  canonicalId: doc.id,
  contentHash: doc.identity.content_hash,
  row: {
    canonicalId: doc.id,
    canonicalVersion: doc.identity.content_hash,
    dense: vectors.dense,
    terms: vectors.terms,
    filters: {
      projectId: doc.scope.project_id,
      scope: doc.scope.scope,
      visibility: doc.scope.visibility,
      permissionRef: doc.scope.permission_ref,
    },
  },
})

/**
 * Feature 019 / T008 (FR6) — project a sanitized `SkillDoc` into the generic
 * `LiveDoc` for the `skills`/`skill_chunks` collections. `SkillDoc` carries no
 * `DocScope`, so the mandatory partition `filters` are supplied by the caller (the
 * reconcile projection context) rather than read off the doc; the projection stays
 * content-free — only the canonical id, its content hash, and the injected vectors.
 */
export const skillLiveDoc = (doc: SkillDoc, vectors: ToolVectors, filters: MandatoryFilters): LiveDoc => ({
  canonicalId: doc.id,
  contentHash: doc.identity.content_hash,
  row: {
    canonicalId: doc.id,
    canonicalVersion: doc.identity.content_hash,
    dense: vectors.dense,
    terms: vectors.terms,
    filters,
  },
})

/**
 * Feature 050 / T019 (FR9) — project a sanitized `SkillChunkDoc` into the generic
 * `LiveDoc` for the `skill_chunks` collection, following `skillLiveDoc` exactly:
 * `SkillChunkDoc` carries no `DocScope` either, so the mandatory partition
 * `filters` are supplied by the caller (the reconcile projection context), never
 * read off the doc. Content-free — only the canonical chunk id, its content
 * hash, and the injected vectors; the chunk BODY lives in the `OutputSpool`
 * behind `body_ref`, never inlined here (FR8, `projection.ts:41`).
 */
export const skillChunkLiveDoc = (doc: SkillChunkDoc, vectors: ToolVectors, filters: MandatoryFilters): LiveDoc => ({
  canonicalId: doc.id,
  contentHash: doc.identity.content_hash,
  row: {
    canonicalId: doc.id,
    canonicalVersion: doc.identity.content_hash,
    dense: vectors.dense,
    terms: vectors.terms,
    filters,
  },
})

/** The injected Feature 005 OutputSpool sink; returns an opaque `OutputRef` for a bounded job log (FR40, C9). */
export interface OutputSpoolSink {
  readonly spool: (input: { readonly collection: CollectionKind; readonly summary: JobSummary }) => Effect.Effect<string>
}

/** Bounded, content-free job outcome (counts + the pinned binding version, never a body). */
export interface JobSummary {
  readonly upsertedCount: number
  readonly tombstonedCount: number
  readonly unchangedCount: number
  readonly bindingVersion: number
}

export interface IndexJobResult {
  readonly summary: JobSummary
  readonly outputRef: string
}

export interface IndexJobPorts {
  readonly milvus: MilvusPort
  readonly spool: OutputSpoolSink
}

/**
 * Run one collection's reconcile: plan by content hash, apply upserts and
 * tombstones to Milvus, spool the bounded log, and report the pinned binding
 * version UNCHANGED (a scheduled reconcile never re-pins the binding, FR13). A
 * Milvus gap propagates typed rather than crashing (C20).
 */
export const runReconcile = (
  deps: IndexJobPorts,
  input: {
    readonly collection: CollectionKind
    readonly live: readonly LiveDoc[]
    readonly indexed: readonly IndexedDoc[]
    readonly projectId: string
    readonly bindingVersion: number
  },
): Effect.Effect<IndexJobResult, MilvusGap> =>
  Effect.gen(function* () {
    const plan = planMutations(input.live, input.indexed)
    if (plan.upserts.length > 0) yield* deps.milvus.upsert({ collection: input.collection, rows: plan.upserts })
    if (plan.tombstones.length > 0) {
      yield* deps.milvus.tombstone({ collection: input.collection, canonicalIds: plan.tombstones, projectId: input.projectId })
    }
    const summary: JobSummary = {
      upsertedCount: plan.upserts.length,
      tombstonedCount: plan.tombstones.length,
      unchangedCount: plan.unchanged.length,
      bindingVersion: input.bindingVersion,
    }
    const outputRef = yield* deps.spool.spool({ collection: input.collection, summary })
    return { summary, outputRef }
  })
