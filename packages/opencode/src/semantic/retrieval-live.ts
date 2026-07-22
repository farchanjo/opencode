export * as RetrievalLive from "./retrieval-live"

import { Effect, Layer, Option } from "effect"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import type { PipelineRunner } from "@/semantic/pipeline-runner"
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
function composeSemanticRetrieval(
  info: ConfigV1.Info,
  revalidators?: { agents?: PipelineRunner.EntityRevalidator; skills?: PipelineRunner.EntityRevalidator },
): SemanticRetrieval.Interface {
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
    ...(revalidators?.agents ? { agents: revalidators.agents } : {}),
    ...(revalidators?.skills ? { skills: revalidators.skills } : {}),
  })
}

/**
 * Feature 051 (FR2) — build the live-registry revalidators for the agents/skills surfaces
 * from the CALLER's fiber (the captured context carries `InstanceRef` + the app services).
 * One `list()` per surface per retrieval call, memoized behind a lazy promise so each ranked
 * candidate checks a Set instead of re-reading the registry. A registry read failure marks
 * every id missing — the runner then drops it (fail-safe: stale never surfaces, FR2/AC5).
 */
function buildRevalidators(input: {
  readonly runWith: <A>(effect: Effect.Effect<A>) => Promise<A>
  readonly agents: Option.Option<Agent.Interface>
  readonly skills: Option.Option<Skill.Interface>
}): { agents?: PipelineRunner.EntityRevalidator; skills?: PipelineRunner.EntityRevalidator } {
  const lazySet = (load: () => Promise<ReadonlySet<string>>): PipelineRunner.EntityRevalidator => {
    let cache: Promise<ReadonlySet<string>> | undefined
    return {
      get: (id) => {
        cache ??= load().catch(() => new Set<string>())
        return cache.then((names) => ({ exists: names.has(id), permitted: names.has(id) }))
      },
    }
  }
  const agentService = Option.isSome(input.agents) ? input.agents.value : undefined
  const skillService = Option.isSome(input.skills) ? input.skills.value : undefined
  return {
    ...(agentService
      ? { agents: lazySet(() => input.runWith(agentService.list()).then((list) => new Set(list.map((item) => item.name)))) }
      : {}),
    ...(skillService
      ? { skills: lazySet(() => input.runWith(skillService.all()).then((list) => new Set(list.map((item) => item.name)))) }
      : {}),
  }
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
        Effect.gen(function* () {
          const info = yield* config.get()
          // Capture the caller's context so the promise-land revalidators can run
          // registry reads bound to the SAME instance (routing-hierarchy idiom).
          const context = yield* Effect.context<never>()
          const revalidators = buildRevalidators({
            runWith: (effect) => Effect.runPromiseWith(context)(effect),
            agents: yield* Effect.serviceOption(Agent.Service),
            skills: yield* Effect.serviceOption(Skill.Service),
          })
          return yield* use(composeSemanticRetrieval(info, revalidators))
        })
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
