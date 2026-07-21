/**
 * Feature 050 / T019 (FR9) — the production `LiveDocSource` for the
 * `agents`/`skills`/`skill_chunks` collections.
 *
 * Composes the Wave 1 pure builders (`AgentDocBuilder.build`, `SkillDocBuilder.build`,
 * `SkillChunker.chunkSkill`) with the injected embedding/spool seams to close the
 * "collect embeds everything before the diff runs" gap (`milvus-binding.ts:79-84`
 * `LiveDocSource`, `contracts/ports.ts`): a live doc's content hash is computed
 * FIRST (pure, zero I/O), and only a hash that differs from — or is absent from —
 * the currently indexed generation is ever handed to the embedding provider (FR9,
 * AC5). An unchanged doc still returns in the collected snapshot so
 * `IndexJobs.planMutations`'s content-hash diff can classify it "unchanged"
 * (`index-jobs.ts:52-65`, `Projection.decideMutation`) — that classification never
 * reads `.row`, so an unchanged doc's `row.dense`/`.terms` are deliberately empty
 * (`EMPTY_VECTORS` below); this is safe for an INCREMENTAL reconcile (the only
 * caller that passes real prior hashes through to `planMutations`). A CLI full
 * rebuild (`milvus-binding.ts`'s `runMaintenance(collection, true)`) instead
 * discards prior hashes and forces every live doc through the "upsert" branch —
 * on a profile that already has a live, non-empty generation, running that path
 * would read an unchanged doc's empty vector. This is a DOCUMENTED, pre-existing
 * seam boundary (the source cannot see the caller's `full` flag, and widening
 * `LiveDocSource.collect`'s signature a second time was explicitly out of scope
 * for this slice, see below) — not a regression this feature introduces, and it
 * does not manifest for a first-ever reindex of an empty profile (AC1), which is
 * the only full-rebuild scenario this feature's acceptance criteria cover.
 *
 * **Interface choice (documented, FR9 "extend minimally").** The shipped
 * `LiveDocSource.collect` signature (`milvus-binding.ts:79-84`) takes only
 * `{collection, projectId}` — no `indexedHashes` parameter. Rather than widening
 * that already-consumed interface a second time, `indexedHashes` is wired here as
 * a DEPENDENCY closure the composition root binds over the SAME `MilvusPort.
 * enumerateIndexed` `runMaintenance` already calls for its own upsert/tombstone
 * diff (`milvus-binding.ts:172-175`) — one extra read per collect, paid only to
 * decide the embed-skip, never exposed as a second port method.
 *
 * **Embedding text (a decision this feature makes, not inherited).** Neither
 * `AgentDoc`/`SkillDoc` nor the shipped pipeline carries a canonical "text to
 * embed" for a document — the query side embeds only the prompt
 * (`pipeline-runner.ts:103-113`). This module embeds the SAME sanitized
 * ranking-signal text the content hash already covers: `classification.
 * description` for agents, `descriptor.description` for skills, and the
 * sanitized chunk body for `skill_chunks` — never a raw/unsanitized body
 * (the forbidden-field guard, `projection.ts:41`).
 *
 * **Sparse terms.** The shipped query-time recall already passes
 * `sparseTerms: []` (`pipeline-runner.ts:124` — no BM25/sparse tokenizer exists
 * anywhere in this codebase yet); every row produced here carries `terms: []`
 * for the same reason, never a fabricated term list.
 */
export * as LiveDocSource from "./live-doc-source"

import { Effect } from "effect"
import { Projection } from "@opencode-ai/core/semantic/projection"
import { AgentDocBuilder } from "@opencode-ai/core/semantic/agent-doc"
import { SkillDocBuilder } from "@opencode-ai/core/semantic/skill-doc"
import { SkillChunker } from "@opencode-ai/core/semantic/skill-chunk"
import type { SkillChunkDoc } from "@opencode-ai/schema/semantic/documents"
import type { CollectionKind } from "@opencode-ai/protocol/semantic/commands"
import { IndexJobs } from "@/semantic/index-jobs"
import type { MandatoryFilters } from "@/semantic/milvus-adapter"
import type { OutputSpoolStore } from "@/semantic/output-spool-store"

/** One live skill's structural input — `SkillDocBuilder.SkillInfoLike` plus the optional Feature 004 language tag. */
export interface SkillSourceInput extends SkillDocBuilder.SkillInfoLike {
  /** Feature 004 Lang Lock tag when available; the chunker falls back to `"und"` when absent (honest floor). */
  readonly languageTag?: string
}

/** The `max_skill_chunks`/window-size budget the caller resolves from `schema/routing/budget.ts`. */
export interface ChunkingBudget {
  readonly maxChunks: number
  readonly chunkSizeTokens: number
  readonly overlapTokens: number
}

export interface LiveDocSourceDeps {
  /** The live agent pool, already mapped to the builder's minimal structural shape (never the full live registry type, C2). */
  readonly agents: () => Promise<readonly AgentDocBuilder.AgentInfoLike[]>
  /** The live skill pool, mapped the same way. */
  readonly skills: () => Promise<readonly SkillSourceInput[]>
  /** Embed already-sanitized ranking text, in call order; ONE call per changed batch, never per doc. */
  readonly embed: (texts: readonly string[]) => Promise<ReadonlyArray<readonly number[]>>
  readonly spool: OutputSpoolStore
  /**
   * The current generation's `{canonicalId -> contentHash}` map for one collection.
   * Absent, or a collection this closure declines, degrades to an empty map — the
   * honest "embed everything" floor, never a fabricated skip.
   */
  readonly indexedHashes?: (collection: CollectionKind) => Promise<ReadonlyMap<string, string>>
  readonly chunking: ChunkingBudget
  /** The mandatory scalar partition filters for a doc kind that carries no `DocScope` of its own (skills/skill_chunks). */
  readonly filters: (projectId: string) => MandatoryFilters
}

/** Mirrors `milvus-binding.ts:79-84` exactly — this feature does NOT widen the shipped `LiveDocSource` interface. */
export interface LiveDocSource {
  readonly collect: (input: {
    readonly collection: CollectionKind
    readonly projectId: string
  }) => Promise<readonly IndexJobs.LiveDoc[]>
}

/** Never a fabricated vector — read ONLY by the "unchanged" reconcile branch, which never inspects `.row` (`index-jobs.ts:57-62`). */
const EMPTY_VECTORS: IndexJobs.ToolVectors = { dense: [], terms: [] }

interface HashedEntry<TDoc> {
  readonly canonicalId: string
  readonly contentHash: string
  /** The already-sanitized ranking text this entry embeds when its hash is new/changed. */
  readonly embedText: string
  readonly doc: TDoc
}

/** Whether an entry's hash differs from (or is absent from) the indexed map — the single embed-skip decision (FR9). */
const isUnchanged = (indexedHashes: ReadonlyMap<string, string>, entry: HashedEntry<unknown>): boolean =>
  Projection.decideMutation(indexedHashes.get(entry.canonicalId) ?? null, entry.contentHash) === "unchanged"

/** Embed only the entries whose hash is new/changed; an all-unchanged batch makes ZERO embedding calls (AC5). */
async function embedChanged<TDoc>(
  entries: readonly HashedEntry<TDoc>[],
  indexedHashes: ReadonlyMap<string, string>,
  embed: LiveDocSourceDeps["embed"],
): Promise<ReadonlyMap<string, IndexJobs.ToolVectors>> {
  const changed = entries.filter((entry) => !isUnchanged(indexedHashes, entry))
  if (changed.length === 0) return new Map()
  const vectors = await embed(changed.map((entry) => entry.embedText))
  const out = new Map<string, IndexJobs.ToolVectors>()
  changed.forEach((entry, index) => out.set(entry.canonicalId, { dense: vectors[index] ?? [], terms: [] }))
  return out
}

const vectorsFor = (byCanonicalId: ReadonlyMap<string, IndexJobs.ToolVectors>, canonicalId: string): IndexJobs.ToolVectors =>
  byCanonicalId.get(canonicalId) ?? EMPTY_VECTORS

/** Build the production `LiveDocSource` over the injected agent/skill sources, embedding client, and chunk spool (FR9). */
export const createLiveDocSource = (deps: LiveDocSourceDeps): LiveDocSource => {
  const readIndexedHashes = async (collection: CollectionKind): Promise<ReadonlyMap<string, string>> =>
    deps.indexedHashes ? deps.indexedHashes(collection) : new Map()

  const collectAgents = async (projectId: string): Promise<readonly IndexJobs.LiveDoc[]> => {
    const [agents, indexedHashes] = await Promise.all([deps.agents(), readIndexedHashes("agents")])
    const entries = agents.map((agent): HashedEntry<ReturnType<typeof AgentDocBuilder.build>> => {
      const doc = AgentDocBuilder.build(agent, { projectId })
      return { canonicalId: doc.id, contentHash: doc.identity.content_hash, embedText: doc.classification.description, doc }
    })
    const vectorsById = await embedChanged(entries, indexedHashes, deps.embed)
    return entries.map((entry) => IndexJobs.agentLiveDoc(entry.doc, vectorsFor(vectorsById, entry.canonicalId)))
  }

  const collectSkills = async (projectId: string): Promise<readonly IndexJobs.LiveDoc[]> => {
    const [skills, indexedHashes] = await Promise.all([deps.skills(), readIndexedHashes("skills")])
    const filters = deps.filters(projectId)
    const entries = skills.map((skill): HashedEntry<ReturnType<typeof SkillDocBuilder.build>> => {
      const doc = SkillDocBuilder.build(skill)
      return { canonicalId: doc.id, contentHash: doc.identity.content_hash, embedText: doc.descriptor.description, doc }
    })
    const vectorsById = await embedChanged(entries, indexedHashes, deps.embed)
    return entries.map((entry) => IndexJobs.skillLiveDoc(entry.doc, vectorsFor(vectorsById, entry.canonicalId), filters))
  }

  /** Chunk every live skill, spool each sanitized chunk body, then apply the SAME embed-skip decision per chunk. */
  const collectSkillChunks = async (projectId: string): Promise<readonly IndexJobs.LiveDoc[]> => {
    const [skills, indexedHashes] = await Promise.all([deps.skills(), readIndexedHashes("skill_chunks")])
    const filters = deps.filters(projectId)
    const chunkResults = skills.flatMap((skill) =>
      SkillChunker.chunkSkill({
        parentSkillId: skill.name,
        body: skill.content,
        languageTag: skill.languageTag,
        maxChunks: deps.chunking.maxChunks,
        chunkSizeTokens: deps.chunking.chunkSizeTokens,
        overlapTokens: deps.chunking.overlapTokens,
        // The spool's own outputRef is deterministically the content hash too (`output-spool-store.ts`
        // `channelKeyFor`), so the doc's `body_ref.output_ref` always matches what `put` actually writes.
        mintRef: (_chunkIndex, contentHash) => contentHash,
      }),
    )
    // Every chunk's sanitized body is written through the spool BEFORE the embed-skip decision. The
    // write is content-hash-keyed/idempotent (`output-spool-store.ts` `generationFor`), so re-putting an
    // unchanged chunk on a later run is a safe no-op, never a duplicate entry (data-model.md `#SpoolEntry`).
    for (const result of chunkResults) {
      await Effect.runPromise(
        deps.spool.put({
          parentSkillId: result.doc.parent_skill_id,
          chunkIndex: result.doc.position.chunk_index,
          contentHash: result.doc.identity.content_hash,
          sanitizedBody: result.sanitizedBody,
        }),
      )
    }
    const entries: HashedEntry<SkillChunkDoc>[] = chunkResults.map((result) => ({
      canonicalId: result.doc.id,
      contentHash: result.doc.identity.content_hash,
      embedText: result.sanitizedBody,
      doc: result.doc,
    }))
    const vectorsById = await embedChanged(entries, indexedHashes, deps.embed)
    return entries.map((entry) => IndexJobs.skillChunkLiveDoc(entry.doc, vectorsFor(vectorsById, entry.canonicalId), filters))
  }

  return {
    collect: (input) => {
      switch (input.collection) {
        case "agents":
          return collectAgents(input.projectId)
        case "skills":
          return collectSkills(input.projectId)
        case "skill_chunks":
          return collectSkillChunks(input.projectId)
        default:
          // Feature 009 owns the `tools` collection's own live-doc wiring; this source is scoped to
          // agents/skills/skill_chunks only (FR9, plan.md component #5) — never a fabricated snapshot.
          return Promise.reject(
            new Error(`createLiveDocSource: collection "${input.collection}" is not produced by this source`),
          )
      }
    },
  }
}
