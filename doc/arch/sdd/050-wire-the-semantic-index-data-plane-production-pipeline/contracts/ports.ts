/**
 * Feature 050 — Application Ports (Wire The Semantic Index Data Plane
 * Production Pipeline)
 *
 * These are DOCUMENTATION-ONLY contract sketches, mirroring the style of
 * `doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/
 * contracts/ports.ts`. Feature 050 defines NO new schema/protocol authority —
 * every existing interface it implements or extends (`PipelineRunnerPort`,
 * `EmbeddingsHttpPort`, `LiveDocSource`, `MilvusPort`) is already owned by
 * Feature 006/009/019 (`packages/opencode/src/semantic/retrieval-facade.ts`,
 * `embedding-client.ts`, `packages/opencode/src/operator/semantic/
 * milvus-binding.ts`). This file records the PRODUCTION implementation
 * surface this feature adds over those interfaces, plus the two genuinely
 * new ports (`OutputSpoolStore`, `ReconcileLock`) this feature introduces.
 *
 * Zero live-turn behavior change (FR13): every port here is called only from
 * `embedding-reindex`, scheduled/discovery-time reconcile, and CLI
 * verification commands — never from a live session/turn code path.
 */

import type { Effect } from "effect"

// =============================================================================
// PipelineRunnerPort — the production implementation surface (FR1, FR2, FR3, FR4)
// Interface already declared at packages/opencode/src/semantic/retrieval-facade.ts:87-92.
// This feature adds the ONE production constructor implementing it.
// =============================================================================

/** Opaque handles reused verbatim from the shipped protocol/schema modules — never redefined here. */
type RetrievalRequest = unknown // @opencode-ai/protocol/semantic/commands RetrievalRequest
type SkillRetrievalRequest = unknown // @opencode-ai/protocol/semantic/commands SkillRetrievalRequest
type ToolRetrievalRequest = unknown // @opencode-ai/protocol/semantic/commands ToolRetrievalRequest
type PipelineOutcome = unknown // retrieval-facade.ts PipelineOutcome
type ToolPipelineOutcome = unknown // retrieval-facade.ts ToolPipelineOutcome
type LatencyBudgetMs = number // config/experimental.ts:62 latencyBudgetMs, consumed not redefined

/**
 * Composition-root dependencies the production runner binds over — every one
 * of these is an EXISTING seam, never a new I/O client:
 *  - `milvus`: the shared composition helper's port (see `MilvusPortComposer`
 *    below), never a second `createGrpcMilvusAdapter` construction.
 *  - `embeddings`: the first production `EmbeddingsHttpPort` impl (below).
 *  - `rerank`: the EXISTING `RerankClient.rerankNative`/`rerankStructured`
 *    (`packages/opencode/src/semantic/rerank-client.ts`), unchanged.
 *  - `registry`: read-only access to the CURRENT active embedding/rerank
 *    bindings (config-backed semantic registry, `registry-backend.ts`).
 *  - `agentRegistry`/`skillRegistry`: the live `AgentV2.Service`/`SkillV2.Service`
 *    used for FR2's own agent-revalidation pass, reusing the SAME
 *    `agent.get`/permission check the facade's callers already trust.
 *  - `latencyBudgetMs`: the EXISTING `config/experimental.ts:62` knob, read
 *    once per runner instance, never a new constant.
 */
export interface PipelineRunnerDeps {
  readonly milvus: unknown // MilvusPort, from MilvusPortComposer.compose(...)
  readonly embeddings: EmbeddingsHttpPort
  readonly rerank: unknown // RerankClient ports, unchanged from Feature 006
  readonly registry: unknown // read-only active-binding accessor
  readonly agentRegistry: unknown // AgentV2.Service (get + permission check, FR2)
  readonly skillRegistry: unknown // SkillV2.Service
  readonly latencyBudgetMs: LatencyBudgetMs
}

/**
 * `createProductionPipelineRunner` builds the `PipelineRunnerPort` the facade
 * (`retrieval-facade.ts:99-102`, `RetrievalFacadeDeps.pipeline`) consumes.
 * `runAgents`/`runSkills` embed the prompt ONCE (`EmbeddingClient.embed`),
 * build `PipelinePorts` (`pipeline.ts:69-85`: `recall` → `MilvusPort.search`,
 * `rerank` → `RerankClient`), and call `Pipeline.run` (FR1). `runTools` calls
 * `ToolPass.run` (`tool-pass.ts:120`) instead — never `Pipeline.run` (FR1).
 *
 * FR2 (own agent revalidation): after `Pipeline.run` returns, `runAgents`
 * re-checks every ranked agent id against `deps.agentRegistry.get(id)` +
 * permission before the OUTCOME's `effective`/candidate rows are handed back
 * to the facade — a dead hit is dropped here, BEFORE the facade's
 * `revalidated: true` stamp (`retrieval-facade.ts:123`) is applied, so that
 * stamp becomes earned for the agents surface too (today it is unconditional).
 *
 * FR3 (real deadline): each of `runAgents`/`runSkills`/`runTools` wraps its
 * `Pipeline.run`/`ToolPass.run` call in `Effect.timeout(deps.latencyBudgetMs)`
 * — NOT the facade's current post-hoc `catch: () => ({type:"timeout"})`
 * relabeling (`retrieval-facade.ts:192,206,226`), which stays as a secondary
 * safety net for a non-timeout rejection.
 */
export function createProductionPipelineRunner(deps: PipelineRunnerDeps): {
  readonly runAgents: (request: RetrievalRequest) => Promise<PipelineOutcome>
  readonly runSkills: (request: SkillRetrievalRequest) => Promise<PipelineOutcome>
  readonly runTools: (request: ToolRetrievalRequest) => Promise<ToolPipelineOutcome>
} {
  throw new Error("contract sketch only — implemented in packages/opencode/src/semantic/pipeline-runner.ts")
}

// =============================================================================
// EmbeddingsHttpPort — first production implementation (FR5)
// Interface already declared at packages/opencode/src/semantic/embedding-client.ts:34-36.
// =============================================================================

export interface EmbeddingsRequest {
  readonly baseUrl: string
  readonly model: string
  readonly inputs: readonly string[]
}

export interface EmbeddingsResponse {
  readonly vectors: ReadonlyArray<readonly number[]>
  readonly maxBatchSize?: number
  readonly maxInputTokens?: number
}

/** Mirrors `embedding-client.ts:34-36` exactly — the seam this feature FIRST implements in production. */
export interface EmbeddingsHttpPort {
  readonly postEmbeddings: (request: EmbeddingsRequest) => Promise<EmbeddingsResponse>
}

/**
 * `createFetchEmbeddingsHttpClient` follows the `createFetchRerankHttpClient`
 * transport shape (`rerank-probe.ts:154-164`) exactly: POST JSON, one resolved
 * Authorization header, no retry inside the raw transport (retry is composed
 * OUTSIDE at the call site per FR12, extending `withTransientReadRetry`'s
 * pattern — `util/effect-http-client.ts:4-11` — never inlined here a third
 * time). The Authorization header is resolved EXCLUSIVELY through
 * `semantic/credential-resolver.ts` (`resolvePolicy`, `:36-40`); `secretRef:
 * null` (the solaris P0 default) produces NO header, never an empty-string
 * placeholder.
 */
export function createFetchEmbeddingsHttpClient(deps: {
  readonly fetchImpl?: typeof fetch
  readonly resolveAuthHeader: (secretRef: string | null) => Promise<string | null>
}): EmbeddingsHttpPort {
  throw new Error("contract sketch only — implemented in packages/opencode/src/semantic/embeddings-http-client.ts")
}

// =============================================================================
// Shared Milvus-port composition helper (FR4) — extracted from
// packages/opencode/src/operator/stack-live.ts:576-610, the ONE existing
// construction site. Both stack-live.ts and pipeline-runner.ts call this
// helper; neither constructs a MilvusAdapter directly anymore.
// =============================================================================

export interface MilvusCompositionConfig {
  readonly address: string
  readonly ssl: boolean
  readonly authorization?: string
}

export interface MilvusPortComposer {
  /** Builds the SAME `createGrpcMilvusAdapter(createHttpMilvusClient(...))` chain `stack-live.ts:580-587` builds today. */
  readonly compose: (config: MilvusCompositionConfig) => unknown // MilvusPort
}

export declare const MilvusPortComposer: MilvusPortComposer

// =============================================================================
// LiveDocSource — extended `collect` signature (FR9)
// Interface already declared at packages/opencode/src/operator/semantic/
// milvus-binding.ts:79-84. This feature EXTENDS the signature (breaking
// change to the interface, additive to every call site) and supplies the
// first real implementation for agents/skills/skill_chunks.
// =============================================================================

/** A live-core document projected to its content hash and mandatory scalar fields (index-jobs.ts:28-32, unchanged). */
interface LiveDoc {
  readonly canonicalId: string
  readonly contentHash: string
  readonly row: unknown // DocumentRow, milvus-adapter.ts:59-65, unchanged
}

/**
 * EXTENDED from `milvus-binding.ts:79-84`: adds `indexedHashes`, the
 * `{canonicalId → contentHash}` map for the CURRENTLY indexed generation
 * (sourced from `MilvusPort.enumerateIndexed`, already called at
 * `milvus-binding.ts:172-175`). `collect` MUST skip embedding a live doc
 * whose computed content hash equals `indexedHashes.get(canonicalId)` —
 * closing the "collect lacks prior hashes" gap (`research.md`): today the
 * hash-diff (`index-jobs.ts:59`, `Projection.decideMutation`) only skips the
 * Milvus upsert, never the embedding call, because `collect` embeds
 * everything BEFORE the diff ever runs.
 */
export interface LiveDocSource {
  readonly collect: (input: {
    readonly collection: "agents" | "skills" | "skill_chunks" | "tools"
    readonly projectId: string
    /** NEW (FR9): the current generation's indexed content hashes, keyed by canonical id. */
    readonly indexedHashes: ReadonlyMap<string, string>
  }) => Promise<readonly LiveDoc[]>
}

/**
 * `createLiveDocSource` is the first real implementation, composing:
 *  - `agents` → `AgentV2.Service.all()` → `agent-doc.ts` builder → skip-if-hash-unchanged → `EmbeddingClient.embed`
 *  - `skills` → `SkillV2.Service.list()` → `skill-doc.ts` builder → same skip → embed
 *  - `skill_chunks` → `SkillV2.Service.list()` → `skill-chunk.ts` chunker → `OutputSpoolStore.put` → same skip → embed
 * A missing embedding provider MUST reject rather than fabricate a vector
 * (mirrors the existing honest-gap comment at `milvus-binding.ts:76-77`).
 */
export function createLiveDocSource(deps: {
  readonly agents: unknown // AgentV2.Service
  readonly skills: unknown // SkillV2.Service
  readonly embeddings: EmbeddingsHttpPort
  readonly spool: OutputSpoolStore
}): LiveDocSource {
  throw new Error("contract sketch only — implemented in packages/opencode/src/semantic/live-doc-source.ts")
}

// =============================================================================
// OutputSpoolStore — the real Feature 005 OutputSpool composition for skill
// chunk bodies (FR8). Composes the EXISTING `SpoolWriterPort`
// (open/append/seal, packages/protocol/src/outputspool/ports.ts:70-82) and
// `SpoolReaderPort` (stat/read/follow, `:90-99`) — this is not a new spool
// implementation, it is a narrow chunk-body-shaped facade over the shipped
// Feature 005 producer/reader API. Replaces the non-resolvable
// `boundedSpool` stub (`milvus-binding.ts:116-118`).
// =============================================================================

export interface OutputSpoolPutInput {
  readonly parentSkillId: string
  readonly chunkIndex: number
  readonly contentHash: string
  /** The ALREADY-SANITIZED chunk body bytes (post `Projection.scrubText`); never raw file content. */
  readonly sanitizedBody: string
}

export interface OutputSpoolPutResult {
  readonly outputRef: string
  readonly offset: number
  readonly limit: number
  readonly byteLength: number
}

export interface OutputSpoolResolveResult {
  readonly body: string
  readonly contentHash: string
}

/**
 * The chunk-spool store the chunker writes through and Feature 052 (not this
 * feature) will read through. `put` opens a new generation via
 * `SpoolWriterPort.open`, appends the sanitized body, and seals it — one
 * `SpoolEntry` per chunk, content-hash-keyed alongside the owning
 * `SkillChunkDoc` (`data-model.md` `#SpoolEntry`). `supersede` opens a FRESH
 * generation for a changed chunk and lets the prior one age out through
 * Feature 005's existing `RetentionPort.release`/`cleanup` — never an
 * in-place mutation of sealed bytes (Feature 005 immutability contract).
 */
export interface OutputSpoolStore {
  readonly put: (input: OutputSpoolPutInput) => Effect.Effect<OutputSpoolPutResult, { readonly type: "spool_unavailable"; readonly reason: string }>
  readonly resolve: (ref: string) => Effect.Effect<OutputSpoolResolveResult, { readonly type: "not_found" | "spool_unavailable"; readonly reason?: string }>
  /** Marks the prior generation's SpoolEntry superseded/reclaimable; the NEW `put` result's ref replaces `body_ref` on the chunk doc. */
  readonly supersede: (priorRef: string) => Effect.Effect<void, { readonly type: "spool_unavailable"; readonly reason: string }>
}

// =============================================================================
// DimensionProbe — the model-driven discovery ladder (FR6)
// Wraps the EXISTING EmbeddingClient.probe (embedding-client.ts:67-87) and
// the extended rerank-probe.ts validate probe; this is the seam
// registry-backend.ts:696-702's generationVectorSpace calls instead of
// returning `deps.defaultDimension ?? 1024`.
// =============================================================================

export interface ProbedVectorSpace {
  readonly dimension: number
  readonly metric: "cosine" | "inner-product" // aligned to the SHIPPED enum, never the CUE "ip" shorthand at the boundary
  readonly normalized: boolean
  readonly probedAt: string
  readonly source: "live-probe" | "metadata-crosscheck"
}

/** A typed refusal — NEVER a fallback dimension. Fail-closed per FR6 rung 3. */
export type DimensionProbeRefusal =
  | { readonly type: "probe_failed"; readonly reason: string }
  | { readonly type: "no_cached_dimension" }

/**
 * `probe` runs the three-rung ladder in order: (1) `EmbeddingClient.probe`
 * against the bound model (authoritative); (2) on probe failure, a cached
 * previously-probed dimension for the SAME model/binding version if one
 * exists; (3) `ModelsDev.Service` metadata cross-check (warn-only, never
 * authoritative, skipped silently offline). A probe failure with NO cached
 * value REFUSES — `generationVectorSpace` must propagate this refusal as a
 * failed `planReindexEmbedding` effect, never a `1024` default.
 */
export interface DimensionProbe {
  readonly probe: (input: {
    readonly baseUrl: string
    readonly model: string
    readonly cached?: ProbedVectorSpace
  }) => Effect.Effect<ProbedVectorSpace, DimensionProbeRefusal>
}

// =============================================================================
// ReconcileLock — per-profile single-writer serialization (FR10)
// New primitive; no existing lock to extend (research.md "Reconcile/rebuild
// race — verified no existing lock"). CAS-guarded the same way
// registry-backend.ts already guards the binding document.
// =============================================================================

export type ReconcileLockError =
  | { readonly type: "held"; readonly holder: string; readonly acquiredAt: string }
  | { readonly type: "unavailable"; readonly reason: string }

export interface ReconcileLockHandle {
  readonly holder: string
  readonly acquiredAt: string
  readonly release: () => Effect.Effect<void, never>
}

/**
 * `acquire` is used by BOTH an incremental reconcile and a full blue/green
 * rebuild for the SAME profile before either touches Milvus; whichever calls
 * first wins, the other fails `{type: "held"}` and the CALLER decides
 * (reconcile: skip this run, retried next trigger; rebuild: fail the
 * operator command with a clear "reconcile in progress" reason — never
 * silently proceed unlocked). `release` is idempotent.
 */
export interface ReconcileLock {
  readonly acquire: (input: { readonly profileId: string; readonly holder: string }) => Effect.Effect<ReconcileLockHandle, ReconcileLockError>
}
