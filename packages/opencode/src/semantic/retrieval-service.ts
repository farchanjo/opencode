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
import type { RetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"
import { RetrievalFacade } from "@/semantic/retrieval-facade"
import type { PipelineRunnerPort, RetrievalRecorder } from "@/semantic/retrieval-facade"
import { PipelineRunner } from "@/semantic/pipeline-runner"

/** The service interface is the composed retrieval + tool-retrieval facade surface. */
export type Interface = RetrievalPort & ToolRetrievalPort

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticRetrieval") {}

/** A content-free recorder; the decision record is stamped without content (FR16, C22). */
const NOOP_RECORDER: RetrievalRecorder = { record: () => {} }

/** The degraded runner: every surface rejects when no active binding/Milvus port is composed (fail open at the caller). */
const UNAVAILABLE_RUNNER: PipelineRunnerPort = {
  runAgents: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
  runSkills: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
  runTools: () => Promise.reject(new Error("semantic retrieval unavailable: no active embedding binding")),
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

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(RetrievalFacade.createRetrievalFacade({ pipeline: UNAVAILABLE_RUNNER, recorder: NOOP_RECORDER }))),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })
