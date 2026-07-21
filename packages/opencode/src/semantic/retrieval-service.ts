/**
 * Feature 050 / T025 (FR4) — the production retrieval facade as a per-instance
 * singleton.
 *
 * Declares the canonical `Context.Service<...>()("@opencode/SemanticRetrieval")`
 * singleton (as `agent.ts:99`, `tool/registry.ts:85`) that binds the production
 * `pipeline-runner.ts` as the facade's `PipelineRunnerPort` — ONE facade
 * construction in the composition root, never a second. The default layer
 * DEGRADES honestly: when no Milvus endpoint or active binding is resolvable it
 * still constructs, but with a runner whose calls reject, so the facade returns a
 * typed error and callers fail open (FR13 — zero live-turn change; nothing
 * consumes this yet).
 *
 * This module is intentionally NOT mounted into the session/prompt path or the
 * `AppLayer` node list — Feature 051 mounts the exported `node` and replaces the
 * degraded runner with real bindings via `createSemanticRetrievalPort`.
 */
export * as SemanticRetrieval from "./retrieval-service"

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { RetrievalPort, SkillChunkRetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"
import { RetrievalFacade } from "@/semantic/retrieval-facade"
import type { PipelineRunnerPort, RetrievalRecorder } from "@/semantic/retrieval-facade"
import { PipelineRunner } from "@/semantic/pipeline-runner"
import { BindingRuntime } from "@/semantic/binding-runtime"
import type { MilvusPort } from "@/semantic/milvus-adapter"
import type { EmbeddingsHttpPort } from "@/semantic/embedding-client"
import type { NativeRerankHttpPort, StructuredChatHttpPort } from "@/semantic/rerank-client"

/** The service interface is the composed retrieval + tool-retrieval + skill-chunk facade surface. */
export type Interface = RetrievalPort & ToolRetrievalPort & SkillChunkRetrievalPort

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticRetrieval") {}

/** A content-free recorder; the decision record is stamped without content (FR16, C22). */
const NOOP_RECORDER: RetrievalRecorder = { record: () => {} }

/** The degraded runner: every surface rejects when no active binding/Milvus port is composed (fail open at the caller). */
const UNAVAILABLE_RUNNER: PipelineRunnerPort = {
  runAgents: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
  runSkills: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
  runTools: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
  runSkillChunks: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
}

/**
 * Compose the production retrieval facade over a fully-resolved runner deps set —
 * the seam Feature 051 wires with `composeMilvusPort` + `resolveActiveBinding` +
 * `createFetchEmbeddingsHttpClient`. Kept a pure function so the singleton and the
 * live wiring share ONE facade construction path (FR4).
 */
export function createSemanticRetrievalPort(deps: PipelineRunner.PipelineRunnerDeps): Interface {
  return RetrievalFacade.createRetrievalFacade({ pipeline: PipelineRunner.createPipelineRunner(deps), recorder: NOOP_RECORDER })
}

/**
 * Feature 051 (FR9) — the degraded facade over the rejecting `UNAVAILABLE_RUNNER`, exported so
 * the live composition root (`effect/app-runtime.ts`) can fall open to the SAME honest floor the
 * default layer ships when no Milvus endpoint / active embedding binding is resolvable. Every
 * surface call rejects; `live-narrowing.ts` absorbs that into a passthrough (no boot failure).
 */
export function createDegradedSemanticRetrievalPort(): Interface {
  return RetrievalFacade.createRetrievalFacade({ pipeline: UNAVAILABLE_RUNNER, recorder: NOOP_RECORDER })
}

/**
 * Feature 051 (FR9) — the pure live-facade assembly the composition root feeds already-resolved
 * seams (Milvus port, embeddings client, per-mode reranker transports, the persisted registry
 * document, project scope, latency budget). It joins the active embedding/reranker bindings via
 * `BindingRuntime.resolveActiveBinding` and builds the production facade through the ONE shared
 * `createSemanticRetrievalPort` path; a missing Milvus port OR a missing/broken embedding binding
 * falls open to `createDegradedSemanticRetrievalPort` — never a fabricated endpoint, never a throw.
 * Kept pure (no `Config`/env/`process` reads) so it is unit-testable without standing up the runtime.
 */
export interface LiveRetrievalInput {
  readonly registryDocument?: BindingRuntime.RegistryDocumentView
  readonly milvus?: MilvusPort
  readonly embedHttp: EmbeddingsHttpPort
  readonly rerankNativeHttp?: NativeRerankHttpPort
  readonly rerankStructuredHttp?: StructuredChatHttpPort
  readonly projectId: string
  readonly latencyBudgetMs: number
}

export function composeLiveRetrievalPort(input: LiveRetrievalInput): Interface {
  const doc = input.registryDocument
  const embedding = doc ? BindingRuntime.resolveActiveBinding(doc, "embedding") : undefined
  if (input.milvus === undefined || embedding === undefined) return createDegradedSemanticRetrievalPort()
  const reranker = doc ? BindingRuntime.resolveActiveBinding(doc, "reranker") : undefined
  const rerankHttp =
    reranker === undefined
      ? {}
      : reranker.compatibilityMode === "structured-chat"
        ? input.rerankStructuredHttp
          ? { rerankStructuredHttp: input.rerankStructuredHttp }
          : {}
        : input.rerankNativeHttp
          ? { rerankNativeHttp: input.rerankNativeHttp }
          : {}
  return createSemanticRetrievalPort({
    milvus: input.milvus,
    embedHttp: input.embedHttp,
    bindings: reranker ? { embedding, reranker } : { embedding },
    ...rerankHttp,
    latencyBudgetMs: input.latencyBudgetMs,
    filters: { projectId: input.projectId, scope: "project", visibility: "project" },
  })
}

const layer = Layer.effect(Service, Effect.sync(() => Service.of(createDegradedSemanticRetrievalPort())))

export const node = LayerNode.make({ service: Service, layer, deps: [] })
