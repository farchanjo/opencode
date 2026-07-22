export * as RetrievalLive from "./retrieval-live"

import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { SemanticRetrieval } from "@/semantic/retrieval-service"
import { MilvusComposition } from "@/semantic/milvus-composition"
import type { BindingRuntime } from "@/semantic/binding-runtime"
import { EmbeddingsHttpClient } from "@/semantic/embeddings-http-client"
import { RerankProbe } from "@/operator/semantic/rerank-probe"
import { SemanticRegistryBackend } from "@/operator/semantic/registry-backend"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

/**
 * Feature 051 (FR9) — read the persisted semantic registry document off the effective config,
 * the SAME `operator.authorities.<AUTHORITY>.payload` record the operator store round-trips
 * (`config-service.ts` writes it under the `operator` namespace, keyed by
 * `SemanticRegistryBackend.AUTHORITY`). Structural + total: a missing/malformed document yields
 * `undefined`, and `BindingRuntime.resolveActiveBinding` then leaves the degraded default in place.
 */
function readSemanticRegistryDocument(info: ConfigV1.Info): BindingRuntime.RegistryDocumentView | undefined {
  const authorities = info.operator?.authorities as Record<string, { payload?: unknown }> | undefined
  const payload = authorities?.[SemanticRegistryBackend.AUTHORITY]?.payload
  return payload !== null && typeof payload === "object" ? (payload as BindingRuntime.RegistryDocumentView) : undefined
}

/**
 * Feature 051 (FR9) — assemble the live retrieval facade from the effective config + operator
 * environment. Every seam is constructed lazily/side-effect-free (adapter objects and `fetch`
 * closures only — no socket, no HTTP at boot), so mounting is inert until `narrowForTurn` first
 * calls a surface under an enabled gate (FR13 heritage). No Milvus endpoint OR no active embedding
 * binding → the pure `composeLiveRetrievalPort` falls open to the degraded default (no boot failure).
 * Provider auth is intentionally absent (`secretRef: null`) — the solaris P0 profile runs no-secret
 * local embedding/rerank providers.
 */
function composeSemanticRetrieval(info: ConfigV1.Info): SemanticRetrieval.Interface {
  const milvus = MilvusComposition.composeMilvusPort({
    address: process.env["OPENCODE_SEMANTIC_MILVUS_ADDRESS"]?.trim(),
    insecure: process.env["OPENCODE_SEMANTIC_MILVUS_INSECURE"] === "1",
    token: process.env["OPENCODE_SEMANTIC_MILVUS_TOKEN"] || undefined,
  })
  const narrowing = ConfigExperimental.resolveNarrowingConfig(info.experimental?.semantic_narrowing)
  return SemanticRetrieval.composeLiveRetrievalPort({
    registryDocument: readSemanticRegistryDocument(info),
    milvus,
    embedHttp: EmbeddingsHttpClient.createFetchEmbeddingsHttpClient({ secretRef: null }),
    rerankNativeHttp: RerankProbe.createNativeRerankHttpPort(),
    rerankStructuredHttp: RerankProbe.createStructuredRerankHttpPort(),
    projectId: process.env["OPENCODE_SEMANTIC_PROJECT_ID"] ?? "opencodedev",
    latencyBudgetMs: narrowing.latencyBudgetMs,
  })
}

/**
 * Feature 051 (FR9) — the live `SemanticRetrieval.Service` node. It REPLACES the shipped degraded
 * `SemanticRetrieval.node` in every composition that serves session turns (the shared `AppRuntime`
 * graph AND the server-route layer graph — the seams resolve the service softly, so a graph that
 * omits this mount silently degrades to gates-off passthrough), keyed by the shared service tag,
 * mirroring the `InstanceStore` bootstrap replacement.
 *
 * The effective config is resolved PER CALL, never at layer-build time: `config.get()` is
 * `InstanceState`-backed and requires an `InstanceRef` in the CALLER's context, which is absent
 * when this layer is memoized in the shared `AppRuntime` scope. Reading it at build time died
 * `InstanceRef not provided` and broke every InstanceStore bootstrap (and thus the operator CLI).
 * Each surface therefore reads config in the request fiber (session/turn), where `InstanceRef` is
 * provided, and composes the live facade for that instance — also correct for multiple instances
 * (distinct directories) sharing the one runtime, since `config.get()` is per-instance.
 */
export const node = LayerNode.make({
  service: SemanticRetrieval.Service,
  layer: Layer.effect(
    SemanticRetrieval.Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const withPort = <A, E>(use: (port: SemanticRetrieval.Interface) => Effect.Effect<A, E>) =>
        Effect.flatMap(config.get(), (info) => use(composeSemanticRetrieval(info)))
      return SemanticRetrieval.Service.of({
        retrieveAgents: (input) => withPort((port) => port.retrieveAgents(input)),
        retrieveSkills: (input) => withPort((port) => port.retrieveSkills(input)),
        retrieveTools: (input) => withPort((port) => port.retrieveTools(input)),
        retrieveSkillChunks: (input) => withPort((port) => port.retrieveSkillChunks(input)),
      })
    }),
  ),
  deps: [Config.node],
})
