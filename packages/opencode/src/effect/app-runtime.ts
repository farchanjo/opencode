import { Layer, ManagedRuntime } from "effect"
import { attach } from "./run-service"
import * as Observability from "@opencode-ai/core/observability"

import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Storage } from "@/storage/storage"
import { Snapshot } from "@/snapshot"
import { Plugin } from "@/plugin"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Todo } from "@/session/todo"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { SessionProcessor } from "@/session/processor"
import { SessionCompaction } from "@/session/compaction"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Command } from "@/command"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { Format } from "@/format"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Workspace } from "@/control-plane/workspace"
import { Worktree } from "@/worktree"
import { Installation } from "@/installation"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { Npm } from "@opencode-ai/core/npm"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilderV1 } from "./app-node-builder-v1"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect } from "effect"
import { SemanticRetrieval } from "@/semantic/retrieval-service"
import { MilvusComposition } from "@/semantic/milvus-composition"
import type { BindingRuntime } from "@/semantic/binding-runtime"
import { EmbeddingsHttpClient } from "@/semantic/embeddings-http-client"
import { RerankProbe } from "@/operator/semantic/rerank-probe"
import { SemanticRegistryBackend } from "@/operator/semantic/registry-backend"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"

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
 * `SemanticRetrieval.node` everywhere in the graph (via the `AppNodeBuilderV1.build` replacement
 * below, keyed by the shared service tag), mirroring the `InstanceStore` bootstrap replacement.
 */
const SemanticRetrievalLive = LayerNode.make({
  service: SemanticRetrieval.Service,
  layer: Layer.effect(
    SemanticRetrieval.Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return SemanticRetrieval.Service.of(composeSemanticRetrieval(yield* config.get()))
    }),
  ),
  deps: [Config.node],
})

export const AppLayer = AppNodeBuilderV1.build(
  LayerNode.group([
    Npm.node,
    FSUtil.node,
    Database.node,
    Auth.node,
    Account.node,
    Config.node,
    Git.node,
    Storage.node,
    Snapshot.node,
    Plugin.node,
    ModelsDev.node,
    Provider.node,
    ProviderAuth.node,
    Agent.node,
    Skill.node,
    Discovery.node,
    Question.node,
    Permission.node,
    Todo.node,
    Session.node,
    SessionProjector.node,
    SessionStatus.node,
    BackgroundJob.node,
    RuntimeFlags.node,
    EventV2Bridge.node,
    SessionRunState.node,
    SessionProcessor.node,
    SessionCompaction.node,
    SessionRevert.node,
    SessionSummary.node,
    SessionPrompt.node,
    Instruction.node,
    LLM.node,
    LSP.node,
    MCP.node,
    McpAuth.node,
    Command.node,
    Truncate.node,
    ToolRegistry.node,
    Format.node,
    InstanceStore.node,
    Project.node,
    Vcs.node,
    Workspace.node,
    Worktree.node,
    Installation.node,
    ShareNext.node,
    SessionShare.node,
    SemanticRetrieval.node,
  ]),
  [[SemanticRetrieval.node, SemanticRetrievalLive]],
).pipe(Layer.provideMerge(AppNodeBuilderV1.build(Ripgrep.node)), Layer.provideMerge(Observability.layer))

const rt = ManagedRuntime.make(AppLayer, { memoMap })
type Runtime = Pick<typeof rt, "runSync" | "runPromise" | "runPromiseExit" | "runFork" | "runCallback" | "dispose">

/** Services provided by AppRuntime — i.e. what an Effect run via AppRuntime.runPromise can yield. */
export type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof rt>
const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never

export const AppRuntime: Runtime = {
  runSync(effect) {
    return rt.runSync(wrap(effect))
  },
  runPromise(effect, options) {
    return rt.runPromise(wrap(effect), options)
  },
  runPromiseExit(effect, options) {
    return rt.runPromiseExit(wrap(effect), options)
  },
  runFork(effect) {
    return rt.runFork(wrap(effect))
  },
  runCallback(effect) {
    return rt.runCallback(wrap(effect))
  },
  dispose: () => rt.dispose(),
}
