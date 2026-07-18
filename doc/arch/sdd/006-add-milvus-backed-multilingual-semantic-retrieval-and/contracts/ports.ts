/**
 * Feature 006 — Application Ports (Semantic Agent and Skill Retrieval,
 * Milvus-Backed Multilingual Semantic Retrieval and Reranking)
 *
 * These interfaces define the inbound ports owned by Feature 006. They are
 * implemented by the domain retrieval engine (`packages/core/src/semantic/**`)
 * and application adapters (`packages/opencode/src/semantic/**`,
 * `packages/opencode/src/operator/semantic/**`), and are consumed by
 * Feature 001 (Architect/Manager/Worker candidate retrieval, never route or
 * permission authority), Feature 007 (sole management authority for the
 * reserved `semantic.*` catalog at `RESERVED_CATALOG_VERSION = "1.3.0"`),
 * Feature 002/003 (reindex/probe/reconcile job lifecycle and schedule),
 * Feature 004 (multilingual query posture against Lang Lock artifacts),
 * Feature 005 (OutputSpool refs for index job outputs and skill chunk
 * injection), and Feature 009 (extends the same stack with a `tools`
 * collection; owns no field definitions here). Milvus, the embedding
 * provider, and the reranker are a **derived projection/index** only —
 * AgentV2.Service, Catalog/ModelsDev, SkillV2, Permission/Policy, and Config
 * remain sources of truth (FR1, FR2, C1-C22; plan.md "Non-goals").
 *
 * Domain: the immutable nine-stage pipeline (profile -> hard filters ->
 * hybrid dense+sparse recall -> reduced candidate set -> rerank ->
 * deterministic score/tie-break -> selected Agent -> constrained Skill
 * retrieval/rerank -> post-retrieval revalidation against live core, FR3,
 * C2), the closed `SemanticModelBinding` lifecycle
 * (draft -> staged -> active -> degraded -> unavailable, C12, C20), the
 * blue/green index-generation lifecycle
 * (building -> validated -> live -> superseded -> retired, C12), the typed
 * degradation ladder (full_semantic -> catalog_lexical -> fail_closed, C14,
 * C20, never a silent model substitution), and the reserved `semantic.*`
 * operator command surface (30 IDs across six groups, C15). Every mutation
 * (provider/model/binding/index admin op) requires a re-evaluated
 * authorization; `cutover`, `rollback`, `delete`/`disable`-when-bound, and
 * `rotate-secret` additionally require an operator principal, explicit
 * scope, version/CAS, idempotency, and interactive confirmation (FR35, C15).
 *
 * Wire-shape source of truth: `doc/arch/schemas/semantic/*.cue`
 * (provider-profile.cue, model-descriptor.cue, binding.cue, enums.cue,
 * documents.cue, profile.cue, retrieval.cue, index-generation.cue,
 * events.cue — plan.md "New module tree target", forthcoming in the tasks
 * phase). This file is the TypeScript mirror; it does not redefine event
 * payload schemas owned by `packages/schema/src/semantic/*` and it does not
 * redefine or diverge from the reserved catalog owned by
 * `packages/core/src/operator/catalog.ts` (C15).
 */

import type { Effect } from "effect"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/semantic/*.cue)
// =============================================================================

export type ProjectId = string
export type TaskId = string
export type ProviderProfileId = string
export type ModelDescriptorId = string
export type BindingId = string
export type IndexGenerationId = string
export type CollectionAliasId = string
export type EvalRunId = string
export type AuditId = string

/** Opaque secret reference minted by Feature 007 SecretPort; never inline plaintext (FR35, C19). */
export type SecretRef = string

/** Opaque bounded token minted by Feature 005 OutputSpool for index/probe job outputs and skill chunk injection (FR40, C9). */
export type OutputRef = string

/** Immutable, monotonically assigned binding version; never mutated in place (FR12, FR31, C12). */
export type BindingVersion = number

/** Stable hash of the effective config surface a cache/binding was derived from (FR25, C10). */
export type ConfigHash = string

/** Stable content hash driving incremental upsert/tombstone (FR13, C9). */
export type ContentHash = string

/** Compare-and-swap token required for `cutover`/`rollback` and every admin mutation (C12, C15). */
export type CasToken = string

// =============================================================================
// Closed enums (wire shape: doc/arch/schemas/semantic/enums.cue)
// =============================================================================

/** The two fixed binding slots; V1 pins exactly one binding per slot (FR6, FR28). */
export type BindingSlot = "embedding" | "reranker"

/**
 * The 5-member binding lifecycle (plan.md "State machines" -> "Binding
 * lifecycle with blue/green cutover", C12, C20). `select` stages `draft`;
 * `validate`/`reindex` move it to `staged`; `cutover` under CAS+confirmation
 * activates `active`; a provider/model outage degrades `active` to
 * `degraded` then `unavailable`; `rollback` restores a superseded version to
 * `active`. The runtime NEVER auto-selects another model on outage (FR24,
 * FR31).
 */
export type BindingState = "draft" | "staged" | "active" | "degraded" | "unavailable"

/** Capability-badge probe state surfaced in the operator panel (FR29). A manual declaration starts `declared` and is untrusted until `validated` (C16). */
export type ProbeState = "declared" | "validating" | "validated" | "failed" | "stale"

/**
 * The three explicit rerank compatibility profiles (FR30, C16). `native_rerank`
 * is profile A (`/v1/rerank`); `structured_chat` is profile B (deterministic
 * schema/temperature/tool-free chat completions); `embedding_similarity` is
 * profile C — a distinct capability, NEVER labeled or badged cross-encoder or
 * reranker, and NEVER eligible for the reranker slot.
 */
export type RerankProfile = "native_rerank" | "structured_chat" | "embedding_similarity"

/**
 * The typed degradation ladder (plan.md "State machines" -> "Degradation
 * ladder", C14, C20). `full_semantic` runs hybrid recall + rerank when the
 * binding and Milvus are healthy; `catalog_lexical` is the deterministic
 * routing floor for agents/skills; `fail_closed` is operator opt-in only.
 */
export type DegradationRung = "full_semantic" | "catalog_lexical" | "fail_closed"

/** Stable capability-gap codes recorded with every degraded outcome; never a silent empty result (FR24, C1, C20). */
export type DegradationGapCode =
  | "milvus_unavailable"
  | "embedding_unavailable"
  | "reranker_unavailable"
  | "index_stale"
  | "no_binding_pinned"
  | "timeout"

/**
 * The 5-member index-generation lifecycle (plan.md "State machines" ->
 * "Index generation lifecycle", C12). All collections in a binding
 * generation cut over together under one CAS; `select`/`reindex` alone never
 * activate the live alias.
 */
export type IndexGenerationState = "building" | "validated" | "live" | "superseded" | "retired"

/** Milvus consistency level; Bounded staleness is the V1 default, Strong is reserved for admin verification reads (C6). */
export type ConsistencyLevel = "bounded" | "strong"

/** Dense-vector distance metric stored with the collection generation; never inferred (FR12, C7). */
export type MetricKind = "cosine" | "inner_product"

/** The three Feature 006 collections plus the Feature 009 extension point; all share one binding generation (FR9, C6, C21). */
export type CollectionKind = "agents" | "skills" | "skill_chunks" | "tools"

/** Model descriptor provenance; a manual declaration is untrusted until probe/eval passes (FR28, C16). */
export type ModelSource = "discovered" | "manual" | "core-catalog"

/** Capability badges shown in the operator panel; `embedding_similarity` never satisfies a reranker-slot check (FR29, FR30, C16). */
export type CapabilityKind = "embedding" | "rerank_native" | "rerank_chat" | "embedding_similarity" | "multilingual"

/** Data-residency posture for embedding/rerank providers (FR37, C4). `local_offline` blocks egress to remote hosts. */
export type ResidencyPolicy = "local_offline" | "unrestricted"

/** Reserved-catalog command scope (plan.md "Operator command surface", C15). */
export type Scope = "project" | "global"

/** Stable error codes shared across ports; never a query, an endpoint, or a credential (Security "Error exposure", C22). */
export type StableErrorCode =
  | "not_found"
  | "denied"
  | "invalid_argument"
  | "unavailable"
  | "cas_conflict"
  | "confirmation_required"
  | "reserved_name"
  | "ssrf_blocked"
  | "not_validated"
  | "reranker_not_eligible"
  | "no_candidate_staged"
  | "vector_space_mismatch"

// =============================================================================
// Reserved semantic.* catalog mirror (wire shape: packages/core/src/operator/catalog.ts)
// =============================================================================

/**
 * Documentation-only mirror of the 30 reserved `semantic.*` IDs at
 * `RESERVED_CATALOG_VERSION = "1.3.0"` (C15). `packages/core/src/operator/catalog.ts`
 * is the sole registration authority; this array never re-registers or
 * diverges from it and exists only to trace each port method back to its
 * canonical operator command ID. Plugin/MCP/custom registries MUST NOT
 * register any of these IDs (FR33, FR36).
 */
export const RESERVED_SEMANTIC_COMMAND_IDS = [
  "semantic.provider.list",
  "semantic.provider.add",
  "semantic.provider.update",
  "semantic.provider.test",
  "semantic.provider.disable",
  "semantic.provider.delete",
  "semantic.provider.rotate-secret",
  "semantic.model.list",
  "semantic.model.discover",
  "semantic.model.register",
  "semantic.model.validate",
  "semantic.model.disable",
  "semantic.embedding.show",
  "semantic.embedding.select",
  "semantic.embedding.validate",
  "semantic.embedding.reindex",
  "semantic.embedding.cutover",
  "semantic.embedding.rollback",
  "semantic.reranker.show",
  "semantic.reranker.select",
  "semantic.reranker.validate",
  "semantic.reranker.cutover",
  "semantic.reranker.rollback",
  "semantic.binding.status",
  "semantic.binding.history",
  "semantic.index.status",
  "semantic.index.test",
  "semantic.index.reindex",
  "semantic.index.reconcile",
  "semantic.index.show-collections",
] as const

export type ReservedSemanticCommandId = (typeof RESERVED_SEMANTIC_COMMAND_IDS)[number]

// =============================================================================
// semantic.* event vocabulary (wire shape: doc/arch/schemas/semantic/events.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and register via `EventV2.define` into
 * `packages/schema/src/durable-event-manifest.ts` through the single EventV2
 * authority (C22). Binding/index-generation transitions and index
 * maintenance outcomes; content, queries, and vectors are never an event
 * payload (FR42).
 */
export const DURABLE_SEMANTIC_EVENT_TYPES = [
  "semantic.binding.selected",
  "semantic.binding.validated",
  "semantic.binding.activated",
  "semantic.binding.rolled_back",
  "semantic.binding.degraded",
  "semantic.binding.unavailable",
  "semantic.index.generation_built",
  "semantic.index.generation_validated",
  "semantic.index.cutover_committed",
  "semantic.index.generation_retired",
  "semantic.index.upserted",
  "semantic.index.tombstoned",
  "semantic.provider.rotated_secret",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay); MAY be
 * dropped under `allBounded` load without affecting durable binding/index
 * state (C22).
 */
export const LIVE_SEMANTIC_EVENT_TYPES = [
  "semantic.retrieval.fallback",
  "semantic.retrieval.cache_hit",
  "semantic.retrieval.cache_miss",
  "semantic.index.reconcile_started",
  "semantic.probe.started",
  "semantic.probe.completed",
  "semantic.unknown",
] as const

export type DurableSemanticEventType = (typeof DURABLE_SEMANTIC_EVENT_TYPES)[number]
export type LiveSemanticEventType = (typeof LIVE_SEMANTIC_EVENT_TYPES)[number]

/** The 20-member closed `semantic.*` event vocabulary (C22). */
export type SemanticEventType = DurableSemanticEventType | LiveSemanticEventType

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to authorize semantic admin-plane actions (FR35, C15). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// Wire mirrors — providers, models, bindings
// (wire shape: doc/arch/schemas/semantic/{provider-profile,model-descriptor,binding}.cue)
// =============================================================================

/** Transport/TLS posture for one provider profile (FR33, C17). Remote endpoints require TLS by default. */
export interface TransportPolicy {
  readonly tlsRequired: boolean
  readonly allowInsecureLocalProfile: boolean
}

/** SSOT record (FR28). Never embeds a secret; `secretRef` is opaque and local endpoints MAY omit it. */
export interface SemanticProviderProfile {
  readonly id: ProviderProfileId
  readonly version: number
  readonly name: string
  readonly baseUrl: string
  readonly compatibilityProfile: "openai_compatible"
  readonly transportPolicy: TransportPolicy
  readonly secretRef?: SecretRef
  readonly residency: ResidencyPolicy
  readonly enabled: boolean
  readonly createdAt: string // ISO-8601
  readonly updatedAt: string // ISO-8601
  readonly auditId: AuditId
}

/** Server-declared limits captured at probe time (FR30, C8). */
export interface ModelLimits {
  readonly maxBatchSize?: number
  readonly maxInputTokens?: number
}

/** SSOT record (FR28). Rerank capability is NEVER inferred from `modelRef` alone (FR30, C16). */
export interface SemanticModelDescriptor {
  readonly id: ModelDescriptorId
  readonly providerProfileId: ProviderProfileId
  readonly modelRef: string
  readonly displayName: string
  readonly source: ModelSource
  readonly capabilityKinds: readonly CapabilityKind[]
  readonly endpointMode: "embeddings" | "rerank" | "chat_completions"
  readonly dimensions?: number
  readonly limits?: ModelLimits
  readonly languageSupport: readonly string[] // BCP 47 tags; multilingual pt-BR/es/en coverage (FR14, C3)
  readonly probeState: ProbeState
  readonly validatedAt?: string // ISO-8601
  readonly validationVersion?: number
  readonly enabled: boolean
}

/**
 * SSOT record (FR28). `compatibilityMode` is `"embedding"` for the embedding
 * slot or the selected {@link RerankProfile} for the reranker slot. The
 * binding version is immutable; a new version is created rather than mutated
 * in place (FR12, FR31, C12).
 */
export interface SemanticModelBinding {
  readonly id: BindingId
  readonly slot: BindingSlot
  readonly bindingVersion: BindingVersion
  readonly providerProfileId: ProviderProfileId
  readonly modelDescriptorId: ModelDescriptorId
  readonly compatibilityMode: RerankProfile | "embedding"
  readonly capabilityContract: readonly CapabilityKind[]
  readonly state: BindingState
  readonly selectedBy: string // operator principal id (FR31)
  readonly selectedAt: string // ISO-8601
  readonly configHash: ConfigHash
  readonly indexGenerationId?: IndexGenerationId // embedding slot only (C12)
  readonly aliasId?: CollectionAliasId // embedding slot only (C12)
}

// =============================================================================
// Wire mirrors — index generation
// (wire shape: doc/arch/schemas/semantic/index-generation.cue)
// =============================================================================

/** One collection's alias state within an index generation (C6, C12). */
export interface CollectionAliasDescriptor {
  readonly collection: CollectionKind
  readonly generationId: IndexGenerationId
  readonly aliasId: CollectionAliasId
  readonly state: IndexGenerationState
}

/** Blue/green generation descriptor; all collections cut over together under one CAS (FR12, C12, C21). */
export interface IndexGeneration {
  readonly generationId: IndexGenerationId
  readonly bindingVersion: BindingVersion
  readonly state: IndexGenerationState
  readonly collections: readonly CollectionAliasDescriptor[]
  readonly consistencyLevel: ConsistencyLevel
  readonly metric: MetricKind
  readonly dimension: number
  readonly createdAt: string // ISO-8601
}

// =============================================================================
// Wire mirrors — retrieval
// (wire shape: doc/arch/schemas/semantic/{profile,retrieval}.cue)
// =============================================================================

/**
 * Structured task profile (stage 1 of the FR3 pipeline). `queryText`
 * preserves the original query for embedding; a mandatory translation LLM
 * call is never required (FR15, FR18).
 */
export interface TaskProfile {
  readonly taskId: TaskId
  readonly queryText: string
  readonly languageTag?: string // BCP 47; effective Feature 004 tag recorded without content (FR16)
  readonly languageConfidence?: number
  readonly projectId: ProjectId
  readonly roleFilter?: string
}

/** Cached-by-fingerprint query embedding key, reused across agent/skill/tool passes while valid (FR18, C10). */
export interface QueryFingerprint {
  readonly fingerprint: string
  readonly bindingVersion: BindingVersion
  readonly configHash: ConfigHash
}

/**
 * Score provenance/components (FR22). `canonicalId` is the final leg of the
 * deterministic tie-break: rerank score, then dense score, then
 * sparse/lexical score, then canonical ID/version (C2).
 */
export interface SemanticScore {
  readonly rerankScore?: number
  readonly denseScore: number
  readonly sparseScore?: number
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly confidence: "high" | "medium" | "low"
}

/** One candidate surviving the FR3 pipeline through stage 9 revalidation. */
export interface RetrievalCandidate {
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly kind: "agent" | "skill" | "skill_chunk"
  readonly score: SemanticScore
  readonly revalidated: boolean // false only when returned before stage 9 completes (never injected)
  readonly chunkRef?: OutputRef // Feature 005 ref; populated only for injected skill chunks (FR40, C9)
}

/** Mandatory scalar predicates applied before search (FR9, FR34, C6). */
export interface RetrievalFilters {
  readonly projectId: ProjectId
  readonly roleFilter?: string
  readonly permissionProfileRef?: string
}

/** Stage-1/2/3/5 request; `retrievalTopK`/`rerankTopK` are server-capped from the Feature 001 budget (FR19, FR38, C8). */
export interface RetrievalRequest {
  readonly profile: TaskProfile
  readonly retrievalTopK: number
  readonly rerankTopK: number
  readonly filters: RetrievalFilters
}

/** Skill pass request; constrained by the Agent selected in the prior pass (FR21, C9). */
export interface SkillRetrievalRequest extends RetrievalRequest {
  readonly selectedAgentCanonicalId: string
  readonly maxSkillChunks: number
}

/** Explicit degraded outcome; never a silent empty result and never an auto-selected substitute model (FR24, C1, C20). */
export interface DegradationOutcome {
  readonly rung: DegradationRung
  readonly gapCode?: DegradationGapCode
  readonly reason?: string
}

/** Stage-9 result. `cacheHit` reports {@link QueryFingerprint} reuse (FR18, C10). */
export interface RetrievalResult {
  readonly candidates: readonly RetrievalCandidate[]
  readonly degradation: DegradationOutcome
  readonly queryFingerprint: QueryFingerprint
  readonly cacheHit: boolean
}

// =============================================================================
// Wire mirrors — offline evaluation
// =============================================================================

/** Per-locale golden evaluation result (FR43, C18). */
export interface LocaleEvalResult {
  readonly languageTag: string // pt-BR | es | en (C18)
  readonly recallAtK: number
  readonly ndcg: number
  readonly mrr: number
}

/**
 * Offline golden evaluation report. `leakageCount` MUST be zero to pass —
 * the zero-leakage tolerance is fixed, never a configurable threshold
 * (FR43, C18). Evaluation never mutates a binding.
 */
export interface EvalReport {
  readonly evalRunId: EvalRunId
  readonly bindingVersion: BindingVersion
  readonly localeBreakdown: readonly LocaleEvalResult[]
  readonly recallAtK: number
  readonly ndcg: number
  readonly mrr: number
  readonly leakageCount: number
  readonly completedAt: string // ISO-8601
}

// =============================================================================
// ProviderPort — semantic.provider.* (FR29, FR33, FR35, C15, C17, C19)
// =============================================================================

/**
 * Backs the reserved `semantic.provider.list|add|update|test|disable|delete|
 * rotate-secret` operator commands, registered via Feature 007. Every
 * mutation requires an operator principal, explicit scope, version/CAS, and
 * audit; `delete`/`disable`-when-bound and `rotate-secret` additionally
 * require interactive confirmation (FR31, FR35, C15).
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

export interface ListProvidersInput {
  readonly scope: Scope
  readonly scopeId: string
}

export interface ListProvidersOutput {
  readonly profiles: readonly SemanticProviderProfile[]
}

export interface AddProviderInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly name: string
  readonly baseUrl: string
  readonly transportPolicy: TransportPolicy
  readonly secretRef?: SecretRef
  readonly residency: ResidencyPolicy
  readonly principal: OperatorPrincipal
}

export interface AddProviderOutput {
  readonly profile: SemanticProviderProfile
  readonly auditId: AuditId
}

export interface UpdateProviderInput {
  readonly id: ProviderProfileId
  readonly expectedVersion: number
  readonly patch: Partial<Pick<SemanticProviderProfile, "name" | "baseUrl" | "transportPolicy" | "residency" | "enabled">>
  readonly principal: OperatorPrincipal
}

export interface UpdateProviderOutput {
  readonly profile: SemanticProviderProfile
  readonly auditId: AuditId
}

export interface TestProviderInput {
  readonly id: ProviderProfileId
  readonly principal: OperatorPrincipal
}

export interface TestProviderOutput {
  readonly reachable: boolean
  readonly latencyMs: number
  readonly probeState: ProbeState
}

export interface DisableProviderInput {
  readonly id: ProviderProfileId
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface DisableProviderOutput {
  readonly profile: SemanticProviderProfile
  readonly auditId: AuditId
}

export interface DeleteProviderInput {
  readonly id: ProviderProfileId
  readonly expectedVersion: number
  readonly confirmed: boolean
  readonly replacementProviderProfileId?: ProviderProfileId
  readonly principal: OperatorPrincipal
}

export interface DeleteProviderOutput {
  readonly id: ProviderProfileId
  readonly auditId: AuditId
}

export interface RotateSecretInput {
  readonly id: ProviderProfileId
  readonly expectedVersion: number
  readonly newSecretRef: SecretRef
  readonly principal: OperatorPrincipal
}

export interface RotateSecretOutput {
  readonly profile: SemanticProviderProfile
  readonly auditId: AuditId
}

export type ProviderError =
  | { readonly type: "not_found"; readonly id: ProviderProfileId }
  | { readonly type: "invalid_url"; readonly reason: string } // guards FR33
  | { readonly type: "ssrf_blocked"; readonly host: string } // guards FR33, C17
  | { readonly type: "secret_backend_unavailable" } // guards C19
  | { readonly type: "version_conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly type: "confirmation_required" } // guards delete/disable-when-bound, C15
  | { readonly type: "bound_requires_replacement"; readonly bindingIds: readonly BindingId[] } // guards FR31
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ModelPort — semantic.model.* (FR28-FR30, C16)
// =============================================================================

/**
 * Backs the reserved `semantic.model.list|discover|register|validate|disable`
 * operator commands. A manually registered model is untrusted until native
 * probe/eval passes — there is no trust window (FR30, C16). Rerank
 * capability is NEVER inferred from `/v1/models` name alone.
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

export interface ListModelsInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly providerProfileId?: ProviderProfileId
}

export interface ListModelsOutput {
  readonly descriptors: readonly SemanticModelDescriptor[]
}

export interface DiscoverModelsInput {
  readonly providerProfileId: ProviderProfileId
  readonly principal: OperatorPrincipal
}

export interface DiscoverModelsOutput {
  readonly discovered: readonly SemanticModelDescriptor[]
}

export interface RegisterModelInput {
  readonly providerProfileId: ProviderProfileId
  readonly modelRef: string
  readonly displayName: string
  readonly endpointMode: "embeddings" | "rerank" | "chat_completions"
  readonly declaredCapabilityKinds: readonly CapabilityKind[]
  readonly principal: OperatorPrincipal
}

export interface RegisterModelOutput {
  readonly descriptor: SemanticModelDescriptor
  readonly auditId: AuditId
}

export interface ValidateModelInput {
  readonly id: ModelDescriptorId
  readonly principal: OperatorPrincipal
}

export interface ValidateModelOutput {
  readonly descriptor: SemanticModelDescriptor
  readonly probeState: ProbeState
  readonly dimensions?: number
  readonly limits?: ModelLimits
}

export interface DisableModelInput {
  readonly id: ModelDescriptorId
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface DisableModelOutput {
  readonly descriptor: SemanticModelDescriptor
  readonly auditId: AuditId
}

export type ModelError =
  | { readonly type: "not_found"; readonly id: ModelDescriptorId }
  | { readonly type: "provider_not_found"; readonly providerProfileId: ProviderProfileId }
  | { readonly type: "provider_disabled"; readonly providerProfileId: ProviderProfileId }
  | { readonly type: "probe_failed"; readonly reason: string } // guards FR30
  | { readonly type: "dimension_mismatch"; readonly expected: number; readonly actual: number } // guards FR12
  | { readonly type: "untrusted_declaration"; readonly id: ModelDescriptorId } // guards C16
  | { readonly type: "rerank_name_inference_rejected" } // guards FR30, C16
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// BindingPort — semantic.embedding.*, semantic.reranker.*, semantic.binding.*
// (FR12, FR31, FR32, C12, C15, C16, C20)
// =============================================================================

/**
 * Backs the reserved `semantic.embedding.*`, `semantic.reranker.*`, and
 * `semantic.binding.*` operator commands. Binding mutation happens only via
 * `selectEmbedding`/`cutoverEmbedding` and `selectReranker`/`cutoverReranker`;
 * `status`/`history` are read-only (plan.md "Operator command surface").
 * `select`/`reindex`/`validate` alone NEVER activate the live alias — only
 * `cutover` under CAS and interactive confirmation does (FR32, C12).
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

export interface ShowBindingInput {
  readonly scope: Scope
  readonly scopeId: string
}

export interface ShowBindingOutput {
  readonly binding?: SemanticModelBinding
}

export interface SelectBindingInput {
  readonly slot: BindingSlot
  readonly modelDescriptorId: ModelDescriptorId
  readonly compatibilityMode: RerankProfile | "embedding"
  readonly principal: OperatorPrincipal
}

export interface SelectBindingOutput {
  readonly binding: SemanticModelBinding // state: "draft"
  readonly auditId: AuditId
}

export interface ValidateBindingInput {
  readonly id: BindingId
  readonly principal: OperatorPrincipal
}

export interface ValidateBindingOutput {
  readonly binding: SemanticModelBinding // state: "staged" on pass
  readonly probeState: ProbeState
}

export interface ReindexEmbeddingInput {
  readonly id: BindingId
  readonly principal: OperatorPrincipal
}

export interface ReindexEmbeddingOutput {
  readonly generation: IndexGeneration // state: "building" -> "validated"
  readonly auditId: AuditId
}

export interface CutoverEmbeddingInput {
  readonly id: BindingId
  readonly generationId: IndexGenerationId
  readonly casToken: CasToken
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

export interface CutoverEmbeddingOutput {
  readonly binding: SemanticModelBinding // state: "active"
  readonly generation: IndexGeneration // state: "live"
  readonly auditId: AuditId
}

export interface CutoverRerankerInput {
  readonly id: BindingId
  readonly casToken: CasToken
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

export interface CutoverRerankerOutput {
  readonly binding: SemanticModelBinding // state: "active"
  readonly auditId: AuditId
}

export interface RollbackBindingInput {
  readonly slot: BindingSlot
  readonly targetBindingVersion: BindingVersion
  readonly casToken: CasToken
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

export interface RollbackBindingOutput {
  readonly binding: SemanticModelBinding // state: "active" (superseded version restored)
  readonly auditId: AuditId
}

export interface BindingStatusInput {
  readonly scope: Scope
  readonly scopeId: string
}

export interface BindingStatusOutput {
  readonly embedding?: SemanticModelBinding
  readonly reranker?: SemanticModelBinding
  readonly degradation: DegradationOutcome
}

export interface BindingHistoryInput {
  readonly slot: BindingSlot
  readonly scope: Scope
  readonly scopeId: string
  readonly limit: number
}

export interface BindingHistoryOutput {
  readonly versions: readonly SemanticModelBinding[]
}

export type BindingError =
  | { readonly type: "not_found"; readonly id: BindingId }
  | { readonly type: "not_validated"; readonly id: ModelDescriptorId } // guards C16 untrusted-declaration
  | { readonly type: "dimension_mismatch"; readonly expected: number; readonly actual: number } // guards FR12
  | { readonly type: "vector_space_mismatch" } // guards FR12 — never mixes vectors/models/dimensions
  | { readonly type: "cas_conflict"; readonly expectedGeneration: string; readonly actualGeneration: string } // guards C12
  | { readonly type: "confirmation_required" } // guards cutover/rollback, C15
  | { readonly type: "no_candidate_staged" } // guards cutover without a validated `staged` binding
  | { readonly type: "reranker_not_eligible"; readonly reason: string } // guards FR30, C16 — profile C never eligible
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// IndexPort — semantic.index.* (FR7, FR9, FR13, C1, C6, C7)
// =============================================================================

/**
 * Backs the reserved `semantic.index.status|test|reindex|reconcile|
 * show-collections` operator commands, scoped per collection
 * (`agents`/`skills`/`skill_chunks`, and `tools` for Feature 009). Surfaces
 * the typed `milvus_unavailable` capability gap rather than a hard failure
 * when the configured backend is unreachable (C1, C20).
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

export interface IndexStatusInput {
  readonly collection: CollectionKind
  readonly scope: Scope
  readonly scopeId: string
}

export interface IndexStatusOutput {
  readonly generation?: IndexGeneration
  readonly documentCount: number
  readonly freshnessBucket: "fresh" | "stale" | "unknown"
}

export interface IndexTestInput {
  readonly principal: OperatorPrincipal
}

export interface IndexTestOutput {
  readonly reachable: boolean
  readonly latencyMs: number
}

export interface IndexReindexInput {
  readonly collection: CollectionKind
  readonly principal: OperatorPrincipal
}

export interface IndexReindexOutput {
  readonly upsertedCount: number
  readonly tombstonedCount: number
  readonly outputRef: OutputRef // Feature 005 ref for the job log (FR13, C9)
}

export interface IndexReconcileInput {
  readonly collection: CollectionKind
  readonly scheduledOccurrenceId?: string // Feature 003 occurrence, when triggered by schedule
}

export interface IndexReconcileOutput {
  readonly upsertedCount: number
  readonly tombstonedCount: number
  readonly outputRef: OutputRef
}

export interface ShowCollectionsInput {
  readonly scope: Scope
  readonly scopeId: string
}

export interface ShowCollectionsOutput {
  readonly collections: readonly CollectionAliasDescriptor[]
}

export type IndexError =
  | { readonly type: "milvus_unavailable"; readonly reason: string } // guards C1 typed capability gap
  | { readonly type: "generation_not_found"; readonly generationId: IndexGenerationId }
  | { readonly type: "reconcile_in_progress"; readonly collection: CollectionKind }
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// RetrievalPort — retrieveAgents / retrieveSkills (FR3, FR18-FR27, C2, C9, C20)
// =============================================================================

/**
 * Consumed by Feature 001 Architect (agent retrieval) and Manager (worker +
 * skill retrieval); Worker MUST NOT call this port to create agents or
 * children (FR5). Default is strict two-pass: `retrieveAgents` then
 * `retrieveSkills` constrained by the selected Agent (FR21, C9, C13). The
 * query embedding is cached by {@link QueryFingerprint} and reused across
 * both passes while valid (FR18, C10). Every candidate is revalidated
 * against live AgentV2/SkillV2/Permission before it is ever returned as
 * `revalidated: true` (FR20, FR27, C11).
 */
export interface RetrievalPort {
  readonly retrieveAgents: (input: RetrievalRequest) => Effect.Effect<RetrievalResult, RetrievalError>
  /** Lazy: summary metadata first; full chunk injection only after Agent selection under the C8 budget (FR39, FR40, C9). */
  readonly retrieveSkills: (input: SkillRetrievalRequest) => Effect.Effect<RetrievalResult, RetrievalError>
}

export type RetrievalError =
  | { readonly type: "invalid_profile"; readonly reason: string }
  | { readonly type: "budget_exceeded"; readonly field: "retrieval_top_k" | "rerank_top_k" | "max_skill_chunks" | "token_budget" } // guards FR38
  | { readonly type: "timeout" } // triggers C20 fallback at the call site, never surfaced as a hard failure by itself
  | { readonly type: "fail_closed_denied"; readonly gapCode: DegradationGapCode } // guards operator opt-in fail-closed, C14, FR24
  | { readonly type: "not_implemented" }

// =============================================================================
// EvalPort — semantic offline golden evaluation (FR43, C18)
// =============================================================================

/**
 * Offline golden evaluation driver. Never mutates a binding (FR43, C18).
 * Covers task->agent/skill relevance, recall/ranking metrics, multilingual
 * pt/es/en tests, permission-leakage tests, and drift/model-migration
 * checks; the leakage tolerance is fixed at zero.
 */
export interface EvalPort {
  readonly runGolden: (input: RunGoldenInput) => Effect.Effect<EvalReport, EvalError>
}

export interface RunGoldenInput {
  readonly suiteRef: string
  readonly locales: readonly string[] // BCP 47; V1 covers pt-BR, es, en (C18)
  readonly principal: OperatorPrincipal
}

export type EvalError =
  | { readonly type: "suite_not_found"; readonly suiteRef: string }
  | { readonly type: "binding_not_pinned"; readonly slot: BindingSlot } // guards C14
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
