/**
 * Feature 006 — Semantic retrieval application ports (T014).
 *
 * TypeScript mirror of the `ProviderPort`, `ModelPort`, `BindingPort`, `IndexPort`,
 * `RetrievalPort` and `EvalPort` inbound-port interfaces from
 * doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/contracts/ports.ts.
 * These interfaces are implemented by the domain retrieval engine
 * (`packages/core/src/semantic/**`) and application adapters
 * (`packages/opencode/src/semantic/**`, `packages/opencode/src/operator/semantic/**`),
 * and are consumed by Feature 001 (Architect/Manager candidate retrieval, never route
 * or permission authority) and Feature 007 (sole management authority for the reserved
 * `semantic.*` catalog at `RESERVED_CATALOG_VERSION = "1.3.0"`). Milvus, the embedding
 * provider and the reranker are a derived projection/index only (FR1, FR2, C15).
 *
 * Request/response payloads, the reconciled closed enums (sourced from
 * `@opencode-ai/schema/semantic/*`), the 12-member event vocabulary, and the typed
 * error unions live in ./commands — this file defines only the port method signatures.
 */

import type { Effect } from "effect"
import type {
  AddProviderInput,
  AddProviderOutput,
  BindingError,
  BindingHistoryInput,
  BindingHistoryOutput,
  BindingStatusInput,
  BindingStatusOutput,
  CutoverEmbeddingInput,
  CutoverEmbeddingOutput,
  CutoverRerankerInput,
  CutoverRerankerOutput,
  DeleteProviderInput,
  DeleteProviderOutput,
  DisableModelInput,
  DisableModelOutput,
  DisableProviderInput,
  DisableProviderOutput,
  DiscoverModelsInput,
  DiscoverModelsOutput,
  EvalError,
  EvalReport,
  IndexError,
  IndexReconcileInput,
  IndexReconcileOutput,
  IndexReindexInput,
  IndexReindexOutput,
  IndexStatusInput,
  IndexStatusOutput,
  IndexTestInput,
  IndexTestOutput,
  ListModelsInput,
  ListModelsOutput,
  ListProvidersInput,
  ListProvidersOutput,
  ModelError,
  ProviderError,
  RegisterModelInput,
  RegisterModelOutput,
  ReindexEmbeddingInput,
  ReindexEmbeddingOutput,
  RetrievalError,
  RetrievalRequest,
  RetrievalResult,
  RollbackBindingInput,
  RollbackBindingOutput,
  RotateSecretInput,
  RotateSecretOutput,
  RunGoldenInput,
  SelectBindingInput,
  SelectBindingOutput,
  ShowBindingInput,
  ShowBindingOutput,
  ShowCollectionsInput,
  ShowCollectionsOutput,
  SkillRetrievalRequest,
  TestProviderInput,
  TestProviderOutput,
  ToolIndexError,
  ToolIndexFlushInput,
  ToolIndexFlushOutput,
  ToolPipelineOutcome,
  ToolProjectionInput,
  ToolProjectionOutput,
  ToolReindexTriggerEvent,
  ToolRetrievalError,
  ToolRetrievalRequest,
  ToolRetrievalResult,
  ToolSearchConfigError,
  ToolSearchSurface,
  ToolSearchSurfaceConfig,
  UpdateProviderInput,
  UpdateProviderOutput,
  ValidateBindingInput,
  ValidateBindingOutput,
  ValidateModelInput,
  ValidateModelOutput,
} from "./commands"

/**
 * Backs the reserved `semantic.provider.list|add|update|test|disable|delete|
 * rotate-secret` operator commands, registered via Feature 007. Every mutation
 * requires an operator principal, explicit scope, version/CAS and audit;
 * `delete`/`disable`-when-bound and `rotate-secret` additionally require interactive
 * confirmation (FR31, FR35, C15).
 */
export interface ProviderPort {
  readonly list: (input: ListProvidersInput) => Effect.Effect<ListProvidersOutput, ProviderError>
  readonly add: (input: AddProviderInput) => Effect.Effect<AddProviderOutput, ProviderError>
  readonly update: (input: UpdateProviderInput) => Effect.Effect<UpdateProviderOutput, ProviderError>
  /** Fixed native probe only (no conversation/transcript/tools); cost/data disclosure required (FR33). */
  readonly test: (input: TestProviderInput) => Effect.Effect<TestProviderOutput, ProviderError>
  readonly disable: (input: DisableProviderInput) => Effect.Effect<DisableProviderOutput, ProviderError>
  /** Requires confirmation when the profile backs a bound model; never orphans silently (FR31). */
  readonly delete: (input: DeleteProviderInput) => Effect.Effect<DeleteProviderOutput, ProviderError>
  /** Changes `secretRef`/version only; endpoint/model/binding identity is unchanged (FR31, C19). */
  readonly rotateSecret: (input: RotateSecretInput) => Effect.Effect<RotateSecretOutput, ProviderError>
}

/**
 * Backs the reserved `semantic.model.list|discover|register|validate|disable`
 * operator commands. A manually registered model is untrusted until native probe/eval
 * passes — there is no trust window (FR30, C16). Rerank capability is NEVER inferred
 * from a `/v1/models` name alone.
 */
export interface ModelPort {
  readonly list: (input: ListModelsInput) => Effect.Effect<ListModelsOutput, ModelError>
  /** Calls `/v1/models` when the provider supports discovery (FR29). */
  readonly discover: (input: DiscoverModelsInput) => Effect.Effect<DiscoverModelsOutput, ModelError>
  /** Manual registration; `probeState` starts `declared` and is ineligible for binding selection until validated (FR30, C16). */
  readonly register: (input: RegisterModelInput) => Effect.Effect<RegisterModelOutput, ModelError>
  /** Native deterministic probe/eval: `/v1/embeddings` sample or the declared rerank profile A/B (FR30, C5, C16). */
  readonly validate: (input: ValidateModelInput) => Effect.Effect<ValidateModelOutput, ModelError>
  readonly disable: (input: DisableModelInput) => Effect.Effect<DisableModelOutput, ModelError>
}

/**
 * Backs the reserved `semantic.embedding.*`, `semantic.reranker.*` and
 * `semantic.binding.*` operator commands. Binding mutation happens only via
 * `selectEmbedding`/`cutoverEmbedding` and `selectReranker`/`cutoverReranker`;
 * `status`/`history` are read-only. `select`/`reindex`/`validate` alone NEVER activate
 * the live alias — only `cutover` under CAS and interactive confirmation does (FR32,
 * C12).
 */
export interface BindingPort {
  readonly showEmbedding: (input: ShowBindingInput) => Effect.Effect<ShowBindingOutput, BindingError>
  /** Stages a candidate embedding binding version without activating the live alias (FR32, C12). */
  readonly selectEmbedding: (input: SelectBindingInput) => Effect.Effect<SelectBindingOutput, BindingError>
  readonly validateEmbedding: (input: ValidateBindingInput) => Effect.Effect<ValidateBindingOutput, BindingError>
  /** Full blue/green reindex into a new collection generation on dimension/vector-space change (FR12, FR32, C12). */
  readonly reindexEmbedding: (input: ReindexEmbeddingInput) => Effect.Effect<ReindexEmbeddingOutput, BindingError>
  /** Atomically swaps the live alias for every collection in the generation under CAS + confirmation (FR32, C12). */
  readonly cutoverEmbedding: (input: CutoverEmbeddingInput) => Effect.Effect<CutoverEmbeddingOutput, BindingError>
  readonly rollbackEmbedding: (input: RollbackBindingInput) => Effect.Effect<RollbackBindingOutput, BindingError>

  readonly showReranker: (input: ShowBindingInput) => Effect.Effect<ShowBindingOutput, BindingError>
  /** Stages a candidate reranker binding version; no re-embedding by default (FR32). */
  readonly selectReranker: (input: SelectBindingInput) => Effect.Effect<SelectBindingOutput, BindingError>
  /** Runs multilingual/golden validation for the candidate reranker profile (FR32, C16). */
  readonly validateReranker: (input: ValidateBindingInput) => Effect.Effect<ValidateBindingOutput, BindingError>
  /** Activates the new reranker binding version under CAS + confirmation; invalidates rerank cache/eval version (FR32). */
  readonly cutoverReranker: (input: CutoverRerankerInput) => Effect.Effect<CutoverRerankerOutput, BindingError>
  readonly rollbackReranker: (input: RollbackBindingInput) => Effect.Effect<RollbackBindingOutput, BindingError>

  readonly status: (input: BindingStatusInput) => Effect.Effect<BindingStatusOutput, BindingError>
  readonly history: (input: BindingHistoryInput) => Effect.Effect<BindingHistoryOutput, BindingError>
}

/**
 * Backs the reserved `semantic.index.status|test|reindex|reconcile|show-collections`
 * operator commands, scoped per collection (`agents`/`skills`/`skill_chunks`, and
 * `tools` for Feature 009). Surfaces the typed `milvus_unavailable` capability gap
 * rather than a hard failure when the configured backend is unreachable (C1, C20).
 */
export interface IndexPort {
  readonly status: (input: IndexStatusInput) => Effect.Effect<IndexStatusOutput, IndexError>
  readonly test: (input: IndexTestInput) => Effect.Effect<IndexTestOutput, IndexError>
  /** Content-hash incremental upsert / tombstone reindex for one collection (FR13). */
  readonly reindex: (input: IndexReindexInput) => Effect.Effect<IndexReindexOutput, IndexError>
  /** Feature 003 scheduled reconcile using the current pinned binding without changing it (FR13). */
  readonly reconcile: (input: IndexReconcileInput) => Effect.Effect<IndexReconcileOutput, IndexError>
  readonly showCollections: (input: ShowCollectionsInput) => Effect.Effect<ShowCollectionsOutput, IndexError>
}

/**
 * Consumed by Feature 001 Architect (agent retrieval) and Manager (worker + skill
 * retrieval); Worker MUST NOT call this port to create agents or children (FR5).
 * Default is strict two-pass: `retrieveAgents` then `retrieveSkills` constrained by
 * the selected Agent (FR21, C9). The query embedding is cached by QueryFingerprint and
 * reused across both passes while valid (FR18, C10). Every candidate is revalidated
 * against live AgentV2/SkillV2/Permission before it is returned as `revalidated: true`
 * (FR20, FR27, C11).
 */
export interface RetrievalPort {
  readonly retrieveAgents: (input: RetrievalRequest) => Effect.Effect<RetrievalResult, RetrievalError>
  /** Lazy: summary metadata first; full chunk injection only after Agent selection under the C8 budget (FR39, FR40, C9). */
  readonly retrieveSkills: (input: SkillRetrievalRequest) => Effect.Effect<RetrievalResult, RetrievalError>
}

/**
 * Offline golden evaluation driver. Never mutates a binding (FR43, C18). Covers
 * task->agent/skill relevance, recall/ranking metrics, multilingual pt/es/en tests,
 * permission-leakage tests and drift/model-migration checks; the leakage tolerance is
 * fixed at zero.
 */
export interface EvalPort {
  readonly runGolden: (input: RunGoldenInput) => Effect.Effect<EvalReport, EvalError>
}

/**
 * Feature 009 tool retrieval seam. Extends the 006 retrieval surface rather than forking
 * a router (C2): composed by the SAME facade alongside `retrieveAgents`/`retrieveSkills`
 * — a sibling port, not a second facade. The tool pass runs pipeline stages 1 profile ->
 * 2 filter -> 3 recall -> 4 reduce -> 5 rerank -> 6 score -> 9 revalidate, reusing
 * `hybrid-fusion.ts`/`tie-break.ts` verbatim and OMITTING the agent-only 7/8 stages.
 * Not reached by a live route until a per-surface flag (C9) turns it on (FR11, C15).
 */
export interface ToolRetrievalPort {
  readonly retrieveTools: (input: ToolRetrievalRequest) => Effect.Effect<ToolRetrievalResult, ToolRetrievalError>
}

/**
 * The injected pipeline runner Feature 009 adds alongside the 006 `runAgents`/`runSkills`;
 * `tool-pass.ts` implements this signature with zero framework/I/O dependencies (C2).
 */
export interface ToolPipelineRunnerPort {
  readonly runTools: (request: ToolRetrievalRequest) => Promise<ToolPipelineOutcome>
}

/**
 * The C11 trigger-coalescing wrapper over the REUSED 006 `IndexPort` (no new lifecycle
 * machinery, C7). It owns ONLY the three-source trigger intake, the bounded coalescing
 * window, and the sanitized projection; every actual upsert/tombstone pass flows through
 * the reused `IndexPort.reindex`/`reconcile({ collection: "tools" })`. Parallel and
 * independent from the Feature 008 resource-index trigger — never merged (C11).
 */
export interface ToolIndexPort {
  /** Records one of the three C11 trigger sources; never reindexes synchronously (NFR2). */
  readonly recordTrigger: (event: ToolReindexTriggerEvent) => Effect.Effect<void, never>
  /** Flushes the coalesced window for one affected scope/server, driving the reused `IndexPort.reindex` (FR8, C7, C11). */
  readonly flush: (input: ToolIndexFlushInput) => Effect.Effect<ToolIndexFlushOutput, ToolIndexError>
  /** Projects one boundary tool record into a sanitized, content-hashed `ToolDoc` (FR6, FR7, FR8, C6). */
  readonly project: (input: ToolProjectionInput) => Effect.Effect<ToolProjectionOutput, ToolIndexError>
}

/**
 * Read-only projection of the per-surface Config.Service tool-search flags Feature 009
 * adds (FR21, C9, C12). Config MUTATION is NOT a new port — it flows through the existing
 * Config.Service write surface; Feature 009 registers no new operator command ID (FR22).
 */
export interface ToolSearchConfigPort {
  readonly get: (surface: ToolSearchSurface) => Effect.Effect<ToolSearchSurfaceConfig, ToolSearchConfigError>
}
