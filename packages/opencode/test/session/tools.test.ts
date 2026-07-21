import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Truncate } from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import type { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TaskPromptOps } from "@/tool/task"
import type { Provider } from "@/provider/provider"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

// Feature 051 (T018) — two MCP tools so `narrowRecord` (MCP surface) has
// something to narrow, mirroring `test/tool/registry.test.ts`'s code-mode fixture.
const mcpMockLayer = Layer.mock(MCP.Service, {
  tools: () =>
    Effect.succeed({
      alpha_mcp_tool: {
        def: {
          name: "alpha",
          description: "alpha MCP tool",
          inputSchema: { type: "object", properties: {}, required: [] },
        } as MCPToolDef,
        client: {} as MCP.McpTool["client"],
      },
      beta_mcp_tool: {
        def: {
          name: "beta",
          description: "beta MCP tool",
          inputSchema: { type: "object", properties: {}, required: [] },
        } as MCPToolDef,
        client: {} as MCP.McpTool["client"],
      },
    }),
  clients: () => Effect.succeed({}),
})

// `SessionTools.resolve` is a plain exported function (not a `Service`), so
// every service it `yield*`s directly must be exposed at the TOP level of the
// compiled graph — its internal transitive deps (via `ToolRegistry.node`)
// stay hidden from the compiled layer's output unless listed here too.
const root = LayerNode.group([
  ToolRegistry.node,
  Agent.node,
  Permission.node,
  MCP.node,
  RuntimeFlags.node,
  Plugin.node,
  Truncate.node,
])
const it = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [MCP.node, mcpMockLayer],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

// `api.id` deliberately avoids the substring "gpt-" — `ToolRegistry.tools`
// swaps `edit`/`write` for `apply_patch` on GPT-family models unrelated to
// this seam's ranking gate, which would otherwise shadow the essential-tool
// floor assertions below.
const model: Provider.Model = {
  id: ModelV2.ID.make("claude-test-model"),
  providerID: ProviderV2.ID.make("anthropic"),
  api: {
    id: "claude-test-model",
    url: "https://api.anthropic.com/v1",
    npm: "@ai-sdk/anthropic",
  },
  name: "Claude Test Model",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128_000, input: 128_000, output: 32_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function sessionFixture(permission?: Session.Info["permission"]): Session.Info {
  return {
    id: SessionID.descending(),
    slug: "test-session",
    projectID: "global" as Session.Info["projectID"],
    workspaceID: undefined,
    directory: "/tmp/opencode",
    parentID: undefined,
    summary: undefined,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    share: undefined,
    title: "Test session",
    version: "1.0.0",
    time: { created: 1, updated: 2, compacting: undefined, archived: undefined },
    permission,
    revert: undefined,
  } as Session.Info
}

// `resolve()` only reads `message.id` from inside per-tool `execute` closures
// that this suite never invokes — a minimal stub is safe here.
const processor = {
  message: { id: MessageID.ascending() } as unknown as SessionV1.Assistant,
  updateToolCall: () => Effect.succeed(undefined),
  completeToolCall: () => Effect.void,
}

// Likewise never invoked outside a `task` tool's own `execute` — resolve()
// only stores this in `ctx.extra`.
const promptOps: TaskPromptOps = {
  cancel: () => Effect.void,
  resolvePromptParts: () => Effect.succeed([]),
  prompt: () => Effect.die(new Error("promptOps.prompt should not be called by SessionTools.resolve")),
}

describe("session.tools — tools seam (Feature 051)", () => {
  it.instance("an undefined rankedTools stays PASSTHROUGH: every permission-visible tool is present", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const agent = yield* agents.defaultInfo()
      const tools = yield* SessionTools.resolve({
        agent,
        model,
        session: sessionFixture(),
        processor,
        bypassAgentCheck: false,
        messages: [],
        promptOps,
      })

      expect(Object.keys(tools)).toContain("read")
      expect(Object.keys(tools)).toContain("bash")
      expect(Object.keys(tools)).toContain("alpha_mcp_tool")
      expect(Object.keys(tools)).toContain("beta_mcp_tool")
    }),
  )

  it.instance("a ranked subset narrows the native surface, keeping the essential-tool floor", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const agent = yield* agents.defaultInfo()
      const tools = yield* SessionTools.resolve({
        agent,
        model,
        session: sessionFixture(),
        processor,
        bypassAgentCheck: false,
        messages: [],
        promptOps,
        // "webfetch" is not part of the essential floor and is excluded from
        // the ranking — it must be dropped. Every floor tool must survive even
        // though only "read" is explicitly ranked.
        rankedTools: ["read"],
      })

      expect(Object.keys(tools)).toContain("read")
      for (const floorId of ["task", "skill", "todowrite", "question", "read", "edit", "write", "bash", "grep", "glob"]) {
        expect(Object.keys(tools)).toContain(floorId)
      }
      expect(Object.keys(tools)).not.toContain("webfetch")
    }),
  )

  it.instance("a ranked subset narrows the MCP surface", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const agent = yield* agents.defaultInfo()
      const tools = yield* SessionTools.resolve({
        agent,
        model,
        session: sessionFixture(),
        processor,
        bypassAgentCheck: false,
        messages: [],
        promptOps,
        rankedTools: ["alpha_mcp_tool"],
      })

      expect(Object.keys(tools)).toContain("alpha_mcp_tool")
      expect(Object.keys(tools)).not.toContain("beta_mcp_tool")
    }),
  )

  it.instance("skipToolNarrowing forces PASSTHROUGH even when rankedTools is present", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const agent = yield* agents.defaultInfo()
      const tools = yield* SessionTools.resolve({
        agent,
        model,
        session: sessionFixture(),
        processor,
        bypassAgentCheck: false,
        messages: [],
        promptOps,
        rankedTools: ["read"],
        skipToolNarrowing: true,
      })

      expect(Object.keys(tools)).toContain("alpha_mcp_tool")
      expect(Object.keys(tools)).toContain("beta_mcp_tool")
      expect(Object.keys(tools)).toContain("bash")
      expect(Object.keys(tools)).toContain("write")
    }),
  )

  it.instance(
    "an undefined rankedTools renders the exact same native+MCP key set as the pre-Feature-051 PASSTHROUGH gate",
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const agent = yield* agents.defaultInfo()
        const withoutRanking = yield* SessionTools.resolve({
          agent,
          model,
          session: sessionFixture(),
          processor,
          bypassAgentCheck: false,
          messages: [],
          promptOps,
        })
        const withExplicitUndefined = yield* SessionTools.resolve({
          agent,
          model,
          session: sessionFixture(),
          processor,
          bypassAgentCheck: false,
          messages: [],
          promptOps,
          rankedTools: undefined,
          skipToolNarrowing: undefined,
        })

        expect(Object.keys(withExplicitUndefined).sort()).toEqual(Object.keys(withoutRanking).sort())
      }),
  )
})
