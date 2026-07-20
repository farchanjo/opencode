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
  /** When set, upsert into a specific (blue/green) generation collection rather than the live alias (FR5, FR6). */
  readonly generationId?: string
}

export interface UpsertResult {
  readonly upsertedCount: number
}

export interface TombstoneInput {
  readonly collection: CollectionKind
  readonly canonicalIds: readonly string[]
  readonly projectId: string
  /** When set, tombstone within a specific generation collection rather than the live alias (FR6). */
  readonly generationId?: string
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

/**
 * Feature 019 (FR6) — one enumerated indexed document: the canonical id plus its
 * stored content hash, the minimal pair `runReconcile` diffs the live-doc source
 * against. Never a body, a vector, or a scope payload — content-free (`#EnumeratedIndexedDoc`).
 */
export interface EnumeratedIndexedDoc {
  readonly canonicalId: string
  readonly contentHash: string
}

export interface EnumerateIndexedInput {
  readonly collection: CollectionKind
  /** The mandatory project partition; enumeration never crosses a project (FR9, C6). */
  readonly projectId: string
  /** When set, enumerate a specific (blue/green) generation rather than the live alias. */
  readonly generationId?: string
}

export interface EnumerateIndexedResult {
  readonly docs: readonly EnumeratedIndexedDoc[]
}

/** The blue/green generation build state; `validated` is the ONLY legal cutover source (FR5, cardinal honesty). */
export type GenerationBuildState = "building" | "validated"

/**
 * Feature 019 (FR5, FR6) — a blue/green generation build request. It physically
 * creates a fresh collection generation for EVERY collection together and validates
 * it (`building → validated`) BEFORE an embedding cutover swaps the alias — a
 * config-only alias flip is never a cutover (`#GenerationBuild`, `#IndexGeneration`).
 */
export interface BuildGenerationInput {
  readonly collections: readonly CollectionKind[]
  readonly generationId: string
  readonly dimension: number
  readonly metric: MetricKind
}

export interface BuildGenerationResult {
  readonly generationId: string
  readonly collections: readonly CollectionKind[]
  readonly built: boolean
  readonly validated: boolean
  readonly state: GenerationBuildState
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
  /** Feature 019 (FR6) — enumerate the `{canonicalId, contentHash}` pairs indexed for one collection/project. */
  readonly enumerateIndexed: (input: EnumerateIndexedInput) => Effect.Effect<EnumerateIndexedResult, MilvusGap>
  /** Feature 019 (FR5, FR6) — physically build + validate a blue/green generation before an alias swap. */
  readonly buildGeneration: (input: BuildGenerationInput) => Effect.Effect<BuildGenerationResult, MilvusGap>
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
  const stores = new Map<string, CollectionStore>()
  // A `generationId` buckets a blue/green generation apart from the live alias (undefined).
  const storeKey = (collection: CollectionKind, generationId?: string): string =>
    generationId ? `${collection}::${generationId}` : collection
  const storeOf = (collection: CollectionKind, generationId?: string): CollectionStore => {
    const key = storeKey(collection, generationId)
    const existing = stores.get(key)
    if (existing) return existing
    const created: CollectionStore = new Map()
    stores.set(key, created)
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
    const store = storeOf(input.collection, input.generationId)
    for (const row of input.rows) {
      if (!filtersValid(row.filters)) return Effect.fail({ type: "invalid_filters", reason: "row missing project partition key" })
      store.set(`${row.filters.projectId}:${row.canonicalId}`, { ...row, tombstoned: false })
    }
    return Effect.succeed({ upsertedCount: input.rows.length })
  }

  const tombstone = (input: TombstoneInput): Effect.Effect<TombstoneResult, MilvusGap> => {
    const store = storeOf(input.collection, input.generationId)
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
    // Promote each target generation's rows into the live alias so a post-swap enumerate/search sees them.
    for (const target of input.targets) {
      const gen = stores.get(storeKey(target.collection, target.generationId))
      if (gen) stores.set(storeKey(target.collection), new Map(gen))
    }
    return Effect.succeed({ swapped: input.targets.map((t) => t.collection) })
  }

  const enumerateIndexed = (input: EnumerateIndexedInput): Effect.Effect<EnumerateIndexedResult, MilvusGap> => {
    if (input.projectId.length === 0) return Effect.fail({ type: "invalid_filters", reason: "missing project partition key" })
    const docs = [...storeOf(input.collection, input.generationId).values()]
      .filter((row) => !row.tombstoned && row.filters.projectId === input.projectId)
      .map((row) => ({ canonicalId: row.canonicalId, contentHash: row.canonicalVersion }))
    return Effect.succeed({ docs })
  }

  const buildGeneration = (input: BuildGenerationInput): Effect.Effect<BuildGenerationResult, MilvusGap> => {
    // Materialize a fresh generation bucket per collection (empty until reindex upserts into it).
    for (const collection of input.collections) storeOf(collection, input.generationId)
    return Effect.succeed({
      generationId: input.generationId,
      collections: input.collections,
      built: true,
      validated: true,
      state: "validated",
    })
  }

  return { search, upsert, tombstone, health, swapAliases, enumerateIndexed, buildGeneration }
}

/** The narrow live-driver seam the composition root binds when T025 recorded `grpc_bun_supported`. */
export interface MilvusGrpcClient {
  readonly search: (input: SearchInput) => Promise<SearchResult>
  readonly upsert: (input: UpsertInput) => Promise<UpsertResult>
  readonly tombstone: (input: TombstoneInput) => Promise<TombstoneResult>
  readonly health: () => Promise<HealthResult>
  readonly swapAliases: (input: SwapAliasesInput) => Promise<SwapAliasesResult>
  readonly enumerateIndexed: (input: EnumerateIndexedInput) => Promise<EnumerateIndexedResult>
  readonly buildGeneration: (input: BuildGenerationInput) => Promise<BuildGenerationResult>
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
    enumerateIndexed: (input) => {
      if (input.projectId.length === 0) return Effect.fail({ type: "invalid_filters", reason: "missing project partition key" })
      return guard((c) => c.enumerateIndexed(input))
    },
    buildGeneration: (input) => guard((c) => c.buildGeneration(input)),
  }
}

// =============================================================================
// Feature 019 / T004 — the live Milvus HTTP (REST v2) client
// =============================================================================

/** Options for the live REST client; the credential is a resolved bearer header, never inline plaintext (FR4, C19). */
export interface HttpMilvusClientOptions {
  /** `host:port`, or an explicit `http://`/`https://` base URL. */
  readonly address: string
  /** TLS on when no explicit scheme is given (secure by default); `http://` addresses opt out explicitly (FR4). */
  readonly ssl?: boolean
  /** Bounded per-request budget in ms (default 5000, hard-capped 30000). */
  readonly timeoutMs?: number
  /** A resolved `Authorization` header value (Milvus `user:pass` token), supplied by the SecretPort at use time. */
  readonly authorization?: string
  /** Physical-collection name prefix; a test uses `opencode_test` to stay isolated + cleanable. */
  readonly collectionPrefix?: string
  /** The Milvus vector metric (default `COSINE`). */
  readonly metricType?: "COSINE" | "IP" | "L2"
  /** Injected fetch for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch
}

const HTTP_DEFAULT_TIMEOUT_MS = 5000
const HTTP_MAX_TIMEOUT_MS = 30000

/** Milvus collection names allow only `[A-Za-z0-9_]`; sanitize a generation id (uuids carry hyphens). */
function sanitizeName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_")
}

function milvusMetric(metric: MetricKind): "COSINE" | "IP" | "L2" {
  return metric === "cosine" ? "COSINE" : metric === "inner-product" ? "IP" : "L2"
}

/**
 * Build a live Milvus port over the REST v2 HTTP API (`/v2/vectordb/*`). Every op
 * is bounded by a timeout and returns a typed `milvus_unavailable`/`cas_conflict`
 * gap on any transport/timeout/non-zero-code error — never a raw error, an endpoint,
 * or a credential across the seam (FR4, FR16, C19). The physical collection for a
 * generation is `<prefix>__<collection>__<generationId>`; the live alias is
 * `<prefix>__<collection>`, which `swapAliases` atomically re-points.
 */
export function createHttpMilvusClient(options: HttpMilvusClientOptions): MilvusGrpcClient {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = Math.min(Math.max(1, options.timeoutMs ?? HTTP_DEFAULT_TIMEOUT_MS), HTTP_MAX_TIMEOUT_MS)
  const prefix = options.collectionPrefix ?? "opencode"
  const metricType = options.metricType ?? "COSINE"
  const base = /^https?:\/\//.test(options.address)
    ? options.address.replace(/\/+$/, "")
    : `${options.ssl === false ? "http" : "https"}://${options.address}`

  const aliasName = (collection: CollectionKind): string => sanitizeName(`${prefix}__${collection}`)
  const physicalName = (collection: CollectionKind, generationId: string): string =>
    sanitizeName(`${prefix}__${collection}__${generationId}`)
  /** The concrete collection an op targets: a generation's physical collection, else the live alias. */
  const targetName = (collection: CollectionKind, generationId?: string): string =>
    generationId ? physicalName(collection, generationId) : aliasName(collection)

  /** POST one REST v2 call under the bounded timeout; a non-zero `code` or transport fault throws a bounded reason. */
  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await doFetch(`${base}/v2/vectordb${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.authorization ? { authorization: options.authorization } : {}),
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`http ${response.status}`)
      const json = (await response.json()) as { code?: number; message?: string; data?: unknown }
      if (typeof json.code === "number" && json.code !== 0) throw new Error(`milvus code ${json.code}`)
      return json as Record<string, unknown>
    } finally {
      clearTimeout(timer)
    }
  }

  const dataOf = (json: Record<string, unknown>): unknown => json["data"]

  return {
    health: async () => {
      const started = Date.now()
      await post("/collections/list", {})
      return { reachable: true, latencyMs: Date.now() - started }
    },
    buildGeneration: async (input) => {
      for (const collection of input.collections) {
        const name = physicalName(collection, input.generationId)
        await post("/collections/create", {
          collectionName: name,
          schema: {
            autoID: false,
            fields: [
              { fieldName: "id", dataType: "VarChar", isPrimary: true, elementTypeParams: { max_length: 512 } },
              { fieldName: "content_hash", dataType: "VarChar", elementTypeParams: { max_length: 128 } },
              { fieldName: "project_id", dataType: "VarChar", elementTypeParams: { max_length: 256 } },
              { fieldName: "vector", dataType: "FloatVector", elementTypeParams: { dim: input.dimension } },
            ],
          },
          indexParams: [{ fieldName: "vector", metricType: milvusMetric(input.metric), indexType: "AUTOINDEX" }],
        })
        // Validate the build is materialized (describe resolves the physical collection).
        await post("/collections/describe", { collectionName: name })
      }
      return {
        generationId: input.generationId,
        collections: input.collections,
        built: true,
        validated: true,
        state: "validated",
      }
    },
    upsert: async (input) => {
      const name = targetName(input.collection, input.generationId)
      const data = input.rows.map((row) => ({
        id: row.canonicalId,
        content_hash: row.canonicalVersion,
        project_id: row.filters.projectId,
        vector: [...row.dense],
      }))
      if (data.length === 0) return { upsertedCount: 0 }
      await post("/entities/upsert", { collectionName: name, data })
      return { upsertedCount: data.length }
    },
    tombstone: async (input) => {
      const name = targetName(input.collection, input.generationId)
      if (input.canonicalIds.length === 0) return { tombstonedCount: 0 }
      const idList = input.canonicalIds.map((id) => JSON.stringify(id)).join(", ")
      const json = await post("/entities/delete", { collectionName: name, filter: `id in [${idList}]` })
      const count = (dataOf(json) as { deleteCount?: number } | undefined)?.deleteCount
      return { tombstonedCount: typeof count === "number" ? count : input.canonicalIds.length }
    },
    enumerateIndexed: async (input) => {
      const name = targetName(input.collection, input.generationId)
      const json = await post("/entities/query", {
        collectionName: name,
        filter: `project_id == ${JSON.stringify(input.projectId)}`,
        outputFields: ["id", "content_hash"],
        limit: 16384,
      })
      const rows = (dataOf(json) as ReadonlyArray<{ id?: string; content_hash?: string }>) ?? []
      return {
        docs: rows.map((r) => ({ canonicalId: String(r.id ?? ""), contentHash: String(r.content_hash ?? "") })),
      }
    },
    swapAliases: async (input) => {
      for (const target of input.targets) {
        const alias = aliasName(target.collection)
        const physical = physicalName(target.collection, target.generationId)
        // Create the alias on first cutover, else re-point it atomically at the new generation.
        try {
          await post("/aliases/describe", { aliasName: alias })
          await post("/aliases/alter", { collectionName: physical, aliasName: alias })
        } catch {
          await post("/aliases/create", { collectionName: physical, aliasName: alias })
        }
      }
      return { swapped: input.targets.map((t) => t.collection) }
    },
    search: async (input) => {
      const name = aliasName(input.collection)
      const json = await post("/entities/search", {
        collectionName: name,
        data: [[...input.dense]],
        annsField: "vector",
        limit: input.topK,
        outputFields: ["id", "content_hash"],
        searchParams: { metricType },
      })
      const rows = (dataOf(json) as ReadonlyArray<{ id?: string; content_hash?: string; distance?: number }>) ?? []
      return {
        hits: rows.map((r) => ({
          canonicalId: String(r.id ?? ""),
          canonicalVersion: String(r.content_hash ?? ""),
          dense: typeof r.distance === "number" ? r.distance : 0,
          sparse: 0,
        })),
        consistency: input.consistency,
      }
    },
  }
}
