/**
 * Feature 050 / T023 (FR4) — the runtime binding-join helper.
 *
 * The config-backed registry document is a normalized store: a slot binding
 * carries only a `modelDescriptorId`, and the provider `baseUrl`/`secretRef`
 * plus the provider-facing `modelRef` must be joined back through `models` and
 * `providers`. This is the inline join `registry-backend.ts` performs at its
 * `planValidateReranker` (`:1016-1028`); this helper lifts that shape into ONE
 * pure, unit-testable function the query path (pipeline runner / retrieval
 * service) and the operator stack both reuse rather than re-derive.
 *
 * It is structural over the persisted `RegistryDocument` shape (the fields it
 * reads only) — a superset document (the operator's `RegistryDocument`) is
 * assignable, so no new schema authority is introduced.
 */
export * as BindingRuntime from "./binding-runtime"

/** The provider fields the join reads (a subset of the persisted registry provider). */
export interface BindingProviderView {
  readonly id: string
  readonly baseUrl: string
  readonly secretRef: string | null
}

/** The model fields the join reads; `modelRef` is optional (a pre-026 record falls back to `id`). */
export interface BindingModelView {
  readonly id: string
  readonly providerProfileId: string
  readonly modelRef?: string
}

/** The slot fields the join reads (the live binding or its staged candidate). */
export interface BindingSlotView {
  readonly modelDescriptorId: string
  readonly compatibilityMode: string
  readonly version: number
}

/** The registry-document fields the join reads (structural subset). */
export interface RegistryDocumentView {
  readonly providers: readonly BindingProviderView[]
  readonly models: readonly BindingModelView[]
  readonly embedding: BindingSlotView | null
  readonly reranker: BindingSlotView | null
  readonly embeddingStaged?: BindingSlotView | null
  readonly rerankerStaged?: BindingSlotView | null
}

/** The resolved runtime binding a data-plane call needs — never a secret value, only the coordinate. */
export interface ActiveBinding {
  readonly baseUrl: string
  readonly modelRef: string
  /** The provider `SecretRef` coordinate, or empty when the provider carries no secret (never plaintext). */
  readonly secretRef: string
  readonly compatibilityMode: string
  readonly bindingVersion: number
}

type Slot = "embedding" | "reranker"

/** The live binding for a slot, falling back to the in-flight staged candidate (mirrors `showEmbedding`). */
function slotBinding(doc: RegistryDocumentView, slot: Slot): BindingSlotView | null {
  const current = slot === "reranker" ? doc.reranker : doc.embedding
  if (current !== null) return current
  return (slot === "reranker" ? doc.rerankerStaged : doc.embeddingStaged) ?? null
}

/**
 * Resolve the active (or staged) binding for a slot by joining the slot's model
 * descriptor back through `models` and `providers`. Returns `undefined` when the
 * slot is empty or the model/provider join is broken — the caller fails closed,
 * never fabricating an endpoint (FR4).
 */
export function resolveActiveBinding(doc: RegistryDocumentView, slot: Slot): ActiveBinding | undefined {
  const binding = slotBinding(doc, slot)
  if (binding === null) return undefined
  const model = doc.models.find((m) => m.id === binding.modelDescriptorId)
  if (model === undefined) return undefined
  const provider = doc.providers.find((p) => p.id === model.providerProfileId)
  if (provider === undefined) return undefined
  return {
    baseUrl: provider.baseUrl,
    modelRef: model.modelRef ?? model.id,
    secretRef: provider.secretRef ?? "",
    compatibilityMode: binding.compatibilityMode,
    bindingVersion: binding.version,
  }
}
