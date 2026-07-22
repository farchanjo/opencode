/**
 * Feature 014 / T009 (FR8) — the config-backed half of the semantic registry.
 *
 * The Feature 006 semantic domain splits cleanly: the provider/model/binding
 * REGISTRY is ordinary config-backed state (no live Milvus, no provider network
 * call), while the index/reindex/cutover/validate/test ops genuinely need a live
 * Milvus/provider stack. This backend wires ONLY the config-backed half over the
 * SAME `Config.Service` round-trip seam (Feature 014 T002) the other operator
 * config domains use — reads project the persisted registry document; the
 * mutations VALIDATE and return an `OperatorMutationPlan` so the Feature 007
 * `mutateAuthority` pipeline owns the single committed CAS write + audit (the
 * backend never self-commits, so a rejected mutation persists nothing, FR5, FR14).
 *
 * Secrets are `SecretRef`-only (FR11): a provider credential and a rotation both
 * persist a bounded reference string, never a plaintext value, and the final
 * payload is scanned by the Feature 007 plaintext detector before it is planned.
 * Endpoints are parsed under an offline SSRF-safe static policy (scheme + TLS +
 * literal blocked-address check); full DNS-rebinding revalidation belongs to the
 * live `provider.test` probe, which stays a typed capability gap here (FR8, C17).
 */
export * as SemanticRegistryBackend from "./registry-backend"

import { Effect, Exit, Schema } from "effect"
import { findPlaintextSecretFields } from "@opencode-ai/core/operator/secret"
import { BindingLifecycle } from "@opencode-ai/core/semantic/binding-lifecycle"
import type { BindingState } from "@opencode-ai/core/semantic/binding-lifecycle"
import { CutoverExecutor } from "@/semantic/cutover-executor"
import { RerankClient } from "@/semantic/rerank-client"
import { UrlGuard } from "@/semantic/url-guard"
import type { ProbeFailed, ProbedVectorSpace } from "@/semantic/dimension-probe"
import { isTransientDataPlaneError, withDataPlaneRetry } from "@/util/effect-http-client"
import { DataPlaneRetryStats } from "@/semantic/data-plane-retry-stats"
import { type ConfigPort } from "@/operator/application/ports/config-port"
import type { MilvusPort } from "@/semantic/milvus-adapter"
import type { OperatorMutationEffectResult, OperatorMutationPlan } from "@/operator/application/handler"
import type {
  AddProviderInput,
  BindingError,
  CapabilityKind,
  CollectionKind,
  EndpointMode,
  MetricKind,
  ModelSource,
  ProbeState,
  BindingHistoryInput,
  BindingHistoryOutput,
  BindingSlot,
  BindingStatusInput,
  BindingStatusOutput,
  DeleteProviderInput,
  DisableModelInput,
  DisableProviderInput,
  ListModelsInput,
  ListModelsOutput,
  ListProvidersInput,
  ListProvidersOutput,
  ModelError,
  OperatorPrincipal,
  ProviderError,
  RegisterModelInput,
  RerankProfile,
  RotateSecretInput,
  SelectBindingInput,
  SemanticModelBinding,
  SemanticModelDescriptor,
  SemanticProviderProfile,
  ShowBindingInput,
  ShowBindingOutput,
  UpdateProviderInput,
} from "@opencode-ai/protocol/semantic/commands"

/** The project-scope `Config.Service` authority the semantic registry document lives under (mirrors pools `routing`). */
export const AUTHORITY = "semantic" as const

/** A bounded `SecretRef` coordinate string (`backend:name[@vN]`); anything else is treated as a plaintext leak (FR11). */
const SECRET_REF_PATTERN = /^[A-Za-z0-9._-]+:[^@\s]+(?:@v[1-9]\d*)?$/

// =============================================================================
// Persisted registry document (permissive, typed — round-trips losslessly)
// =============================================================================

const RegistryProvider = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  name: Schema.String,
  baseUrl: Schema.String,
  tlsRequired: Schema.Boolean,
  allowInsecureLocalProfile: Schema.Boolean,
  residency: Schema.String,
  secretRef: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  selectedBy: Schema.String,
})
type RegistryProvider = Schema.Schema.Type<typeof RegistryProvider>

const RegistryModel = Schema.Struct({
  id: Schema.String,
  providerProfileId: Schema.String,
  version: Schema.Number,
  displayName: Schema.String,
  /**
   * Feature 026 (FR2) — the provider-facing model name a rerank/embedding call sends
   * (`RegisterModelInput.modelRef`). Optional so a pre-026 record round-trips losslessly
   * (absent → falls back to the descriptor id); it feeds the flat descriptor projection and
   * the reranker validation probe's model argument.
   */
  modelRef: Schema.optional(Schema.String),
  endpointMode: Schema.String,
  declaredCapabilityKinds: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
  validationStatus: Schema.String,
})
type RegistryModel = Schema.Schema.Type<typeof RegistryModel>

const RegistryBinding = Schema.Struct({
  slot: Schema.String,
  modelDescriptorId: Schema.String,
  compatibilityMode: Schema.String,
  state: Schema.String,
  version: Schema.Number,
  selectedBy: Schema.String,
  selectedAt: Schema.String,
  /**
   * Feature 019 (FR3) — whether the staged candidate passed a deterministic validate
   * before a cutover. Optional so a pre-019 record decodes losslessly (absent → not
   * validated); a cutover on an unvalidated candidate is a typed `not_validated`.
   */
  validated: Schema.optional(Schema.Boolean),
})
type RegistryBinding = Schema.Schema.Type<typeof RegistryBinding>

/**
 * Feature 019 (FR5) — one persisted Milvus blue/green generation for the embedding
 * slot (ADR-0019 decision 3): the generation is physically built + validated in Milvus
 * BEFORE a cutover swaps the alias, so the operator record and the live index never
 * disagree. `state` walks `building → validated → live → superseded`; only a
 * `validated` (or `live`, for rollback) generation is a legal cutover source (cardinal
 * honesty). Content-free — a generation id + its vector space, never a vector body.
 */
const RegistryGeneration = Schema.Struct({
  generationId: Schema.String,
  state: Schema.String,
  dimension: Schema.Number,
  metric: Schema.String,
  bindingVersion: Schema.Number,
  collections: Schema.Array(Schema.String),
})
type RegistryGeneration = Schema.Schema.Type<typeof RegistryGeneration>

/**
 * Feature 019 (FR2, FR5) — the operator `RegistryDocument` carries a per-slot binding
 * VERSION ARCHIVE (ADR-0019 decision 3): the live `embedding`/`reranker` entry is the
 * current binding, `*Staged` is the in-flight candidate a `select` stages (kept apart
 * from the live one so a cutover can move the outgoing active into the archive), and
 * `*Archive` is the slot's superseded priors (newest-first) a rollback targets. The
 * embedding slot additionally persists `embeddingGenerations` (the Milvus blue/green
 * builds) and `embeddingLiveGeneration` (the alias target). Every new field is
 * `optional` so a pre-019 document round-trips losslessly (absent → normalized to
 * `null`/`[]`/`0`), never dropping providers/models on the first read.
 */
const RegistryDocument = Schema.Struct({
  providers: Schema.Array(RegistryProvider),
  models: Schema.Array(RegistryModel),
  embedding: Schema.NullOr(RegistryBinding),
  reranker: Schema.NullOr(RegistryBinding),
  embeddingStaged: Schema.optional(Schema.NullOr(RegistryBinding)),
  rerankerStaged: Schema.optional(Schema.NullOr(RegistryBinding)),
  embeddingArchive: Schema.optional(Schema.Array(RegistryBinding)),
  rerankerArchive: Schema.optional(Schema.Array(RegistryBinding)),
  /** Monotonic rerank cache/eval version; a reranker cutover/rollback bumps it (reEmbedded stays false, FR1). */
  rerankEvalVersion: Schema.optional(Schema.Number),
  /** The embedding slot's Milvus blue/green generations, newest-first (FR5). */
  embeddingGenerations: Schema.optional(Schema.Array(RegistryGeneration)),
  /** The generation id the live alias currently targets, or `null` when none is live (FR5). */
  embeddingLiveGeneration: Schema.optional(Schema.NullOr(Schema.String)),
})
type RegistryDocument = Schema.Schema.Type<typeof RegistryDocument>

const EMPTY_DOCUMENT: RegistryDocument = {
  providers: [],
  models: [],
  embedding: null,
  reranker: null,
  embeddingStaged: null,
  rerankerStaged: null,
  embeddingArchive: [],
  rerankerArchive: [],
  rerankEvalVersion: 0,
  embeddingGenerations: [],
  embeddingLiveGeneration: null,
}

/** The four collections that build + cut over TOGETHER under one CAS, never split (Feature 006 C6/C12). */
const GENERATION_COLLECTIONS: readonly CollectionKind[] = ["agents", "skills", "skill_chunks", "tools"]

const decodeDocument = Schema.decodeUnknownExit(RegistryDocument)
const encodeDocument = Schema.encodeSync(RegistryDocument)

/** Normalize the optional archive fields to their defaults so downstream transforms never branch on `undefined`. */
function normalizeDocument(doc: RegistryDocument): RegistryDocument {
  return {
    ...doc,
    embeddingStaged: doc.embeddingStaged ?? null,
    rerankerStaged: doc.rerankerStaged ?? null,
    embeddingArchive: doc.embeddingArchive ?? [],
    rerankerArchive: doc.rerankerArchive ?? [],
    rerankEvalVersion: doc.rerankEvalVersion ?? 0,
    embeddingGenerations: doc.embeddingGenerations ?? [],
    embeddingLiveGeneration: doc.embeddingLiveGeneration ?? null,
  }
}

/** Decode a persisted authority payload into a registry document; the empty document when absent/undecodable. */
function parseDocument(payload: unknown): RegistryDocument {
  if (payload === null || payload === undefined) return EMPTY_DOCUMENT
  const exit = decodeDocument(payload, { errors: "all" })
  return normalizeDocument(Exit.isSuccess(exit) ? exit.value : EMPTY_DOCUMENT)
}

// =============================================================================
// Registry backend seam
// =============================================================================

/**
 * The config-backed half of the semantic registry. Reads project the persisted
 * document; the `planX` methods VALIDATE and return an `OperatorMutationPlan` the
 * dispatcher commits under CAS. Milvus/provider-probe ops are NOT here — they stay
 * the typed capability gap on the port (FR8).
 */
export interface SemanticRegistryBackend {
  readonly listProviders: (input: ListProvidersInput) => Effect.Effect<ListProvidersOutput, ProviderError>
  readonly listModels: (input: ListModelsInput) => Effect.Effect<ListModelsOutput, ModelError>
  readonly showEmbedding: (input: ShowBindingInput) => Effect.Effect<ShowBindingOutput, BindingError>
  readonly showReranker: (input: ShowBindingInput) => Effect.Effect<ShowBindingOutput, BindingError>
  readonly bindingStatus: (input: BindingStatusInput) => Effect.Effect<BindingStatusOutput, BindingError>
  readonly bindingHistory: (input: BindingHistoryInput) => Effect.Effect<BindingHistoryOutput, BindingError>
  readonly planAddProvider: (input: AddProviderInput) => Effect.Effect<OperatorMutationPlan, ProviderError>
  readonly planUpdateProvider: (input: UpdateProviderInput) => Effect.Effect<OperatorMutationPlan, ProviderError>
  readonly planDisableProvider: (input: DisableProviderInput) => Effect.Effect<OperatorMutationPlan, ProviderError>
  readonly planDeleteProvider: (input: DeleteProviderInput) => Effect.Effect<OperatorMutationPlan, ProviderError>
  readonly planRotateSecret: (input: RotateSecretInput) => Effect.Effect<OperatorMutationPlan, ProviderError>
  readonly planRegisterModel: (input: RegisterModelInput) => Effect.Effect<OperatorMutationPlan, ModelError>
  readonly planDisableModel: (input: DisableModelInput) => Effect.Effect<OperatorMutationPlan, ModelError>
  readonly planSelectEmbedding: (input: SelectBindingInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planSelectReranker: (input: SelectBindingInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planValidateReranker: (input: BindingValidatePlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planValidateEmbedding: (input: BindingValidatePlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planCutoverReranker: (input: RerankerCutoverPlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planRollbackReranker: (input: RerankerRollbackPlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planReindexEmbedding: (input: EmbeddingReindexPlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planCutoverEmbedding: (input: EmbeddingCutoverPlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
  readonly planRollbackEmbedding: (input: EmbeddingRollbackPlanInput) => Effect.Effect<OperatorMutationPlan, BindingError>
}

/**
 * Feature 019 (FR3, FR32) — validate the staged candidate for one slot. There is no
 * `id`: a slot has exactly one in-flight `*Staged` candidate (the one a `select`
 * staged), so validate always targets it. On success it promotes the candidate to
 * `{ state: "staged", validated: true }` (the machine `draft --validate--> staged`),
 * the ONLY config-backed path that produces a validated candidate a cutover may
 * activate. A rejected validate persists nothing (no fake `validated`).
 */
export interface BindingValidatePlanInput {
  readonly principal: OperatorPrincipal
}

/**
 * Feature 019 (FR3, FR32) — the reranker validation probe seam: the ONLY
 * provider-network call in the reranker lifecycle. `run` executes the native/structured
 * rerank probe (`rerank-client`) against the staged candidate's provider endpoint and
 * reports pass/fail — never a document, a vector, or a secret. When ABSENT (no probe
 * composed from the runtime) the config-backed `planValidateReranker` returns the honest
 * typed gap, never a fabricated `validated` (cardinal honesty for the reranker slot).
 */
/**
 * Feature 050 (FR6) — the reranker capability envelope captured alongside the
 * pass/fail boolean where cheaply available (the modes tried, the observed score
 * range). A mode absent from `modes` is never eligible for that reranker slot.
 */
export interface RerankCapabilities {
  readonly modes: ReadonlyArray<RerankProfile>
  readonly maxDocuments?: number
  readonly contextWindow?: number
  readonly scoreRange?: { readonly min: number; readonly max: number }
  readonly probedAt: string
}

export interface RerankValidationProbe {
  readonly run: (input: {
    readonly baseUrl: string
    readonly profile: RerankProfile
    readonly modelDescriptorId: string
    /**
     * Feature 026 (FR2) — the provider-facing model name the rerank call sends (the registered
     * `modelRef`, falling back to the descriptor id). Kept distinct from `modelDescriptorId` (the
     * registry's internal id) so the probe addresses the real provider model.
     */
    readonly modelRef: string
    /**
     * Feature 026 (FR2) — the provider's bounded `SecretRef` COORDINATE string (never plaintext).
     * The composed probe resolves it to an Authorization header internally (redaction intact); it
     * is never logged, echoed, or returned. Empty when the provider carries no secret.
     */
    readonly secretRef: string
  }) => Promise<{ readonly passed: boolean; readonly capabilities?: RerankCapabilities }>
}

/**
 * Feature 019 (FR1) — a config-backed reranker cutover. It carries no `MilvusPort`
 * and no domain version: the authority CAS token (the dispatcher `version`) is the
 * single compare-and-swap gate, and the pure `cutoverReranker` supplies the
 * confirmation gate + `reEmbedded:false` invariant.
 */
export interface RerankerCutoverPlanInput {
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

/**
 * Feature 019 (FR3) — a config-backed reranker rollback. `targetBindingVersion`
 * selects a specific superseded prior; unset resolves the most recent archived
 * version. An empty archive is a typed `no_archived_prior`, never a fabricated swap.
 */
export interface RerankerRollbackPlanInput {
  readonly targetBindingVersion?: number
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

/**
 * Feature 019 (FR5, FR6) — build + validate a blue/green Milvus generation for the
 * staged embedding candidate. The effect physically creates the generation in Milvus
 * (`building → validated`) and the apply records it on the document; `select` alone
 * never reaches here. Requires a bound live Milvus port — unconfigured → `milvus_unavailable`.
 */
export interface EmbeddingReindexPlanInput {
  readonly principal: OperatorPrincipal
}

/**
 * Feature 019 (FR5) — activate a validated embedding generation. The cardinal honesty
 * rule holds: a `validated` generation MUST already exist; the effect swaps the alias
 * across EVERY collection together under one CAS; a contention swaps nothing. A
 * config-only flip is never a cutover.
 */
export interface EmbeddingCutoverPlanInput {
  /** The generation to activate; unset resolves the newest `validated` generation. */
  readonly generationId?: string
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

/** Feature 019 (FR5) — restore a superseded embedding generation + its archived binding prior. */
export interface EmbeddingRollbackPlanInput {
  readonly targetBindingVersion?: number
  readonly confirmed: boolean
  readonly principal: OperatorPrincipal
}

export interface ConfigBackedRegistryDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write (default `Date.now`). */
  readonly clock?: () => number
  /** Stable id generator for new provider/model records (default `crypto.randomUUID`). */
  readonly idGen?: () => string
  /**
   * Feature 019 (FR4, FR5) — the live Milvus port bound when an endpoint is
   * configured. When present, `planReindexEmbedding`/`planCutoverEmbedding`/
   * `planRollbackEmbedding` physically build a generation and swap the alias in their
   * effects; when ABSENT every embedding-index plan is the exact typed
   * `milvus_unavailable` floor — never a config-only alias flip (cardinal honesty).
   */
  readonly milvus?: MilvusPort
  /**
   * Feature 019 (FR3, FR32) — the reranker validation probe. When present,
   * `planValidateReranker` runs it in the plan effect (after CAS, per the 017
   * effectful-plan contract) and promotes the staged reranker candidate to
   * `validated` only on a passing probe; when ABSENT the verb is the honest typed gap
   * — never a fabricated `validated`. The reranker slot has NO Milvus dependency, so
   * this probe is its only backend-readiness input.
   */
  readonly rerankProbe?: RerankValidationProbe
  /**
   * Feature 050 (FR6) — the model-driven embedding dimension/capability probe. When
   * present, `generationVectorSpace` DISCOVERS the real vector space from the staged
   * model (never a default); a probe failure fails the reindex plan closed with a
   * typed capability gap, never a silent `1024`. Production (`stack-live`) always
   * supplies this; a `probe_failed` never reaches `buildGeneration`.
   */
  readonly embeddingProbe?: (input: {
    readonly baseUrl: string
    readonly modelRef: string
    readonly secretRef: string
  }) => Promise<ProbedVectorSpace | ProbeFailed>
  /**
   * Test seam ONLY — a fixed dimension/metric used when it is explicitly provided AND
   * no `embeddingProbe` is configured (preserves the pre-050 unit tests). Production
   * always wires the probe, so this default is never taken there (FR6).
   */
  readonly defaultDimension?: number
  /** Test-seam metric paired with `defaultDimension`; never consulted when a probe is wired. */
  readonly defaultMetric?: MetricKind
}

// =============================================================================
// Projections — persisted record → protocol output shape
// =============================================================================

/** Project a persisted provider onto the operator-facing profile (a reshape of real state, never fabricated). */
function toProfile(p: RegistryProvider): SemanticProviderProfile {
  return {
    id: p.id,
    version: p.version,
    identity: { name: p.name, base_url: p.baseUrl, transport: p.tlsRequired ? "tls" : "insecure-local" },
    transport: { tls_policy: p.tlsRequired ? "required" : "optional", residency: p.residency, insecure_allowed: p.allowInsecureLocalProfile },
    credentials: { secret_ref: p.secretRef, headers: {} },
    audit: { enabled: p.enabled, created_at: p.createdAt, updated_at: p.updatedAt, selected_by: p.selectedBy },
  } as unknown as SemanticProviderProfile
}

/**
 * Vector-space dimension for a model when a matching embedding generation is known
 * (live alias, or a generation pinned to the active/staged embedding binding version).
 * Honest-absent when no generation applies — never a fabricated default.
 */
function dimensionForModel(doc: RegistryDocument, modelId: string): number | undefined {
  const gens = doc.embeddingGenerations ?? []
  if (gens.length === 0) return undefined
  const match = (binding: RegistryBinding | null): number | undefined => {
    if (binding === null || binding.modelDescriptorId !== modelId) return undefined
    const byVersion = gens.find((g) => g.bindingVersion === binding.version)
    if (byVersion !== undefined) return byVersion.dimension
    return undefined
  }
  const liveId = doc.embeddingLiveGeneration
  const liveGen = liveId ? gens.find((g) => g.generationId === liveId) : undefined
  const emb = currentOf(doc, "embedding")
  if (emb?.modelDescriptorId === modelId && liveGen !== undefined) return liveGen.dimension
  return match(emb) ?? match(stagedOf(doc, "embedding"))
}

/**
 * Project a persisted model onto the FLAT operator-facing descriptor (Feature 026 FR3).
 * The protocol `SemanticModelDescriptor` (packages/protocol/src/semantic/commands.ts) and the
 * TUI `isModelDescriptor` guard require a FLAT `{ displayName, capabilityKinds, probeState,
 * enabled, ... }` shape — the prior nested `{ identity.display_name, capability.kinds,
 * validation.status }` cast projected a shape the guard rejected as `shape_mismatch`, so the
 * panel rendered "no model descriptors". This emits the flat protocol shape directly (no
 * `as unknown` shape cast; only closed-enum string narrowings), so the panel renders every
 * registered model and the reranker selector can find its validated candidates. When a
 * matching embedding generation is known, `dimensions` is projected so the TUI no longer
 * shows an unconditional `dims: -`.
 */
function toDescriptor(m: RegistryModel, doc?: RegistryDocument): SemanticModelDescriptor {
  const dimensions = doc === undefined ? undefined : dimensionForModel(doc, m.id)
  return {
    id: m.id,
    providerProfileId: m.providerProfileId,
    modelRef: m.modelRef ?? m.id,
    displayName: m.displayName,
    source: "manual" as ModelSource,
    capabilityKinds: m.declaredCapabilityKinds as readonly CapabilityKind[],
    endpointMode: m.endpointMode as EndpointMode,
    languageSupport: [],
    probeState: m.validationStatus as ProbeState,
    enabled: m.enabled,
    ...(dimensions !== undefined ? { dimensions } : {}),
  }
}

/** Project a persisted binding onto the operator-facing binding view. */
function toBinding(b: RegistryBinding, providerRef: string): SemanticModelBinding {
  return {
    id: `${b.slot}:${b.modelDescriptorId}`,
    slot: b.slot,
    bindingVersion: b.version,
    providerProfileId: providerRef,
    modelDescriptorId: b.modelDescriptorId,
    compatibilityMode: b.compatibilityMode,
    capabilityContract: [],
    state: b.state,
    selectedBy: b.selectedBy,
    selectedAt: b.selectedAt,
    configHash: "",
  } as unknown as SemanticModelBinding
}

/** The provider ref that backs a binding's model, or empty when the model is gone. */
function providerRefOf(doc: RegistryDocument, modelDescriptorId: string): string {
  return doc.models.find((m) => m.id === modelDescriptorId)?.providerProfileId ?? ""
}

// =============================================================================
// Per-slot binding version archive (Feature 019, FR2) — current + superseded
// =============================================================================

type Slot = "embedding" | "reranker"

/** The live (current) binding for a slot, or `null` when none is active/selected. */
function currentOf(doc: RegistryDocument, slot: Slot): RegistryBinding | null {
  return (slot === "reranker" ? doc.reranker : doc.embedding) ?? null
}

/** The in-flight candidate a `select` staged for a slot, kept apart from the live binding. */
function stagedOf(doc: RegistryDocument, slot: Slot): RegistryBinding | null {
  return (slot === "reranker" ? doc.rerankerStaged : doc.embeddingStaged) ?? null
}

/** The slot's superseded priors (newest-first); each is a real rollback target. */
function archiveOf(doc: RegistryDocument, slot: Slot): readonly RegistryBinding[] {
  return (slot === "reranker" ? doc.rerankerArchive : doc.embeddingArchive) ?? []
}

/** The next monotonic binding version for a slot: one past the highest known across current/staged/archive. */
function nextBindingVersion(doc: RegistryDocument, slot: Slot): number {
  const known = [currentOf(doc, slot), stagedOf(doc, slot), ...archiveOf(doc, slot)]
  return known.reduce((max, b) => (b && b.version > max ? b.version : max), 0) + 1
}

/** The honest degradation rung derived from real state: an active embedding binding is `full_semantic`, else the `catalog_lexical` floor. */
function degradationRung(doc: RegistryDocument): BindingStatusOutput["degradation"] {
  const rung = doc.embedding && doc.embedding.state === "active" ? "full_semantic" : "catalog_lexical"
  return { rung } as BindingStatusOutput["degradation"]
}

/** Compose a slot's version history newest-first: the staged candidate, the live binding, then the superseded archive. */
function slotHistory(doc: RegistryDocument, slot: Slot): readonly RegistryBinding[] {
  return [stagedOf(doc, slot), currentOf(doc, slot), ...archiveOf(doc, slot)].filter(
    (b): b is RegistryBinding => b !== null,
  )
}

/** Resolve the rollback target from a slot archive: an explicit version, else the most recent prior; `undefined` when none. */
function resolveRollbackTarget(
  archive: readonly RegistryBinding[],
  targetVersion: number | undefined,
): RegistryBinding | undefined {
  if (archive.length === 0) return undefined
  if (targetVersion === undefined) return archive[0]
  return archive.find((b) => b.version === targetVersion)
}

/** The embedding slot's persisted generations, newest-first. */
function generationsOf(doc: RegistryDocument): readonly RegistryGeneration[] {
  return doc.embeddingGenerations ?? []
}

/** The newest generation whose state is a legal cutover source (`validated`), or the requested one. */
function resolveCutoverGeneration(doc: RegistryDocument, generationId: string | undefined): RegistryGeneration | undefined {
  const gens = generationsOf(doc)
  if (generationId !== undefined) return gens.find((g) => g.generationId === generationId && g.state === "validated")
  return gens.find((g) => g.state === "validated")
}

/** The generation a rollback restores: the newest `superseded` generation. */
function resolveRollbackGeneration(doc: RegistryDocument): RegistryGeneration | undefined {
  return generationsOf(doc).find((g) => g.state === "superseded")
}

// =============================================================================
// Validation helpers
// =============================================================================

/** Offline SSRF-safe static endpoint check: scheme, TLS policy, and literal blocked-address (FR8, C17). */
function staticUrlDefect(baseUrl: string, allowInsecureLocalProfile: boolean): ProviderError | null {
  const url = UrlGuard.parseUrl(baseUrl)
  if (url === null) return { type: "invalid_url", reason: `malformed endpoint: ${baseUrl.slice(0, 80)}` }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { type: "invalid_url", reason: `unsupported scheme ${url.protocol}` }
  if (url.protocol === "http:" && !allowInsecureLocalProfile) return { type: "invalid_url", reason: "remote endpoint requires TLS" }
  if (UrlGuard.isBlockedAddress(url.hostname) && !allowInsecureLocalProfile) return { type: "ssrf_blocked", host: url.hostname }
  return null
}

/** A well-formed `SecretRef` coordinate string, or a typed error when it looks like plaintext (FR11). */
function secretRefDefect(secretRef: string | undefined): ProviderError | null {
  if (secretRef === undefined || secretRef.length === 0) return null
  if (SECRET_REF_PATTERN.test(secretRef)) return null
  return { type: "secret_backend_unavailable" }
}

/** Reject a document that would persist a plaintext secret; a bare `SecretRef` string is allowed (FR11). */
function plaintextDefect(doc: RegistryDocument): boolean {
  return findPlaintextSecretFields(doc).length > 0
}

export function createConfigBackedRegistry(deps: ConfigBackedRegistryDeps): SemanticRegistryBackend {
  const clock = deps.clock ?? Date.now
  const idGen = deps.idGen ?? (() => crypto.randomUUID())

  /** Read the persisted registry document; a Config.Service outage degrades to `unavailable` (FR14). */
  const readDoc = <E>(unavailable: (reason: string) => E): Effect.Effect<RegistryDocument, E> =>
    Effect.tryPromise({
      try: () => deps.config.get(AUTHORITY),
      catch: (cause) => unavailable(String(cause)),
    }).pipe(Effect.map((entry) => parseDocument(entry?.payload ?? null)))

  const providerUnavailable = (reason: string): ProviderError => ({ type: "unavailable", reason })
  const modelUnavailable = (reason: string): ModelError => ({ type: "unavailable", reason })
  const bindingUnavailable = (reason: string): BindingError => ({ type: "unavailable", reason })

  /** Wrap a pure document transform into a plan whose `apply` re-derives off the committed CAS base. */
  const asPlan = (transform: (doc: RegistryDocument) => RegistryDocument): OperatorMutationPlan => ({
    authority: AUTHORITY,
    apply: (current: unknown) => encodeDocument(transform(parseDocument(current))),
  })

  return {
    listProviders: () =>
      readDoc(providerUnavailable).pipe(Effect.map((doc) => ({ profiles: doc.providers.map(toProfile) }))),

    listModels: (input) =>
      readDoc(modelUnavailable).pipe(
        Effect.map((doc) => ({
          descriptors: doc.models
            .filter((m) => input.providerProfileId === undefined || m.providerProfileId === input.providerProfileId)
            .map((m) => toDescriptor(m, doc)),
        })),
      ),

    showEmbedding: () =>
      readDoc(bindingUnavailable).pipe(
        Effect.map((doc) => {
          const binding = currentOf(doc, "embedding") ?? stagedOf(doc, "embedding")
          return { binding: binding ? toBinding(binding, providerRefOf(doc, binding.modelDescriptorId)) : undefined }
        }),
      ),

    showReranker: () =>
      readDoc(bindingUnavailable).pipe(
        Effect.map((doc) => {
          const binding = currentOf(doc, "reranker") ?? stagedOf(doc, "reranker")
          return { binding: binding ? toBinding(binding, providerRefOf(doc, binding.modelDescriptorId)) : undefined }
        }),
      ),

    // The degradation rung is now DERIVED from real binding state, not hardcoded (FR2).
    bindingStatus: () =>
      readDoc(bindingUnavailable).pipe(
        Effect.map((doc) => ({
          embedding: doc.embedding ? toBinding(doc.embedding, providerRefOf(doc, doc.embedding.modelDescriptorId)) : undefined,
          reranker: doc.reranker ? toBinding(doc.reranker, providerRefOf(doc, doc.reranker.modelDescriptorId)) : undefined,
          degradation: degradationRung(doc),
        })),
      ),

    // The real per-slot archive (staged + current + superseded), not a single entry (FR2).
    bindingHistory: (input) =>
      readDoc(bindingUnavailable).pipe(
        Effect.map((doc) => ({
          versions: slotHistory(doc, input.slot === "reranker" ? "reranker" : "embedding")
            .slice(0, input.limit)
            .map((b) => toBinding(b, providerRefOf(doc, b.modelDescriptorId))),
        })),
      ),

    planAddProvider: (input) =>
      Effect.gen(function* () {
        const urlDefect = staticUrlDefect(input.baseUrl, input.transportPolicy.allowInsecureLocalProfile)
        if (urlDefect !== null) return yield* Effect.fail(urlDefect)
        const secretDefect = secretRefDefect(input.secretRef)
        if (secretDefect !== null) return yield* Effect.fail(secretDefect)
        const now = new Date(clock()).toISOString()
        const record: RegistryProvider = {
          id: `prov_${idGen()}`,
          version: 1,
          name: input.name,
          baseUrl: input.baseUrl,
          tlsRequired: input.transportPolicy.tlsRequired,
          allowInsecureLocalProfile: input.transportPolicy.allowInsecureLocalProfile,
          residency: input.residency,
          secretRef: input.secretRef ?? null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          selectedBy: input.principal.id,
        }
        return yield* guardedPlan<ProviderError>((doc) => ({ ...doc, providers: [...doc.providers, record] }), providerUnavailable)
      }),

    planUpdateProvider: (input) =>
      Effect.gen(function* () {
        const doc = yield* readDoc(providerUnavailable)
        const existing = doc.providers.find((p) => p.id === input.id)
        if (existing === undefined) return yield* Effect.fail<ProviderError>({ type: "not_found", id: input.id })
        if (existing.version !== input.expectedVersion) return yield* Effect.fail<ProviderError>({ type: "version_conflict", expectedVersion: input.expectedVersion, actualVersion: existing.version })
        const patched = applyProviderPatch(existing, input.patch, new Date(clock()).toISOString())
        const urlDefect = staticUrlDefect(patched.baseUrl, patched.allowInsecureLocalProfile)
        if (urlDefect !== null) return yield* Effect.fail(urlDefect)
        return yield* guardedPlan<ProviderError>((d) => ({ ...d, providers: replaceProvider(d.providers, input.id, (p) => ({ ...applyProviderPatch(p, input.patch, patched.updatedAt), version: p.version + 1 })) }), providerUnavailable)
      }),

    planDisableProvider: (input) =>
      planProviderVersioned(input.id, input.expectedVersion, (p) => ({ ...p, enabled: false, version: p.version + 1, updatedAt: new Date(clock()).toISOString() })),

    planDeleteProvider: (input) =>
      Effect.gen(function* () {
        const doc = yield* readDoc(providerUnavailable)
        const existing = doc.providers.find((p) => p.id === input.id)
        if (existing === undefined) return yield* Effect.fail<ProviderError>({ type: "not_found", id: input.id })
        if (existing.version !== input.expectedVersion) return yield* Effect.fail<ProviderError>({ type: "version_conflict", expectedVersion: input.expectedVersion, actualVersion: existing.version })
        if (!input.confirmed) return yield* Effect.fail<ProviderError>({ type: "confirmation_required" })
        return yield* guardedPlan<ProviderError>((d) => ({ ...d, providers: d.providers.filter((p) => p.id !== input.id) }), providerUnavailable)
      }),

    // Secret rotation swaps only the ref (never the endpoint/identity/version, FR31).
    planRotateSecret: (input) =>
      Effect.gen(function* () {
        const secretDefect = secretRefDefect(input.newSecretRef)
        if (secretDefect !== null) return yield* Effect.fail(secretDefect)
        return yield* planProviderVersioned(input.id, input.expectedVersion, (p) => ({ ...p, secretRef: input.newSecretRef, updatedAt: new Date(clock()).toISOString() }))
      }),

    planRegisterModel: (input) =>
      Effect.gen(function* () {
        const doc = yield* readDoc(modelUnavailable)
        if (!doc.providers.some((p) => p.id === input.providerProfileId)) return yield* Effect.fail<ModelError>({ type: "provider_not_found", providerProfileId: input.providerProfileId })
        const record: RegistryModel = {
          id: `model_${idGen()}`,
          providerProfileId: input.providerProfileId,
          version: 1,
          displayName: input.displayName,
          modelRef: input.modelRef,
          endpointMode: input.endpointMode,
          declaredCapabilityKinds: input.declaredCapabilityKinds.map(String),
          enabled: true,
          validationStatus: "declared",
        }
        return yield* guardedPlan<ModelError>((d) => ({ ...d, models: [...d.models, record] }), modelUnavailable)
      }),

    planDisableModel: (input) =>
      Effect.gen(function* () {
        const doc = yield* readDoc(modelUnavailable)
        const existing = doc.models.find((m) => m.id === input.id)
        if (existing === undefined) return yield* Effect.fail<ModelError>({ type: "not_found", id: input.id })
        if (existing.version !== input.expectedVersion) return yield* Effect.fail<ModelError>({ type: "unavailable", reason: `version conflict: expected ${input.expectedVersion}, actual ${existing.version}` })
        return yield* guardedPlan<ModelError>((d) => ({ ...d, models: replaceModel(d.models, input.id, (m) => ({ ...m, enabled: false, version: m.version + 1 })) }), modelUnavailable)
      }),

    planSelectEmbedding: (input) => planSelect(input, "embedding"),
    planSelectReranker: (input) => planSelect(input, "reranker"),
    planValidateReranker: (input) => planValidateReranker(input),
    planValidateEmbedding: (input) => planValidateEmbedding(input),
    planCutoverReranker: (input) => planCutoverReranker(input),
    planRollbackReranker: (input) => planRollbackReranker(input),
    planReindexEmbedding: (input) => planReindexEmbedding(input),
    planCutoverEmbedding: (input) => planCutoverEmbedding(input),
    planRollbackEmbedding: (input) => planRollbackEmbedding(input),
  }

  /**
   * Feature 050 (FR6) — DISCOVER the vector space from the staged model via the
   * injected embedding probe, never a hardcoded default. On a probe failure with no
   * discovered dimension the reindex plan FAILS CLOSED with a typed capability gap
   * (`not_validated`), never reaching `buildGeneration` with a guessed dimension. The
   * `defaultDimension`/`defaultMetric` deps remain ONLY as a test seam, taken solely
   * when no probe is configured (production always wires the probe).
   */
  function generationVectorSpace(
    doc: RegistryDocument,
    model: RegistryModel | undefined,
  ): Effect.Effect<{ dimension: number; metric: MetricKind }, BindingError> {
    return Effect.gen(function* () {
      const probe = deps.embeddingProbe
      if (probe !== undefined && model !== undefined) {
        const provider = doc.providers.find((p) => p.id === model.providerProfileId)
        const result = yield* Effect.promise(() =>
          probe({
            baseUrl: provider?.baseUrl ?? "",
            modelRef: model.modelRef ?? model.id,
            secretRef: provider?.secretRef ?? "",
          }),
        )
        if ("type" in result) return yield* Effect.fail<BindingError>({ type: "not_validated", id: model.id })
        // Assert the probed metric against the shipped enum BEFORE it is written to the document (research risk).
        const metric: MetricKind = result.metric === "inner-product" ? "inner-product" : "cosine"
        return { dimension: result.dimension, metric }
      }
      if (deps.defaultDimension !== undefined) {
        return { dimension: deps.defaultDimension, metric: deps.defaultMetric ?? ("cosine" as MetricKind) }
      }
      return yield* Effect.fail<BindingError>({ type: "not_validated", id: model?.id ?? "" })
    })
  }

  /** Run one Milvus port effect to a deferred `OperatorMutationEffectResult` (bounded, secret-free reason). */
  function milvusEffect<A>(
    port: MilvusPort,
    run: (p: MilvusPort) => Effect.Effect<A, { readonly type: string; readonly reason?: string }>,
    onValue: (value: A) => OperatorMutationEffectResult,
  ): Promise<OperatorMutationEffectResult> {
    return Effect.runPromise(
      run(port).pipe(
        Effect.match({
          onSuccess: onValue,
          onFailure: (gap): OperatorMutationEffectResult =>
            gap.type === "cas_conflict"
              ? { ok: false, code: "conflict", message: "alias generation moved under the swap" }
              : { ok: false, code: "unavailable", message: "milvus_unavailable" },
        }),
      ),
    )
  }

  /**
   * Feature 019 (FR5, FR6) — build + validate a blue/green generation for the staged
   * embedding candidate. The effect physically creates the generation in Milvus and the
   * apply records it `validated` on the document; an unbound port or an unreachable
   * endpoint aborts with `milvus_unavailable` and commits nothing (cardinal honesty).
   */
  function planReindexEmbedding(input: EmbeddingReindexPlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      const port = deps.milvus
      if (port === undefined) return yield* Effect.fail<BindingError>({ type: "unavailable", reason: "milvus_unavailable" })
      const staged = stagedOf(doc, "embedding")
      // A generation is built for a SELECTED (draft) or re-staged candidate; reindex PRECEDES
      // validate for the embedding slot (the built generation is what `validate` then requires),
      // so reindex must NOT itself demand `validated`. An active/degraded slot is an illegal source.
      if (staged === null) return yield* Effect.fail<BindingError>({ type: "no_candidate_staged" })
      if (BindingLifecycle.apply(staged.state as BindingState, "reindex").kind === "illegal") {
        return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged.modelDescriptorId })
      }
      const generationId = `gen_${idGen()}`
      const model = doc.models.find((m) => m.id === staged.modelDescriptorId)
      const space = yield* generationVectorSpace(doc, model)
      const record: RegistryGeneration = {
        generationId,
        state: "validated",
        dimension: space.dimension,
        metric: space.metric,
        bindingVersion: staged.version,
        collections: GENERATION_COLLECTIONS.map(String),
      }
      const plan: OperatorMutationPlan = {
        authority: AUTHORITY,
        effect: () =>
          milvusEffect(
            port,
            // Feature 050 (FR12) — bounded transient-only retry on the maintenance build; a
            // `milvus_unavailable`/transport gap retries (≤3), a domain gap never does.
            (p) =>
              withDataPlaneRetry(
                p.buildGeneration({ collections: GENERATION_COLLECTIONS, generationId, dimension: space.dimension, metric: space.metric }),
                isTransientDataPlaneError,
                { onRetry: DataPlaneRetryStats.record },
              ),
            () => ({ ok: true }),
          ),
        apply: (current) => {
          const base = parseDocument(current)
          return encodeDocument({ ...base, embeddingGenerations: [record, ...generationsOf(base)] })
        },
      }
      return plan
    })
  }

  /**
   * Feature 019 (FR5) — activate a validated embedding generation under the cardinal
   * honesty rule: a `validated` generation MUST exist; the effect swaps the alias across
   * every collection together via `cutoverEmbedding` (CAS decided in-core, contention
   * swaps nothing); the apply promotes the staged binding to `active`, archives the prior,
   * and marks the generation `live`. `select`/`reindex` alone never reach here.
   */
  function planCutoverEmbedding(input: EmbeddingCutoverPlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      const port = deps.milvus
      if (port === undefined) return yield* Effect.fail<BindingError>({ type: "unavailable", reason: "milvus_unavailable" })
      const staged = stagedOf(doc, "embedding")
      if (staged === null || staged.validated !== true) {
        return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged?.modelDescriptorId ?? "" })
      }
      const generation = resolveCutoverGeneration(doc, input.generationId)
      // Cardinal honesty: no physically built + validated generation → refuse; never a config-only flip.
      if (generation === undefined) return yield* Effect.fail<BindingError>({ type: "no_candidate_staged" })
      if (!input.confirmed) return yield* Effect.fail<BindingError>({ type: "confirmation_required" })
      const liveGeneration = doc.embeddingLiveGeneration ?? generation.generationId
      const plan: OperatorMutationPlan = {
        authority: AUTHORITY,
        effect: () =>
          milvusEffect(
            port,
            (p) =>
              CutoverExecutor.cutoverEmbedding(
                { milvus: p },
                {
                  collections: GENERATION_COLLECTIONS,
                  fromGeneration: liveGeneration,
                  toGeneration: generation.generationId,
                  casExpected: input.generationId ?? generation.generationId,
                  casActual: generation.generationId,
                  confirmed: true,
                  bindingVersion: generation.bindingVersion,
                },
              ).pipe(
                Effect.flatMap((outcome) =>
                  outcome.kind === "committed"
                    ? Effect.succeed(outcome)
                    : Effect.fail({ type: "cas_conflict", reason: "cutover did not commit" }),
                ),
              ),
            () => ({ ok: true }),
          ),
        apply: (current) => encodeDocument(activateEmbedding(parseDocument(current), generation.generationId, input.principal.id)),
      }
      return plan
    })
  }

  /**
   * Feature 019 (FR5) — restore the newest superseded embedding generation + its archived
   * binding prior. The effect swaps the alias back; the apply restores the prior binding
   * `active` and re-marks the generation `live`. No superseded prior → `no_archived_prior`.
   */
  function planRollbackEmbedding(input: EmbeddingRollbackPlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      const port = deps.milvus
      if (port === undefined) return yield* Effect.fail<BindingError>({ type: "unavailable", reason: "milvus_unavailable" })
      const target = resolveRollbackTarget(archiveOf(doc, "embedding"), input.targetBindingVersion)
      const generation = resolveRollbackGeneration(doc)
      if (target === undefined || generation === undefined) {
        return yield* Effect.fail<BindingError>({ type: "no_archived_prior", slot: "embedding" as BindingSlot })
      }
      if (!input.confirmed) return yield* Effect.fail<BindingError>({ type: "confirmation_required" })
      const liveGeneration = doc.embeddingLiveGeneration ?? generation.generationId
      const plan: OperatorMutationPlan = {
        authority: AUTHORITY,
        effect: () =>
          milvusEffect(
            port,
            (p) =>
              CutoverExecutor.rollbackEmbedding(
                { milvus: p },
                {
                  collections: GENERATION_COLLECTIONS,
                  targetGeneration: generation.generationId,
                  casExpected: liveGeneration,
                  casActual: liveGeneration,
                  confirmed: true,
                  bindingVersion: target.version,
                },
              ).pipe(
                Effect.flatMap((outcome) =>
                  outcome.kind === "committed"
                    ? Effect.succeed(outcome)
                    : Effect.fail({ type: "cas_conflict", reason: "rollback did not commit" }),
                ),
              ),
            () => ({ ok: true }),
          ),
        apply: (current) => encodeDocument(restoreEmbedding(parseDocument(current), input.targetBindingVersion, generation.generationId)),
      }
      return plan
    })
  }

  /** Promote the staged embedding candidate to `active`, archive the prior, and mark the generation `live` (FR5). */
  function activateEmbedding(d: RegistryDocument, generationId: string, activatedBy: string): RegistryDocument {
    const staged = stagedOf(d, "embedding")
    if (staged === null) return d // defensive — the plan gate required a validated candidate
    const outgoing = currentOf(d, "embedding")
    const archive = archiveOf(d, "embedding")
    const nextArchive = outgoing && outgoing.state === "active" ? [outgoing, ...archive] : archive
    const generations = generationsOf(d).map((g) =>
      g.generationId === generationId ? { ...g, state: "live" } : g.state === "live" ? { ...g, state: "superseded" } : g,
    )
    return {
      ...d,
      embedding: { ...staged, state: "active", selectedBy: activatedBy, selectedAt: new Date(clock()).toISOString() },
      embeddingStaged: null,
      embeddingArchive: nextArchive,
      embeddingGenerations: generations,
      embeddingLiveGeneration: generationId,
    }
  }

  /** Restore an archived embedding prior to `active` and re-mark its generation `live` (FR5). */
  function restoreEmbedding(d: RegistryDocument, targetVersion: number | undefined, generationId: string): RegistryDocument {
    const archive = archiveOf(d, "embedding")
    const target = resolveRollbackTarget(archive, targetVersion)
    if (target === undefined) return d // defensive — the plan gate required a prior
    const remaining = archive.filter((b) => b.version !== target.version)
    const outgoing = currentOf(d, "embedding")
    const nextArchive = outgoing && outgoing.state === "active" ? [outgoing, ...remaining] : remaining
    const generations = generationsOf(d).map((g) =>
      g.generationId === generationId ? { ...g, state: "live" } : g.state === "live" ? { ...g, state: "superseded" } : g,
    )
    return {
      ...d,
      embedding: { ...target, state: "active" },
      embeddingArchive: nextArchive,
      embeddingGenerations: generations,
      embeddingLiveGeneration: generationId,
    }
  }

  /** Run a pure transform through the plaintext guard and hand back the plan (shared by every mutation). */
  function guardedPlan<E>(transform: (doc: RegistryDocument) => RegistryDocument, unavailable: (reason: string) => E): Effect.Effect<OperatorMutationPlan, E> {
    return readDoc(unavailable).pipe(
      Effect.flatMap((doc) =>
        plaintextDefect(transform(doc))
          ? Effect.fail(unavailable("a plaintext secret would be persisted; secrets must be a SecretRef"))
          : Effect.succeed(asPlan(transform)),
      ),
    )
  }

  /** Plan a version-checked provider transform (disable/rotate share the not-found + CAS gate). */
  function planProviderVersioned(id: string, expectedVersion: number, transform: (p: RegistryProvider) => RegistryProvider): Effect.Effect<OperatorMutationPlan, ProviderError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(providerUnavailable)
      const existing = doc.providers.find((p) => p.id === id)
      if (existing === undefined) return yield* Effect.fail<ProviderError>({ type: "not_found", id })
      if (existing.version !== expectedVersion) return yield* Effect.fail<ProviderError>({ type: "version_conflict", expectedVersion, actualVersion: existing.version })
      return yield* guardedPlan<ProviderError>((d) => ({ ...d, providers: replaceProvider(d.providers, id, transform) }), providerUnavailable)
    })
  }

  /**
   * Stage a draft candidate for one slot; the model must already be registered
   * (FR32, C12). The candidate goes to the `*Staged` pointer, NOT the live binding,
   * so a later cutover can move the outgoing active version into the per-slot archive
   * (Feature 019 FR2). The version is monotonic across current/staged/archive.
   */
  function planSelect(input: SelectBindingInput, slot: Slot): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      if (!doc.models.some((m) => m.id === input.modelDescriptorId)) return yield* Effect.fail<BindingError>({ type: "not_validated", id: input.modelDescriptorId })
      const stage = (d: RegistryDocument): RegistryDocument => {
        const record: RegistryBinding = {
          slot,
          modelDescriptorId: input.modelDescriptorId,
          compatibilityMode: input.compatibilityMode,
          state: "draft",
          version: nextBindingVersion(d, slot),
          selectedBy: input.principal.id,
          selectedAt: new Date(clock()).toISOString(),
          validated: false,
        }
        return slot === "reranker" ? { ...d, rerankerStaged: record } : { ...d, embeddingStaged: record }
      }
      return yield* guardedPlan<BindingError>(stage, bindingUnavailable)
    })
  }

  /**
   * Promote the staged candidate for a slot to `{ state: "staged", validated: true }` (the ONLY
   * validated writer) AND promote its underlying model descriptor's `validationStatus` to
   * `"validated"` (Feature 026 FR4). The provider probe that validated the staged binding candidate
   * is exactly the probe that validated the model's declared capability, so the model descriptor
   * the `semantic.model.list` reader projects (and the TUI reranker selector filters on
   * `probeState === "validated"`) becomes an eligible candidate through this same config-backed
   * `reranker.validate` transition — no separate `model.validate` mutation is required (its catalog
   * entry stays `mutates: false`). Nothing is fabricated: the model is marked validated only on the
   * SAME passing probe that promotes the binding.
   */
  function markValidated(d: RegistryDocument, slot: Slot): RegistryDocument {
    const staged = stagedOf(d, slot)
    if (staged === null) return d // defensive — the plan gate already required a staged candidate
    const validated: RegistryBinding = { ...staged, state: "staged", validated: true }
    const models = d.models.map((m) =>
      m.id === staged.modelDescriptorId ? { ...m, validationStatus: "validated" } : m,
    )
    return slot === "reranker"
      ? { ...d, rerankerStaged: validated, models }
      : { ...d, embeddingStaged: validated, models }
  }

  /** The staged candidate's registered+enabled model, or a typed `not_validated` (untrusted declaration, C16). */
  function coherentModel(doc: RegistryDocument, staged: RegistryBinding): RegistryModel | BindingError {
    const model = doc.models.find((m) => m.id === staged.modelDescriptorId)
    if (model === undefined || !model.enabled) return { type: "not_validated", id: staged.modelDescriptorId }
    const provider = doc.providers.find((p) => p.id === model.providerProfileId)
    if (provider === undefined || !provider.enabled) return { type: "not_validated", id: staged.modelDescriptorId }
    return model
  }

  /**
   * Feature 019 (FR3, FR32) — validate the staged RERANKER candidate through the
   * config-backed registry and, on a passing provider probe, promote it to
   * `{ state: "staged", validated: true }`. This is the ONLY config-backed path that
   * produces a validated reranker candidate a cutover may activate (the review's missing
   * transition). Pure coherence gates run first: a candidate must be staged from a
   * `draft` (the machine `draft --validate--> staged`), an eligible rerank profile
   * (profile C is refused, C16), and its model + provider must be registered, enabled,
   * and secret-resolvable. The probe is the ONLY provider-network call and runs in the
   * plan EFFECT (after CAS, per the 017 contract): a failed probe is a typed
   * `validation_failed` that commits nothing; no probe composed (or no endpoint) is the
   * honest typed gap — never a fabricated `validated`.
   */
  function planValidateReranker(input: BindingValidatePlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    void input
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      const staged = stagedOf(doc, "reranker")
      if (staged === null) return yield* Effect.fail<BindingError>({ type: "no_candidate_staged" })
      if (BindingLifecycle.apply(staged.state as BindingState, "validate").kind !== "transition") {
        return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged.modelDescriptorId })
      }
      const eligibility = RerankClient.rejectForRerankerSlot(staged.compatibilityMode as RerankProfile)
      if (eligibility !== null) return yield* Effect.fail<BindingError>({ type: "reranker_not_eligible", reason: eligibility.reason })
      const model = coherentModel(doc, staged)
      if ("type" in model) return yield* Effect.fail(model)
      const provider = doc.providers.find((p) => p.id === model.providerProfileId)!
      const ref = provider.secretRef ?? ""
      if (ref.length === 0 || !SECRET_REF_PATTERN.test(ref)) return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged.modelDescriptorId })
      const probe = deps.rerankProbe
      // No probe composed / no provider endpoint → honest typed gap; NEVER a fabricated validated.
      if (probe === undefined || provider.baseUrl.length === 0) {
        return yield* Effect.fail<BindingError>({ type: "unavailable", reason: "reranker validation probe is not composed" })
      }
      const profile = staged.compatibilityMode as RerankProfile
      const baseUrl = provider.baseUrl
      const modelRef = model.modelRef ?? model.id
      const plan: OperatorMutationPlan = {
        authority: AUTHORITY,
        effect: async (): Promise<OperatorMutationEffectResult> => {
          try {
            const result = await probe.run({ baseUrl, profile, modelDescriptorId: staged.modelDescriptorId, modelRef, secretRef: ref })
            if (!result.passed) return { ok: false, code: "invalid_argument", message: "validation_failed" }
            return { ok: true }
          } catch {
            return { ok: false, code: "unavailable", message: "reranker validation probe unreachable" }
          }
        },
        apply: (current) => encodeDocument(markValidated(parseDocument(current), "reranker")),
      }
      return plan
    })
  }

  /**
   * Feature 019 (FR3, FR5, FR32) — validate the staged EMBEDDING candidate through the
   * config-backed registry and promote it to `{ state: "staged", validated: true }`.
   * The cardinal honesty rule holds: an embedding candidate is validatable ONLY once a
   * blue/green generation matching its version was physically built + validated in Milvus
   * (`planReindexEmbedding`), so `validate` PRECEDES `cutover` and FOLLOWS `reindex`. An
   * unbound Milvus port is the typed `milvus_unavailable` gap; a missing generation is a
   * typed `not_validated` (reindex-first); an incoherent model/provider is `not_validated`.
   * The transition is a pure config plan — the physical build already ran at reindex.
   */
  function planValidateEmbedding(input: BindingValidatePlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    void input
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      const port = deps.milvus
      if (port === undefined) return yield* Effect.fail<BindingError>({ type: "unavailable", reason: "milvus_unavailable" })
      const staged = stagedOf(doc, "embedding")
      if (staged === null) return yield* Effect.fail<BindingError>({ type: "no_candidate_staged" })
      if (BindingLifecycle.apply(staged.state as BindingState, "validate").kind !== "transition") {
        return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged.modelDescriptorId })
      }
      const model = coherentModel(doc, staged)
      if ("type" in model) return yield* Effect.fail(model)
      // Reindex-first: a `validated` generation for THIS candidate version must already exist.
      const generation = generationsOf(doc).find((g) => g.state === "validated" && g.bindingVersion === staged.version)
      if (generation === undefined) return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged.modelDescriptorId })
      return asPlan((d) => markValidated(d, "embedding"))
    })
  }

  /**
   * Feature 019 (FR1, FR3) — activate a validated staged reranker candidate through
   * the config-backed registry, with NO Milvus dependency. The pure `cutoverReranker`
   * supplies the confirmation gate and the `reEmbedded:false` invariant; the transform
   * promotes the staged candidate to `active`, moves the outgoing active into the
   * per-slot superseded archive, clears the staged pointer, and bumps the rerank
   * cache/eval version. The authority CAS token (dispatcher `version`) is the single
   * compare-and-swap gate, so a contention swaps nothing (`cas_conflict`); an
   * unvalidated / illegal candidate is a typed `not_validated`.
   */
  function planCutoverReranker(input: RerankerCutoverPlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      const staged = stagedOf(doc, "reranker")
      if (staged === null || staged.validated !== true) {
        return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged?.modelDescriptorId ?? "" })
      }
      // The binding machine must permit `staged --cutover--> active`; a draft/active candidate is illegal (FR3).
      if (BindingLifecycle.apply(staged.state as BindingState, "cutover").kind !== "transition") {
        return yield* Effect.fail<BindingError>({ type: "not_validated", id: staged.modelDescriptorId })
      }
      const outcome = CutoverExecutor.cutoverReranker({ confirmed: input.confirmed, bindingVersion: staged.version })
      if (outcome.kind === "confirmation_required") return yield* Effect.fail<BindingError>({ type: "confirmation_required" })
      return yield* guardedPlan<BindingError>((d) => activateReranker(d, input.principal.id), bindingUnavailable)
    })
  }

  /**
   * Feature 019 (FR3) — restore a superseded prior for the reranker slot. The target
   * resolves from the per-slot archive; an empty archive (or an unknown version) is a
   * typed `no_archived_prior` rejection — never a fabricated swap. On success the
   * outgoing active is archived, the prior is restored `active`, and the rerank
   * cache/eval version is bumped under the authority CAS + operator confirmation.
   */
  function planRollbackReranker(input: RerankerRollbackPlanInput): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      if (resolveRollbackTarget(archiveOf(doc, "reranker"), input.targetBindingVersion) === undefined) {
        return yield* Effect.fail<BindingError>({ type: "no_archived_prior", slot: "reranker" as BindingSlot })
      }
      if (!input.confirmed) return yield* Effect.fail<BindingError>({ type: "confirmation_required" })
      return yield* guardedPlan<BindingError>((d) => restoreReranker(d, input.targetBindingVersion), bindingUnavailable)
    })
  }

  /** Promote the staged reranker candidate to `active`, archiving the outgoing active version (FR1, FR2). */
  function activateReranker(d: RegistryDocument, activatedBy: string): RegistryDocument {
    const staged = stagedOf(d, "reranker")
    if (staged === null) return d // defensive — the plan gate already required a validated candidate
    const outgoing = currentOf(d, "reranker")
    const archive = archiveOf(d, "reranker")
    const nextArchive = outgoing && outgoing.state === "active" ? [outgoing, ...archive] : archive
    return {
      ...d,
      reranker: { ...staged, state: "active", selectedBy: activatedBy, selectedAt: new Date(clock()).toISOString() },
      rerankerStaged: null,
      rerankerArchive: nextArchive,
      rerankEvalVersion: (d.rerankEvalVersion ?? 0) + 1,
    }
  }

  /** Restore an archived reranker prior to `active`, archiving the outgoing active version (FR3). */
  function restoreReranker(d: RegistryDocument, targetVersion: number | undefined): RegistryDocument {
    const archive = archiveOf(d, "reranker")
    const target = resolveRollbackTarget(archive, targetVersion)
    if (target === undefined) return d // defensive — the plan gate already required a prior
    const remaining = archive.filter((b) => b.version !== target.version)
    const outgoing = currentOf(d, "reranker")
    const nextArchive = outgoing && outgoing.state === "active" ? [outgoing, ...remaining] : remaining
    return {
      ...d,
      reranker: { ...target, state: "active" },
      rerankerArchive: nextArchive,
      rerankEvalVersion: (d.rerankEvalVersion ?? 0) + 1,
    }
  }
}

/** Apply an operator provider patch onto a persisted record (endpoint/identity fields only). */
function applyProviderPatch(p: RegistryProvider, patch: UpdateProviderInput["patch"], updatedAt: string): RegistryProvider {
  const record = patch as Record<string, unknown>
  return {
    ...p,
    name: typeof record.name === "string" ? record.name : p.name,
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : p.baseUrl,
    tlsRequired: typeof patch.transportPolicy?.tlsRequired === "boolean" ? patch.transportPolicy.tlsRequired : p.tlsRequired,
    allowInsecureLocalProfile:
      typeof patch.transportPolicy?.allowInsecureLocalProfile === "boolean" ? patch.transportPolicy.allowInsecureLocalProfile : p.allowInsecureLocalProfile,
    residency: typeof record.residency === "string" ? record.residency : p.residency,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : p.enabled,
    updatedAt,
  }
}

/** Replace one provider by id with the transformed record; the rest of the list is preserved. */
function replaceProvider(providers: readonly RegistryProvider[], id: string, transform: (p: RegistryProvider) => RegistryProvider): readonly RegistryProvider[] {
  return providers.map((p) => (p.id === id ? transform(p) : p))
}

/** Replace one model by id with the transformed record; the rest of the list is preserved. */
function replaceModel(models: readonly RegistryModel[], id: string, transform: (m: RegistryModel) => RegistryModel): readonly RegistryModel[] {
  return models.map((m) => (m.id === id ? transform(m) : m))
}
