/**
 * Feature 006 / T034 (S22) — live `SemanticBackend` composition for the operator
 * stack.
 *
 * Turns the Feature 006 application adapters (Milvus adapter, embedding/rerank
 * clients, cutover executor, credential resolver) into the un-audited
 * `SemanticBackend` seam that `createSemanticPort` (T034) consumes, following the
 * `createLiveOutputSpoolBackend`/`createLiveLangLockBackend` precedent. It is
 * HONEST about what the operator `AppRuntime` reaches: the live Milvus/provider
 * stack is not bound from the operator runtime in this wave, so every method
 * returns the port's typed capability gap (`unavailable` / `milvus_unavailable`)
 * rather than fabricated data (mirrors the Feature 003 jobs / Feature 005
 * outputspool Residuals notes). The composition root injects a real per-port
 * `override` as the Milvus/provider stack is bound.
 *
 * Zero provider/model calls, tokens, or cost on this default path (FR28, AC14); a
 * caller always sees an honest capability gap and never a false success or a
 * secret/endpoint/path in a view (C19, C22).
 */
export * as SemanticBackendLive from "./backend-live"

import { Effect } from "effect"
import { createConfigBackedRegistry } from "./registry-backend"
import { MilvusBinding } from "./milvus-binding"
import type { BindingPort, IndexPort, ModelPort, ProviderPort } from "@opencode-ai/protocol/semantic/ports"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { MilvusPort } from "@/semantic/milvus-adapter"
import type { MetricKind } from "@opencode-ai/protocol/semantic/commands"
import type { SemanticBackend } from "./semantic-port"
import type { SemanticRegistryBackend } from "./registry-backend"

export interface LiveSemanticBackendDeps {
  /** Real per-port implementations the composition root injects as the stack is bound; unset falls back to the honest gap. */
  readonly override?: Partial<SemanticBackend>
  /**
   * Feature 017 / T016 (FR13, FR14) — the Milvus registry binding. When a Milvus
   * endpoint is configured the composition root supplies it, and `index.*` binds
   * over the shipped adapter under a bounded probe; unset degrades every index verb
   * to the same typed `milvus_unavailable` gap as today (the unconfigured identity).
   */
  readonly milvus?: MilvusBinding.MilvusIndexBindingDeps
  /**
   * The `Config.Service` seam backing the config-backed registry half (Feature 014
   * T009). When bound, the registry reads + CAS round-trip plans are wired real; the
   * Milvus/provider-probe ops still degrade to the typed gap. Unset keeps the
   * whole domain an honest capability gap (the pre-014 behaviour).
   */
  readonly config?: ConfigPort
  /**
   * Feature 019 (FR4, FR5) — the live Milvus port bound when an endpoint is configured.
   * Threaded into the config-backed registry so `embedding.reindex`/`cutover`/`rollback`
   * physically build a generation + swap the alias; absent → the `milvus_unavailable` floor.
   */
  readonly milvusPort?: MilvusPort
  /** The vector dimension/metric a generation build declares (defaults 1024 / cosine). */
  readonly generationDimension?: number
  readonly generationMetric?: MetricKind
  /** Optional pre-built registry (tests inject a double); defaults to the config-backed registry when `config` is set. */
  readonly registry?: SemanticRegistryBackend
}

const NOT_BOUND = "semantic Milvus/provider stack is not bound to the operator runtime in this wave"

const providerGap: ProviderPort = {
  list: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  add: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  update: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  test: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  disable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  delete: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  rotateSecret: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const modelGap: ModelPort = {
  list: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  discover: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  register: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  validate: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  disable: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const bindingGap: BindingPort = {
  showEmbedding: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  selectEmbedding: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  validateEmbedding: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  reindexEmbedding: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  cutoverEmbedding: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  rollbackEmbedding: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  showReranker: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  selectReranker: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  validateReranker: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  cutoverReranker: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  rollbackReranker: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  status: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
  history: () => Effect.fail({ type: "unavailable", reason: NOT_BOUND }),
}

const indexGap: IndexPort = {
  status: () => Effect.fail({ type: "milvus_unavailable", reason: NOT_BOUND }),
  test: () => Effect.fail({ type: "milvus_unavailable", reason: NOT_BOUND }),
  reindex: () => Effect.fail({ type: "milvus_unavailable", reason: NOT_BOUND }),
  reconcile: () => Effect.fail({ type: "milvus_unavailable", reason: NOT_BOUND }),
  showCollections: () => Effect.fail({ type: "milvus_unavailable", reason: NOT_BOUND }),
}

const gapBackend: SemanticBackend = { provider: providerGap, model: modelGap, binding: bindingGap, index: indexGap }

/**
 * Build the live backend: the honest gap default overlaid with any injected real
 * ports + the config-backed registry. When a Milvus endpoint is configured
 * (`deps.milvus`), the `index` port binds over the shipped adapter under a bounded
 * probe (T016); an explicit `override.index` still wins for tests/composition.
 */
export const createLiveSemanticBackend = (deps: LiveSemanticBackendDeps = {}): SemanticBackend => ({
  provider: deps.override?.provider ?? gapBackend.provider,
  model: deps.override?.model ?? gapBackend.model,
  binding: deps.override?.binding ?? gapBackend.binding,
  index: deps.override?.index ?? (deps.milvus ? MilvusBinding.createMilvusIndexPort(deps.milvus) : gapBackend.index),
  registry:
    deps.registry ??
    deps.override?.registry ??
    (deps.config
      ? createConfigBackedRegistry({
          config: deps.config,
          milvus: deps.milvusPort ?? deps.milvus?.port,
          defaultDimension: deps.generationDimension,
          defaultMetric: deps.generationMetric,
        })
      : undefined),
})
