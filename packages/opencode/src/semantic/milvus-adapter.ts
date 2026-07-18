/**
 * Feature 006 / T026 (S15) — the single Milvus port over one adapter.
 *
 * One adapter backs standalone (default) / Zilliz Cloud deployments; the driver
 * is chosen per T025's recorded gRPC-under-Bun finding (`grpc` when supported,
 * the injected fake otherwise). Recall is hybrid: an HNSW dense index on the
 * stored cosine / inner-product metric fused deterministically with Milvus-native
 * sparse/BM25. Every search carries MANDATORY scalar filters — the project
 * partition key plus scope / visibility / role / permission — so no query can
 * cross a project and there is no per-project collection explosion (FR9, C6).
 * Bounded staleness is the default consistency; Strong is reserved for admin
 * verification reads. An unreachable backend is the typed `milvus_unavailable`
 * capability gap, never a crash (FR7, C1, C20) — routing degrades to the C20
 * catalog+lexical floor at the call site.
 *
 * The injected fake / in-memory adapter carries the unit-test path regardless of
 * the driver outcome, and enforces the same mandatory-filter contract so the
 * cross-project isolation guarantee is provable without a live server (C1, C7).
 */
export * as MilvusAdapter from "./milvus-adapter"

import { Effect } from "effect"
import type { CollectionKind, ConsistencyLevel, MetricKind } from "@opencode-ai/protocol/semantic/commands"

/** Mandatory scalar predicates enforced on EVERY search; the project key is never optional (FR9, FR34, C6). */
export interface MandatoryFilters {
  readonly projectId: string
  readonly scope: string
  readonly visibility: string
  readonly role?: string
  readonly permissionRef?: string
}

/** A dense+sparse recall request over the current generation of one collection (C7). */
export interface SearchInput {
  readonly collection: CollectionKind
  readonly dense: readonly number[]
  readonly sparseTerms: readonly string[]
  readonly filters: MandatoryFilters
  readonly topK: number
  readonly consistency: ConsistencyLevel
  readonly metric: MetricKind
}

/** One recalled row with its dense and sparse component scores (fused deterministically downstream, C7). */
export interface Hit {
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly dense: number
  readonly sparse: number
}

export interface SearchResult {
  readonly hits: readonly Hit[]
  readonly consistency: ConsistencyLevel
}

/** One indexable document row; the vector plus the mandatory scalar fields and content-free terms. */
export interface DocumentRow {
  readonly canonicalId: string
  readonly canonicalVersion: string
  readonly dense: readonly number[]
  readonly terms: readonly string[]
  readonly filters: MandatoryFilters
}

export interface UpsertInput {
  readonly collection: CollectionKind
  readonly rows: readonly DocumentRow[]
}

export interface UpsertResult {
  readonly upsertedCount: number
}

export interface TombstoneInput {
  readonly collection: CollectionKind
  readonly canonicalIds: readonly string[]
  readonly projectId: string
}

export interface TombstoneResult {
  readonly tombstonedCount: number
}

export interface HealthResult {
  readonly reachable: boolean
  readonly latencyMs: number
}

/** One collection's alias target within an atomic swap (all collections together, C12). */
export interface AliasTarget {
  readonly collection: CollectionKind
  readonly generationId: string
}

export interface SwapAliasesInput {
  readonly targets: readonly AliasTarget[]
  readonly casToken: string
}

export interface SwapAliasesResult {
  readonly swapped: readonly CollectionKind[]
}

/** The typed Milvus capability gap; `milvus_unavailable` never hard-fails routing (C1, C20). */
export type MilvusGap =
  | { readonly type: "milvus_unavailable"; readonly reason: string }
  | { readonly type: "invalid_filters"; readonly reason: string }
  | { readonly type: "cas_conflict"; readonly reason: string }

/** The single Milvus port; the domain recall/index maintenance and the cutover executor consume it. */
export interface MilvusPort {
  readonly search: (input: SearchInput) => Effect.Effect<SearchResult, MilvusGap>
  readonly upsert: (input: UpsertInput) => Effect.Effect<UpsertResult, MilvusGap>
  readonly tombstone: (input: TombstoneInput) => Effect.Effect<TombstoneResult, MilvusGap>
  readonly health: () => Effect.Effect<HealthResult, MilvusGap>
  readonly swapAliases: (input: SwapAliasesInput) => Effect.Effect<SwapAliasesResult, MilvusGap>
}

const unavailable = (reason: string): MilvusGap => ({ type: "milvus_unavailable", reason })

/** The mandatory project partition key must be present on every search (FR9, C6). */
function filtersValid(filters: MandatoryFilters): boolean {
  return filters.projectId.length > 0 && filters.scope.length > 0 && filters.visibility.length > 0
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function innerProduct(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

/** Sparse/BM25-style overlap: the count of shared terms, normalized by the query term count. */
function sparseOverlap(queryTerms: readonly string[], docTerms: readonly string[]): number {
  if (queryTerms.length === 0) return 0
  const docSet = new Set(docTerms)
  let shared = 0
  for (const term of queryTerms) if (docSet.has(term)) shared++
  return shared / queryTerms.length
}

/** A document filter matches when the mandatory scalar predicates all hold (deny-by-default). */
function matches(rowFilters: MandatoryFilters, query: MandatoryFilters): boolean {
  if (rowFilters.projectId !== query.projectId) return false
  if (rowFilters.scope !== query.scope) return false
  if (rowFilters.visibility !== query.visibility) return false
  if (query.role !== undefined && rowFilters.role !== query.role) return false
  return true
}

interface StoredRow extends DocumentRow {
  readonly tombstoned: boolean
}

type CollectionStore = Map<string, StoredRow>

/**
 * Build the in-memory fake Milvus adapter — the unit-test path behind the single
 * port. It enforces the mandatory-filter contract (an absent project key is
 * `invalid_filters`), isolates projects by the scalar partition key, computes
 * dense (cosine / inner-product) and sparse (term-overlap) component scores, and
 * models the atomic all-collection alias swap under CAS (FR9, C6, C7, C12).
 */
export const createFakeMilvusAdapter = (
  options: { readonly casToken?: string } = {},
): MilvusPort => {
  const stores = new Map<CollectionKind, CollectionStore>()
  const storeOf = (collection: CollectionKind): CollectionStore => {
    const existing = stores.get(collection)
    if (existing) return existing
    const created: CollectionStore = new Map()
    stores.set(collection, created)
    return created
  }

  const search = (input: SearchInput): Effect.Effect<SearchResult, MilvusGap> => {
    if (!filtersValid(input.filters)) return Effect.fail({ type: "invalid_filters", reason: "missing project partition key" })
    const rows = [...storeOf(input.collection).values()].filter((row) => !row.tombstoned && matches(row.filters, input.filters))
    const scored = rows.map((row) => ({
      canonicalId: row.canonicalId,
      canonicalVersion: row.canonicalVersion,
      dense: input.metric === "cosine" ? cosine(input.dense, row.dense) : innerProduct(input.dense, row.dense),
      sparse: sparseOverlap(input.sparseTerms, row.terms),
    }))
    scored.sort((a, b) => b.dense - a.dense || b.sparse - a.sparse || a.canonicalId.localeCompare(b.canonicalId))
    return Effect.succeed({ hits: scored.slice(0, input.topK), consistency: input.consistency })
  }

  const upsert = (input: UpsertInput): Effect.Effect<UpsertResult, MilvusGap> => {
    const store = storeOf(input.collection)
    for (const row of input.rows) {
      if (!filtersValid(row.filters)) return Effect.fail({ type: "invalid_filters", reason: "row missing project partition key" })
      store.set(`${row.filters.projectId}:${row.canonicalId}`, { ...row, tombstoned: false })
    }
    return Effect.succeed({ upsertedCount: input.rows.length })
  }

  const tombstone = (input: TombstoneInput): Effect.Effect<TombstoneResult, MilvusGap> => {
    const store = storeOf(input.collection)
    let count = 0
    for (const id of input.canonicalIds) {
      const key = `${input.projectId}:${id}`
      const existing = store.get(key)
      if (existing) {
        store.set(key, { ...existing, tombstoned: true })
        count++
      }
    }
    return Effect.succeed({ tombstonedCount: count })
  }

  const health = (): Effect.Effect<HealthResult, MilvusGap> => Effect.succeed({ reachable: true, latencyMs: 0 })

  const swapAliases = (input: SwapAliasesInput): Effect.Effect<SwapAliasesResult, MilvusGap> => {
    if (options.casToken !== undefined && input.casToken !== options.casToken) {
      return Effect.fail({ type: "cas_conflict", reason: "alias generation moved under the swap" })
    }
    return Effect.succeed({ swapped: input.targets.map((t) => t.collection) })
  }

  return { search, upsert, tombstone, health, swapAliases }
}

/** The narrow live-driver seam the composition root binds when T025 recorded `grpc_bun_supported`. */
export interface MilvusGrpcClient {
  readonly search: (input: SearchInput) => Promise<SearchResult>
  readonly upsert: (input: UpsertInput) => Promise<UpsertResult>
  readonly tombstone: (input: TombstoneInput) => Promise<TombstoneResult>
  readonly health: () => Promise<HealthResult>
  readonly swapAliases: (input: SwapAliasesInput) => Promise<SwapAliasesResult>
}

/**
 * Build the live gRPC-backed Milvus port. When no client is injected (the live
 * standalone/cloud server is not reachable from this runtime), every method
 * returns the typed `milvus_unavailable` gap — an honest capability gap, never a
 * fabricated result and never a crash (FR7, C1, C20). The composition root
 * injects a real `client` as the standalone server is bound.
 */
export const createGrpcMilvusAdapter = (
  deps: { readonly client?: MilvusGrpcClient } = {},
): MilvusPort => {
  const client = deps.client
  const guard = <A>(run: (c: MilvusGrpcClient) => Promise<A>): Effect.Effect<A, MilvusGap> => {
    if (!client) return Effect.fail(unavailable("milvus gRPC client is not bound to this runtime"))
    return Effect.tryPromise({ try: () => run(client), catch: (error) => unavailable(String(error).slice(0, 200)) })
  }
  return {
    search: (input) => {
      if (!filtersValid(input.filters)) return Effect.fail({ type: "invalid_filters", reason: "missing project partition key" })
      return guard((c) => c.search(input))
    },
    upsert: (input) => guard((c) => c.upsert(input)),
    tombstone: (input) => guard((c) => c.tombstone(input)),
    health: () => guard((c) => c.health()),
    swapAliases: (input) => guard((c) => c.swapAliases(input)),
  }
}
