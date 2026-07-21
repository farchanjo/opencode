/**
 * Feature 050 / T019 (FR9) — the production `LiveDocSource` for the
 * `agents`/`skills`/`skill_chunks`/`tools` collections.
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
 * caller that passes real prior hashes through to `planMutations`).
 *
 * **Full rebuild embeds EVERY doc (C2 fix).** A CLI full rebuild
 * (`milvus-binding.ts`'s `runMaintenance(collection, true)`) discards prior hashes
 * and forces every live doc through the "upsert" branch. Because content hashes are
 * model-INDEPENDENT, an unchanged hash on a provider switch would otherwise carry an
 * empty vector into the fresh generation and corrupt it. `collect` therefore takes a
 * `full` flag (threaded from `runMaintenance`): a full rebuild disables the embed-skip
 * entirely (`readIndexedHashes` returns an empty map), so EVERY doc is re-embedded into
 * the new space. An incremental reconcile keeps the hash-skip (AC5).
 *
 * **`indexedHashes` wiring (FR9).** The embed-skip reads the currently indexed
 * `{canonicalId -> contentHash}` map as a DEPENDENCY closure the composition root binds
 * over the SAME `MilvusPort.enumerateIndexed` `runMaintenance` already calls for its own
 * upsert/tombstone diff (`milvus-binding.ts:172-175`) — one extra read per incremental
 * collect, paid only to decide the embed-skip, never exposed as a second port method.
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
import type { CollectionKind, ToolProjectionInput } from "@opencode-ai/protocol/semantic/commands"
import { IndexJobs } from "@/semantic/index-jobs"
import { ToolProjection } from "@/semantic/tool-projection"
import type { MandatoryFilters } from "@/semantic/milvus-adapter"
import type { OutputSpoolStore } from "@/semantic/output-spool-store"

/** One live skill's structural input — `SkillDocBuilder.SkillInfoLike` plus the optional Feature 004 language tag. */
export interface SkillSourceInput extends SkillDocBuilder.SkillInfoLike {
  /** Feature 004 Lang Lock tag when available; the chunker falls back to `"und"` when absent (honest floor). */
  readonly languageTag?: string
}

/**
 * One live tool descriptor projected into the `tools` collection (Feature 009 / FR11). `toolId` is the
 * EXACT runtime tool-record key (`registry.tools()` item id for native/plugin, `mcp.tools()` key for
 * MCP) — the `feature050-tool-id-equality` invariant. `rawParameterSchema` is the native `tool.jsonSchema`
 * / MCP `inputSchema`; `ToolProjection.project` sanitizes it (names/types/descriptions allowlist) before
 * anything reaches the index — the raw schema is never stored.
 */
export interface ToolSourceInput {
  readonly toolId: string
  readonly displayName: string
  readonly rawDescription: string
  readonly rawParameterSchema: unknown
  readonly source: "native" | "mcp" | "custom" | "plugin"
  readonly mcpServerRef?: string
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
  /** The live tool descriptors (native/plugin/custom + MCP), keyed by their EXACT runtime id (FR11). */
  readonly tools?: () => Promise<readonly ToolSourceInput[]>
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

export interface LiveDocSource {
  readonly collect: (input: {
    readonly collection: CollectionKind
    readonly projectId: string
    /**
     * Feature 050 (C2 fix) — a FULL rebuild embeds EVERY live doc: the embed-skip is
     * disabled so an unchanged-hash doc never carries an empty vector into a fresh
     * generation (hashes are model-independent, so a provider switch would otherwise
     * corrupt the new space). An incremental reconcile (`full` unset/false) keeps the
     * hash-skip. `runMaintenance` passes this flag (`milvus-binding.ts`).
     */
    readonly full?: boolean
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
  // A full rebuild forces an empty indexed map so EVERY live doc embeds (C2 fix); an incremental
  // reconcile reads the real indexed hashes so an unchanged doc skips the embed call (FR9, AC5).
  const readIndexedHashes = async (collection: CollectionKind, full: boolean): Promise<ReadonlyMap<string, string>> =>
    full || !deps.indexedHashes ? new Map() : deps.indexedHashes(collection)

  const collectAgents = async (projectId: string, full: boolean): Promise<readonly IndexJobs.LiveDoc[]> => {
    const [agents, indexedHashes] = await Promise.all([deps.agents(), readIndexedHashes("agents", full)])
    const entries = agents.map((agent): HashedEntry<ReturnType<typeof AgentDocBuilder.build>> => {
      const doc = AgentDocBuilder.build(agent, { projectId })
      return { canonicalId: doc.id, contentHash: doc.identity.content_hash, embedText: doc.classification.description, doc }
    })
    const vectorsById = await embedChanged(entries, indexedHashes, deps.embed)
    return entries.map((entry) => IndexJobs.agentLiveDoc(entry.doc, vectorsFor(vectorsById, entry.canonicalId)))
  }

  const collectSkills = async (projectId: string, full: boolean): Promise<readonly IndexJobs.LiveDoc[]> => {
    const [skills, indexedHashes] = await Promise.all([deps.skills(), readIndexedHashes("skills", full)])
    const filters = deps.filters(projectId)
    const entries = skills.map((skill): HashedEntry<ReturnType<typeof SkillDocBuilder.build>> => {
      const doc = SkillDocBuilder.build(skill)
      return { canonicalId: doc.id, contentHash: doc.identity.content_hash, embedText: doc.descriptor.description, doc }
    })
    const vectorsById = await embedChanged(entries, indexedHashes, deps.embed)
    return entries.map((entry) => IndexJobs.skillLiveDoc(entry.doc, vectorsFor(vectorsById, entry.canonicalId), filters))
  }

  /** Chunk every live skill, spool each sanitized chunk body, then apply the SAME embed-skip decision per chunk. */
  const collectSkillChunks = async (projectId: string, full: boolean): Promise<readonly IndexJobs.LiveDoc[]> => {
    const [skills, indexedHashes] = await Promise.all([deps.skills(), readIndexedHashes("skill_chunks", full)])
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

  /**
   * Feature 009 (FR11) — project every live tool descriptor into a `ToolDoc` (sanitized, content-hashed)
   * and embed each description under the SAME embed-skip + full-rebuild semantics as the other collections.
   * `toolLiveDoc` reads the `ToolDoc`'s own `DocScope` for its partition filters (unlike skills, whose
   * scope is caller-supplied), so the scope is derived once from `deps.filters` and stamped on every doc.
   */
  const collectTools = async (projectId: string, full: boolean): Promise<readonly IndexJobs.LiveDoc[]> => {
    if (deps.tools === undefined) {
      return Promise.reject(new Error('createLiveDocSource: no tools source configured for the "tools" collection'))
    }
    const [tools, indexedHashes] = await Promise.all([deps.tools(), readIndexedHashes("tools", full)])
    const filters = deps.filters(projectId)
    const scope = {
      project_id: projectId,
      scope: filters.scope,
      visibility: filters.visibility,
      permission_ref: filters.permissionRef ?? `perm:tools:${projectId}`,
    } as unknown as ToolProjectionInput["scope"]
    const entries = tools.map((tool): HashedEntry<ReturnType<typeof ToolProjection.project>["doc"]> => {
      const { doc } = ToolProjection.project({
        source: tool.source,
        toolId: tool.toolId as ToolProjectionInput["toolId"],
        displayName: tool.displayName,
        ...(tool.mcpServerRef ? { mcpServerRef: tool.mcpServerRef } : {}),
        rawDescription: tool.rawDescription,
        rawParameterSchema: tool.rawParameterSchema,
        scope,
        languageTag: tool.languageTag ?? "und",
      })
      return { canonicalId: doc.id, contentHash: doc.identity.content_hash, embedText: doc.descriptor.description, doc }
    })
    const vectorsById = await embedChanged(entries, indexedHashes, deps.embed)
    return entries.map((entry) => IndexJobs.toolLiveDoc(entry.doc, vectorsFor(vectorsById, entry.canonicalId)))
  }

  return {
    collect: (input) => {
      const full = input.full === true
      switch (input.collection) {
        case "agents":
          return collectAgents(input.projectId, full)
        case "skills":
          return collectSkills(input.projectId, full)
        case "skill_chunks":
          return collectSkillChunks(input.projectId, full)
        case "tools":
          return collectTools(input.projectId, full)
        default:
          // Never a fabricated snapshot for a collection this source does not own.
          return Promise.reject(
            new Error(`createLiveDocSource: collection "${input.collection}" is not produced by this source`),
          )
      }
    },
  }
}
