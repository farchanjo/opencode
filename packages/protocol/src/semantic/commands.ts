/**
 * Feature 006 — Semantic retrieval protocol payloads (T014).
 *
 * TypeScript mirror of the shared identifiers, closed enums, the 12-member
 * `semantic.*` event vocabulary (9 durable / 3 live), the provider/model/binding/
 * index-generation/retrieval wire read models, the retrieval + 30 `semantic.*`
 * operator command/query payloads, and the typed `ProviderError`/`ModelError`/
 * `BindingError`/`IndexError`/`RetrievalError`/`EvalError` unions from
 * doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/contracts/ports.ts.
 * The `ProviderPort`/`ModelPort`/`BindingPort`/`IndexPort`/`RetrievalPort`/`EvalPort`
 * interfaces live in ./ports — this file defines only the payload shapes.
 *
 * RECONCILIATION (T014): `contracts/ports.ts` presented a divergent provisional
 * surface — a 20-member dotted event vocabulary, a 6-member `DegradationGapCode`, a
 * 5-member `CapabilityKind`, an underscore-spelled `RerankProfile`, and an enum
 * `confidence`. The CUE corpus (doc/arch/schemas/semantic/*.cue), mirrored by
 * `packages/schema/src/semantic/*`, is the authority. This mirror is reconciled to it
 * and SOURCES every reconciled enum from `@opencode-ai/schema/semantic/*` rather than
 * re-declaring it, so the transport contract can never diverge from the wire shape:
 * the closed 12-member underscore-named event vocabulary (9 durable + 3 live), the
 * hyphen-spelled 3-member `RerankProfile`, the 4-member `CapabilityKind`, the 8-member
 * `DegradationGap`, the 5-member `BindingState`/`GenerationState`, and a real-valued
 * `Confidence` in `[0,1]`. This mirror never redefines the event payload schemas owned
 * by `packages/schema/src/semantic/*`, nor the reserved catalog owned by
 * `packages/core/src/operator/catalog.ts` (C1, C15, C16, C20, C22).
 */

import type {
  CapabilityKind as SchemaCapabilityKind,
  Consistency as SchemaConsistency,
  EndpointMode as SchemaEndpointMode,
  Metric as SchemaMetric,
  ModelSource as SchemaModelSource,
  RerankProfile as SchemaRerankProfile,
  Slot as SchemaSlot,
  TransportProfile as SchemaTransportProfile,
  ValidationStatus as SchemaValidationStatus,
} from "@opencode-ai/schema/semantic/enums"
import type {
  BindingState as SchemaBindingState,
  Collection as SchemaCollection,
  DegradationGap as SchemaDegradationGap,
  GenerationState as SchemaGenerationState,
  ResidencyProfile as SchemaResidencyProfile,
  RetrievalMode as SchemaRetrievalMode,
  ToolRetrievalMode as SchemaToolRetrievalMode,
  ToolSource as SchemaToolSource,
  ToolSurface as SchemaToolSurface,
  ToolTriggerSource as SchemaToolTriggerSource,
} from "@opencode-ai/schema/semantic/enums-state"
import type { DocScope as SchemaDocScope } from "@opencode-ai/schema/semantic/documents"
import type { ToolDoc as SchemaToolDoc } from "@opencode-ai/schema/semantic/tool-doc"
import type { SemanticEventType as SchemaSemanticEventType } from "@opencode-ai/schema/semantic/event-types"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/semantic/ids.cue, refs.cue)
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

/** Opaque bounded token minted by Feature 005 OutputSpool for job outputs and skill chunk injection (FR40, C9). */
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
// Closed enums — SOURCED from @opencode-ai/schema/semantic/* (T014, single vocabulary)
// =============================================================================

/** The two fixed binding slots; V1 pins exactly one binding per slot (FR6, FR28). */
export type BindingSlot = SchemaSlot

/** The 5-member binding lifecycle; degraded/unavailable never auto-substitute (FR24, FR31, C12, C20). */
export type BindingState = SchemaBindingState

/** Probe/eval trust state; a manual declaration starts `declared` and is untrusted until `validated` (C16). */
export type ProbeState = SchemaValidationStatus

/** The three explicit rerank profiles; `embedding-similarity` (C) is NEVER reranker-eligible (FR30, C16). */
export type RerankProfile = SchemaRerankProfile

/** Provider transport compatibility profile; the OpenAI-compatible client is reused (FR29, C5). */
export type TransportProfile = SchemaTransportProfile

/** The invoked endpoint shape of a model descriptor (FR30, C5). */
export type EndpointMode = SchemaEndpointMode

/** The typed degradation ladder rung; catalog_lexical is the deterministic routing floor (FR24, C14, C20). */
export type DegradationRung = SchemaRetrievalMode

/** The 8-member stable capability-gap code recorded with every degraded outcome (FR24, C20, AC29). */
export type DegradationGapCode = SchemaDegradationGap

/** The 5-member blue/green index-generation lifecycle (FR12, C12). */
export type IndexGenerationState = SchemaGenerationState

/** Milvus consistency level; Bounded is the V1 default, Strong for admin verification reads (C6). */
export type ConsistencyLevel = SchemaConsistency

/** Dense-vector distance metric stored with the collection generation; never inferred (FR12, C7). */
export type MetricKind = SchemaMetric

/** The three Feature 006 collections plus the Feature 009 `tools` extension point (FR9, C6, C21). */
export type CollectionKind = SchemaCollection

/** Model descriptor provenance; a manual declaration is untrusted until probe/eval passes (FR28, C16). */
export type ModelSource = SchemaModelSource

/** The 4-member capability badge set; `embedding-similarity` never satisfies a reranker-slot check (FR30, C16). */
export type CapabilityKind = SchemaCapabilityKind

/** Data-residency posture for embedding/rerank providers; `local-offline` blocks egress (FR37, C4). */
export type ResidencyPolicy = SchemaResidencyProfile

/**
 * Reserved-catalog operator command scope (plan.md "Operator command surface", C15).
 * Protocol-surface projection narrower than the document `ScopeKind`; not a CUE enum.
 */
export type Scope = "project" | "global"

/** Stable error codes shared across ports; never a query, an endpoint, or a credential (C22). */
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
 * is the sole registration authority; this array never re-registers or diverges from
 * it and exists only to trace each port method to its canonical operator command ID.
 * Plugin/MCP/custom registries MUST NOT register any of these IDs (FR33, FR36).
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
// semantic.* event vocabulary (wire shape: doc/arch/schemas/semantic/event-types.cue)
// =============================================================================

/**
 * The nine durable settlement classes: carry the EventV2 `durable {version,
 * aggregate}` annotation and register via `EventV2.define` into
 * `packages/schema/src/durable-event-manifest.ts` through the single EventV2 authority
 * (C22). Binding/index-generation transitions and index maintenance outcomes; content,
 * queries and vectors are never an event payload (FR42).
 */
export const DURABLE_SEMANTIC_EVENT_TYPES = [
  "semantic.binding_selected",
  "semantic.binding_cutover",
  "semantic.binding_rolled_back",
  "semantic.index_upserted",
  "semantic.index_tombstoned",
  "semantic.index_reconciled",
  "semantic.generation_built",
  "semantic.generation_cutover",
  "semantic.generation_retired",
] as const

/**
 * The three live signal classes: omit `durable` (no sequence, no replay); MAY be
 * dropped under `allBounded` load without affecting durable binding/index state (C22).
 */
export const LIVE_SEMANTIC_EVENT_TYPES = [
  "semantic.retrieval_degraded",
  "semantic.provider_probed",
  "semantic.binding_state_changed",
] as const

export type DurableSemanticEventType = (typeof DURABLE_SEMANTIC_EVENT_TYPES)[number]
export type LiveSemanticEventType = (typeof LIVE_SEMANTIC_EVENT_TYPES)[number]

/**
 * The 12-member closed `semantic.*` event vocabulary (C22), SOURCED from
 * `@opencode-ai/schema/semantic/event-types` so protocol and schema never drift.
 */
export type SemanticEventType = SchemaSemanticEventType

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
  readonly compatibilityProfile: TransportProfile
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
  readonly endpointMode: EndpointMode
  readonly dimensions?: number
  readonly limits?: ModelLimits
  readonly languageSupport: readonly string[] // BCP 47 tags; multilingual pt-BR/es/en coverage (FR14, C3)
  readonly probeState: ProbeState
  readonly validatedAt?: string // ISO-8601
  readonly validationVersion?: number
  readonly enabled: boolean
}

/**
 * SSOT record (FR28). `compatibilityMode` is `"embedding"` for the embedding slot or
 * the selected {@link RerankProfile} for the reranker slot. The binding version is
 * immutable; a new version is created rather than mutated in place (FR12, FR31, C12).
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
// =============================================================================

/**
 * Structured task profile (stage 1 of the FR3 pipeline). `queryText` preserves the
 * original query for embedding; a mandatory translation LLM call is never required
 * (FR15, FR18).
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
 * deterministic tie-break: rerank score, then dense score, then sparse/lexical score,
 * then canonical ID/version (C2). `confidence` is real-valued in `[0,1]` (T014).
 */
export interface SemanticScore {
  readonly rerankScore?: number
  readonly denseScore: number
  readonly sparseScore?: number
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly confidence: number // real-valued [0,1], reconciled from the CUE score domain (FR22, C11)
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

/**
 * Feature 052 skill-chunk pass request — a single-collection recall over `skill_chunks`,
 * reusing `RetrievalResult` (candidates carry `kind: "skill_chunk"` and `chunkRef`). The
 * `collection` discriminant is fixed, mirroring `ToolRetrievalRequest`; the pass shares the
 * turn's single embedding and reranker binding with the other three surfaces (FR1).
 */
export interface SkillChunkRetrievalRequest extends RetrievalRequest {
  readonly collection: Extract<CollectionKind, "skill_chunks"> // fixed discriminator; CollectionKind reused (FR1)
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
 * Offline golden evaluation report. `leakageCount` MUST be zero to pass — the
 * zero-leakage tolerance is fixed, never a configurable threshold (FR43, C18).
 * Evaluation never mutates a binding.
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
// ProviderPort payloads — semantic.provider.* (FR29, FR33, FR35, C15, C17, C19)
// =============================================================================

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
// ModelPort payloads — semantic.model.* (FR28-FR30, C16)
// =============================================================================

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
  readonly endpointMode: EndpointMode
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
// BindingPort payloads — semantic.embedding.*, semantic.reranker.*, semantic.binding.*
// =============================================================================

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
  | { readonly type: "no_archived_prior"; readonly slot: BindingSlot } // guards a rollback whose slot archive holds no superseded prior (Feature 019 FR3)
  | { readonly type: "reranker_not_eligible"; readonly reason: string } // guards FR30, C16 — profile C never eligible
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// IndexPort payloads — semantic.index.* (FR7, FR9, FR13, C1, C6, C7)
// =============================================================================

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
// RetrievalPort payloads — retrieveAgents / retrieveSkills (FR3, FR18-FR27, C2, C9, C20)
// =============================================================================

export type RetrievalError =
  | { readonly type: "invalid_profile"; readonly reason: string }
  | {
      readonly type: "budget_exceeded"
      readonly field: "retrieval_top_k" | "rerank_top_k" | "max_skill_chunks" | "token_budget"
    } // guards FR38
  | { readonly type: "timeout" } // triggers C20 fallback at the call site, never a hard failure by itself
  | { readonly type: "fail_closed_denied"; readonly gapCode: DegradationGapCode } // guards operator opt-in fail-closed, C14, FR24
  | { readonly type: "not_implemented" }

// =============================================================================
// EvalPort payloads — semantic offline golden evaluation (FR43, C18)
// =============================================================================

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

// =============================================================================
// Feature 009 — Semantic Tool Search payloads (extends the 006 stack, no fork)
//
// Adds only the genuinely new tool wire shapes on top of the reused 006 surface.
// Every enum is SOURCED from `@opencode-ai/schema/semantic/*` (never redeclared),
// so the transport contract cannot drift from the wire authority; `TaskProfile`,
// `RetrievalFilters`, `SemanticScore`, `QueryFingerprint`, `CollectionKind`,
// `OutputRef`, `OperatorPrincipal` and `DegradationGapCode` are reused verbatim
// from the 006 mirror above (FR2, FR11, FR22, C2).
// Wire shape: doc/arch/schemas/semantic/{tool-shared,enums-tool,tool-retrieval,
// tool-trigger,tool-config}.cue and the sdd contracts/ports.ts sketch.
// =============================================================================

/** Composed canonical tool document id (native `tool.id`; MCP `toolName(client, name)`, FR6). */
export type ToolDocId = string

/** Stable content hash driving incremental upsert/tombstone; doubles as the C3 tie-break version leg (FR8). */
export type ToolContentHash = string

/** The four tool provenance sources (FR6, C6); sourced from `@opencode-ai/schema/semantic/enums-state`. */
export type ToolSource = SchemaToolSource

/**
 * The tool degradation ladder rung (C14); sourced from the schema `ToolRetrievalMode`,
 * distinct from the 006 `RetrievalMode` (`DegradationRung`) — the tool floor is the
 * unranked `full_set_passthrough` set, and `fail_closed` is the per-surface opt-in (C12).
 */
export type ToolRetrievalRung = SchemaToolRetrievalMode

/** The three tool-search consumption surfaces gated independently by Config.Service (FR21, C9, C12). */
export type ToolSearchSurface = SchemaToolSurface

/** The three C11 trigger sources; `mcp_tools_changed` is scoped to one server (C11b). */
export type ToolReindexTriggerSource = SchemaToolTriggerSource

/**
 * Protocol-layer tool-retrieval request. The schema `RetrievalRequest` already carries
 * `collection`; this adds the fixed `collection: "tools"` discriminator to the protocol
 * mirror (research.md), reusing `TaskProfile`/`RetrievalFilters` verbatim (C2, C7).
 */
export interface ToolRetrievalRequest {
  readonly profile: TaskProfile
  readonly retrievalTopK: number // inherits the 006 `Values.TopK` bound via the reused `budgetError` guard (C5)
  readonly rerankTopK: number // MUST be <= retrievalTopK, enforced by the reused `budgetError` guard (C5)
  readonly filters: RetrievalFilters
  readonly collection: Extract<CollectionKind, "tools"> // fixed discriminator; CollectionKind reused (C2, C7)
}

/** One candidate surviving the tool pass through stage 9 revalidation (FR3, FR11, C2). */
export interface ToolCandidate {
  readonly canonicalId: ToolDocId
  readonly canonicalVersion: ToolContentHash // C3: the tie-break version leg is the tool content hash
  readonly source: ToolSource
  readonly mcpServerRef?: string
  readonly score: SemanticScore // reused verbatim; the tie-break comparator is the same code (C3)
  readonly revalidated: boolean // never returned true before stage 9 completes
}

/** Explicit degraded outcome for one tool-retrieval call; never a silent empty result (FR18, FR19, C14). */
export interface ToolDegradationOutcome {
  readonly rung: ToolRetrievalRung
  readonly gapCode?: DegradationGapCode // reused verbatim; same typed codes, no tool-specific gap vocabulary
  readonly reason?: string
}

/** Stage-9 tool result; `cacheHit` reports {@link QueryFingerprint} reuse across surfaces (FR14, C8). */
export interface ToolRetrievalResult {
  readonly candidates: readonly ToolCandidate[]
  readonly degradation: ToolDegradationOutcome
  readonly queryFingerprint: QueryFingerprint // reused verbatim (C8)
  readonly cacheHit: boolean
}

/** The domain-layer tool pass outcome before facade assembly (mirrors the 006 `PipelineOutcome` shape, C2). */
export interface ToolPipelineOutcome {
  readonly candidates: readonly ToolCandidate[]
  readonly degradation: ToolDegradationOutcome
}

/** One raw trigger event before coalescing (FR8, C11); `mcpServerId` set only for `mcp_tools_changed` (C11b). */
export interface ToolReindexTriggerEvent {
  readonly source: ToolReindexTriggerSource
  readonly mcpServerId?: string
  readonly occurredAt: string // ISO-8601
}

/** One coalesced flush target after the bounded coalescing window closes (NFR2, C11). */
export interface ToolIndexFlushInput {
  readonly affectedMcpServerId?: string // narrows the reindex to one server's tool documents (C11b)
  readonly principal: OperatorPrincipal // "system" for automatic triggers, an operator principal for manual reindex (FR22)
}

/** Mirrors the reused 006 `IndexReindexOutput` shape for the `tools` collection (FR8, FR13, C7). */
export interface ToolIndexFlushOutput {
  readonly upsertedCount: number
  readonly tombstonedCount: number
  readonly outputRef: OutputRef // Feature 005 ref for the job log
}

/** Input to the sanitized ToolDoc projection (C6, FR6, FR7); sourced from the registry/MCP boundary. */
export interface ToolProjectionInput {
  readonly source: ToolSource
  readonly toolId: ToolDocId // native `tool.id`; MCP composed `toolName(client, name)`
  readonly displayName: string
  readonly mcpServerRef?: string
  readonly rawDescription: string // native `tool.description`; MCP `convertTool` description
  readonly rawParameterSchema: unknown // native `tool.jsonSchema`; MCP `convertTool` inputSchema — never stored raw
  readonly scope: SchemaDocScope // reused document scope; scalar project/permission partition (C13)
  readonly languageTag: string
}

/** Output of the sanitized ToolDoc projection; `sanitizedFieldsDropped` lists field NAMES only (AC18). */
export interface ToolProjectionOutput {
  readonly doc: SchemaToolDoc // reused schema projection entity (FR6, C6)
  readonly sanitizedFieldsDropped: readonly string[] // e.g. ["default","example","const","format"]; content-free
}

/**
 * One surface's tool-search configuration (FR21). `enabled` and `failClosed` both
 * default to `false` for every surface (C9, C12) — the V1 floor is the unranked
 * full-set passthrough, identical to today, until an operator opts a surface in.
 */
export interface ToolSearchSurfaceConfig {
  readonly surface: ToolSearchSurface
  readonly enabled: boolean // default false (C9)
  readonly failClosed: boolean // default false; per-surface, never global-only (C12)
  readonly retrievalTopK: number // inherits the 006 `Values.TopK` bound (C5)
  readonly rerankTopK: number // MUST be <= retrievalTopK (C5)
  readonly resultBound: number // small bounded result list, never unbounded (C5, FR13)
  readonly latencyBudgetMs: number // expiry triggers the C14 ladder, never blocks exposure (C5, NFR1)
  readonly cacheTtlMs: number // last-known index-metadata cache TTL; invalidates by binding_version/config_hash (C8)
}

export type ToolRetrievalError =
  | { readonly type: "invalid_profile"; readonly reason: string }
  | { readonly type: "budget_exceeded"; readonly field: "retrieval_top_k" | "rerank_top_k" | "result_bound" } // guards C5
  | { readonly type: "timeout" } // triggers the C14 ladder at the call site, never a hard failure by itself
  | { readonly type: "fail_closed_denied"; readonly surface: ToolSearchSurface; readonly gapCode?: DegradationGapCode } // guards the C12 opt-in
  | { readonly type: "not_implemented" }

export type ToolIndexError =
  | { readonly type: "milvus_unavailable"; readonly reason: string } // reused gap vocabulary shape, scoped to `tools`
  | { readonly type: "reconcile_in_progress"; readonly collection: Extract<CollectionKind, "tools"> }
  | { readonly type: "schema_projection_too_large"; readonly toolId: ToolDocId } // guards the AC18 size cap
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export type ToolSearchConfigError =
  | { readonly type: "invalid_argument"; readonly field: string }
  | { readonly type: "not_implemented" }
