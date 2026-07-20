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
import { UrlGuard } from "@/semantic/url-guard"
import { type ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  AddProviderInput,
  BindingError,
  BindingHistoryInput,
  BindingHistoryOutput,
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
  ProviderError,
  RegisterModelInput,
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
})
type RegistryBinding = Schema.Schema.Type<typeof RegistryBinding>

const RegistryDocument = Schema.Struct({
  providers: Schema.Array(RegistryProvider),
  models: Schema.Array(RegistryModel),
  embedding: Schema.NullOr(RegistryBinding),
  reranker: Schema.NullOr(RegistryBinding),
})
type RegistryDocument = Schema.Schema.Type<typeof RegistryDocument>

const EMPTY_DOCUMENT: RegistryDocument = { providers: [], models: [], embedding: null, reranker: null }

const decodeDocument = Schema.decodeUnknownExit(RegistryDocument)
const encodeDocument = Schema.encodeSync(RegistryDocument)

/** Decode a persisted authority payload into a registry document; the empty document when absent/undecodable. */
function parseDocument(payload: unknown): RegistryDocument {
  if (payload === null || payload === undefined) return EMPTY_DOCUMENT
  const exit = decodeDocument(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? exit.value : EMPTY_DOCUMENT
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
}

export interface ConfigBackedRegistryDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write (default `Date.now`). */
  readonly clock?: () => number
  /** Stable id generator for new provider/model records (default `crypto.randomUUID`). */
  readonly idGen?: () => string
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

/** Project a persisted model onto the operator-facing descriptor. */
function toDescriptor(m: RegistryModel): SemanticModelDescriptor {
  return {
    id: m.id,
    provider_ref: m.providerProfileId,
    identity: { display_name: m.displayName, source: "manual", endpoint_mode: m.endpointMode, rerank_profile: null },
    capability: { kinds: m.declaredCapabilityKinds, dimension: null, metric: null, normalized: null, limits: { batch_size: null, vector_count: null, token_limit: null } },
    validation: { status: m.validationStatus, provenance: "operator", validated_at: null, eval_version: null },
    enabled: m.enabled,
  } as unknown as SemanticModelDescriptor
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
            .map(toDescriptor),
        })),
      ),

    showEmbedding: () =>
      readDoc(bindingUnavailable).pipe(Effect.map((doc) => ({ binding: doc.embedding ? toBinding(doc.embedding, providerRefOf(doc, doc.embedding.modelDescriptorId)) : undefined }))),

    showReranker: () =>
      readDoc(bindingUnavailable).pipe(Effect.map((doc) => ({ binding: doc.reranker ? toBinding(doc.reranker, providerRefOf(doc, doc.reranker.modelDescriptorId)) : undefined }))),

    bindingStatus: () =>
      readDoc(bindingUnavailable).pipe(
        Effect.map((doc) => ({
          embedding: doc.embedding ? toBinding(doc.embedding, providerRefOf(doc, doc.embedding.modelDescriptorId)) : undefined,
          reranker: doc.reranker ? toBinding(doc.reranker, providerRefOf(doc, doc.reranker.modelDescriptorId)) : undefined,
          degradation: { rung: "full_semantic" } as BindingStatusOutput["degradation"],
        })),
      ),

    bindingHistory: (input) =>
      readDoc(bindingUnavailable).pipe(
        Effect.map((doc) => {
          const slot = input.slot === "reranker" ? doc.reranker : doc.embedding
          return { versions: slot ? [toBinding(slot, providerRefOf(doc, slot.modelDescriptorId))].slice(0, input.limit) : [] }
        }),
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

  /** Stage a draft binding for one slot; the model must already be registered (FR32, C12). */
  function planSelect(input: SelectBindingInput, slot: "embedding" | "reranker"): Effect.Effect<OperatorMutationPlan, BindingError> {
    return Effect.gen(function* () {
      const doc = yield* readDoc(bindingUnavailable)
      if (!doc.models.some((m) => m.id === input.modelDescriptorId)) return yield* Effect.fail<BindingError>({ type: "not_validated", id: input.modelDescriptorId })
      const record: RegistryBinding = {
        slot,
        modelDescriptorId: input.modelDescriptorId,
        compatibilityMode: input.compatibilityMode,
        state: "draft",
        version: (slot === "embedding" ? doc.embedding?.version ?? 0 : doc.reranker?.version ?? 0) + 1,
        selectedBy: input.principal.id,
        selectedAt: new Date(clock()).toISOString(),
      }
      return yield* guardedPlan<BindingError>((d) => ({ ...d, [slot]: record }), bindingUnavailable)
    })
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
