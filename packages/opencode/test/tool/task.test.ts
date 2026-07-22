import { afterEach, describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { TaskTool, resolveReasoningEffort, stampCompletionTokens, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { RoutingHierarchy } from "@/session/routing-hierarchy"
import { createRoutingSessionStateStore } from "@/session/routing-state"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      EventV2Bridge.node,
      Config.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      SessionRunState.node,
      SessionStatus.node,
      Truncate.node,
      ToolRegistry.node,
      Database.node,
      RuntimeFlags.node,
      Ripgrep.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer(flags)]],
  )

const it = testEffect(layer())
const background = testEffect(layer({ experimentalBackgroundSubagents: true }))

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`<task id="${child.id}" state="completed">`)
      expect(seen?.sessionID).toBe(child.id)
      expect(seen?.variant).toBe("xhigh")
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`<task id="${result.metadata.sessionId}" state="completed">`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance("prevents subagents from launching subagents by default", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const nestedAssistant = yield* sessions.updateMessage({
        ...assistant,
        id: MessageID.ascending(),
        parentID: MessageID.ascending(),
        sessionID: child.id,
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let asked = false

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.sync(() => (asked = true)),
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(asked).toBe(false)
      expect(yield* sessions.children(child.id)).toHaveLength(0)
    }),
  )

  it.instance(
    "allows nested subagents up to the configured depth",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "child" })
        const nestedAssistant = yield* sessions.updateMessage({
          ...assistant,
          id: MessageID.ascending(),
          parentID: MessageID.ascending(),
          sessionID: child.id,
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect((yield* sessions.get(result.metadata.sessionId)).parentID).toBe(child.id)
      }),
    { config: { subagent_depth: 2 } },
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.agent).toBe("reviewer")
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "read",
            pattern: "*",
            action: "deny",
          },
        ])
        expect(seen?.tools).toBeUndefined()
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("rejects background execution when the experiment is disabled", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("promotes a running foreground task without restarting it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = yield* Deferred.make<void>()
      const done = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.PromptInput>()
      let runs = 0
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            return Deferred.succeed(injected, input).pipe(Effect.as(reply(input, "injected")))
          }
          return Effect.gen(function* () {
            runs += 1
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(done)
            return reply(input, "background done")
          })
        },
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      const job = (yield* jobs.list())[0]
      expect(job).toBeDefined()
      if (!job) throw new Error("task job not found")
      expect(job.metadata?.parentSessionId).toBe(chat.id)
      yield* jobs.promote(job.id)

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect((yield* jobs.get(result.metadata.sessionId))?.status).toBe("running")
      expect(runs).toBe(1)

      yield* Deferred.succeed(done, undefined)
      expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.output).toBe("background done")
      expect((yield* Deferred.await(injected)).parts[0]?.type).toBe("text")
      expect(runs).toBe(1)
    }),
  )

  background.instance("execute launches background tasks without waiting for completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const job = yield* jobs.get(result.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect(job?.status).toBe("running")
    }),
  )

  background.instance("background task completion waits for running updates", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const first = defer<void>()
      const second = defer<void>()
      const updated = defer<SessionPrompt.PromptInput>()
      const injected = defer<SessionPrompt.PromptInput>()
      let prompts = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            injected.resolve(input)
            return Effect.succeed(reply(input, "done"))
          }
          prompts++
          if (prompts === 1) return Effect.promise(() => first.promise).pipe(Effect.as(reply(input, "first done")))
          updated.resolve(input)
          return Effect.promise(() => second.promise).pipe(Effect.as(reply(input, "second done")))
        },
      }
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const started = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        context,
      )
      const result = yield* def.execute(
        {
          description: "add investigation scope",
          prompt: "also inspect cancellation",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context,
      )

      expect(result.metadata.sessionId).toBe(started.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain("Background task updated")
      first.resolve()
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")
      expect((yield* Effect.promise(() => updated.promise)).parts).toEqual([
        { type: "text", text: "also inspect cancellation" },
      ])

      second.resolve()
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("second done")
      const notification = yield* Effect.promise(() => injected.promise)
      expect(notification.variant).toBe("xhigh")
      expect(notification.parts[0]?.type).toBe("text")
      if (notification.parts[0]?.type === "text") expect(notification.parts[0].text).toContain("second done")
    }),
  )

  background.instance("background tasks complete through the background job service", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("background done")
    }),
  )

  background.instance("background task completion does not wait for the parent async prompt", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps({ text: "background done" }),
              prompt: (input) =>
                input.sessionID === chat.id ? Effect.never : Effect.succeed(reply(input, "background done")),
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
    }),
  )

  background.instance("removing the parent session cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("removing the child task session cancels its running background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(result.metadata.sessionId)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("cancelling the parent run cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* runState.cancel(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a child run cancels its own pre-runner task job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })

      yield* runState.cancel(child.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a parent run recursively cancels descendant background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })
      yield* jobs.start({
        id: grandchild.id,
        type: "task",
        metadata: { parentSessionId: child.id, sessionId: grandchild.id },
        run: Effect.never,
      })

      yield* runState.cancel(chat.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )

  // ===========================================================================
  // Feature 049 — the live LLM `task`-tool spawn path consumes the per-invocation
  // hierarchy resolver injected into `ctx.extra` (the seam the bug omitted). These
  // drive `TaskTool.execute` directly with a `hierarchyResolve` closure and assert
  // the routed model reaches the child (not parent inheritance), that a pinned
  // agent model still wins, that the default path is byte-identical, and that a
  // blocked decision fails the spawn.
  // ===========================================================================

  const managerRef = {
    providerID: ProviderV2.ID.make("anthropic"),
    modelID: ModelV2.ID.make("manager-model"),
  }

  const routeResolve = (store: ReturnType<typeof createRoutingSessionStateStore>, parentSessionId: string) =>
    ((_input) =>
      Effect.succeed({
        kind: "route",
        model: managerRef,
        dispatch: {
          store,
          lineageStub: { parent_session_id: parentSessionId, parent_role: "architect", child_role: "manager" },
          denyExecutionTools: true,
          maxDepth: 2,
          forceManager: true,
        },
      })) satisfies RoutingHierarchy.LiveHierarchyResolve

  it.instance("Feature 049 — a routed live spawn runs the child on the routed model + records lineage", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const store = createRoutingSessionStateStore()
      let seen: SessionPrompt.PromptInput | undefined
      // The child's routing state is released post-completion (bounded retention),
      // so capture the recorded lineage DURING the run (the child session id is the
      // prompt's own session id).
      let roleAtRun: string | null | undefined
      const promptOps = stubOps({
        onPrompt: (input) => {
          seen = input
          roleAtRun = store.get(SessionID.make(input.sessionID)).hierarchyRole
        },
      })

      const result = yield* def.execute(
        { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps, hierarchyResolve: routeResolve(store, chat.id) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      // The child ran on the ROUTED manager model, not the parent's model (ref).
      expect(seen?.model).toEqual(managerRef)
      expect(result.metadata.model).toEqual(managerRef)
      // The dispatch lineage was recorded on the shared store as a manager child.
      expect(roleAtRun).toBe("manager")
      // The manager child is created under orchestration-only tool denies.
      const kid = yield* sessions.get(SessionID.make(result.metadata.sessionId))
      expect(kid.permission?.some((r) => r.permission === "*" && r.action === "deny")).toBe(true)
    }),
  )

  it.instance("Feature 049 — without a resolver the child inherits the parent model (byte-identical)", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      yield* def.execute(
        { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(seen?.model).toEqual(ref)
    }),
  )

  it.instance(
    "Feature 049 — an agent-pinned model wins over the routed model (precedence)",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const store = createRoutingSessionStateStore()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        yield* def.execute(
          { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "pinned" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, hierarchyResolve: routeResolve(store, chat.id) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        // The pinned agent's own model wins over the routed manager model.
        expect(seen?.model).toEqual({
          providerID: ProviderV2.ID.make("test"),
          modelID: ModelV2.ID.make("pinned-model"),
        })
      }),
    { config: { agent: { pinned: { mode: "subagent", model: "test/pinned-model" } } } },
  )

  it.instance("Feature 049 — a blocked hierarchy decision surfaces as a failed spawn (no child created)", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const blockResolve: RoutingHierarchy.LiveHierarchyResolve = () =>
        Effect.succeed({
          kind: "blocked",
          rejection: { reason: "depth_exceeded", detail: "delegation depth 3 exceeds effective max 2" },
        })

      const exit = yield* def
        .execute(
          { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps(), hierarchyResolve: blockResolve },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
    }),
  )

  // ===========================================================================
  // Feature 053 — deterministic orchestration handoff: role-to-agent binding +
  // the always-on synchronous Data -> Composer interception. These drive
  // `TaskTool.execute` with a `hierarchyResolve` closure carrying the three
  // optional bindings and assert: the bound manager agent overrides the
  // LLM-chosen `subagent_type` (or degrades on an invalid/pinned binding); the
  // composed brief (not the raw prompt) reaches `applyManagerPersona`; a
  // synthetic spawning session never re-triggers the interception; and an
  // unbound config is byte-identical to Feature 048.
  // ===========================================================================

  const managerRoute = (
    store: ReturnType<typeof createRoutingSessionStateStore>,
    parentSessionId: string,
    bindings?: { manager?: string; data?: string; composer?: string },
  ) =>
    ((_input) =>
      Effect.succeed({
        kind: "route",
        model: managerRef,
        dispatch: {
          store,
          lineageStub: { parent_session_id: parentSessionId, parent_role: "architect", child_role: "manager" },
          denyExecutionTools: true,
          maxDepth: 2,
          forceManager: true,
          bindings,
        },
      })) satisfies RoutingHierarchy.LiveHierarchyResolve

  const handoffConfig = {
    config: {
      agent: {
        "manager-router": { mode: "subagent" as const, hidden: true, description: "Manager" },
        "manager-composer": { mode: "subagent" as const, hidden: true, description: "Composer" },
        "pinned-manager": { mode: "subagent" as const, hidden: true, model: "test/pinned-model" },
      },
    },
  }

  const execManager = (
    store: ReturnType<typeof createRoutingSessionStateStore>,
    chat: { id: SessionID },
    assistant: { id: MessageID },
    promptOps: TaskPromptOps,
    bindings?: { manager?: string; data?: string; composer?: string },
  ) =>
    Effect.gen(function* () {
      const tool = yield* TaskTool
      const def = yield* tool.init()
      return yield* def.execute(
        { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps, hierarchyResolve: managerRoute(store, chat.id, bindings) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
    })

  it.instance(
    "Feature 053 — a resolved manager_agent binding overrides the LLM-chosen subagent_type",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const store = createRoutingSessionStateStore()
        const result = yield* execManager(store, chat, assistant, stubOps(), { manager: "manager-router" })
        const kid = yield* sessions.get(SessionID.make(result.metadata.sessionId))
        expect(kid.agent).toBe("manager-router")
      }),
    handoffConfig,
  )

  it.instance(
    "Feature 053 — an unknown manager_agent binding degrades to the requested subagent_type",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const store = createRoutingSessionStateStore()
        const result = yield* execManager(store, chat, assistant, stubOps(), { manager: "no-such-agent" })
        const kid = yield* sessions.get(SessionID.make(result.metadata.sessionId))
        expect(kid.agent).toBe("general")
      }),
    handoffConfig,
  )

  it.instance(
    "Feature 053 — a model-pinned manager_agent binding degrades to the requested subagent_type",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const store = createRoutingSessionStateStore()
        const result = yield* execManager(store, chat, assistant, stubOps(), { manager: "pinned-manager" })
        const kid = yield* sessions.get(SessionID.make(result.metadata.sessionId))
        expect(kid.agent).toBe("general")
      }),
    handoffConfig,
  )

  it.instance(
    "Feature 053 — Data -> Composer interception feeds the composed brief to applyManagerPersona",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const store = createRoutingSessionStateStore()
        const seen: SessionPrompt.PromptInput[] = []
        const promptOps: TaskPromptOps = {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            Effect.sync(() => {
              seen.push(input)
              const text =
                input.agent === "explore"
                  ? "recon facts"
                  : input.agent === "manager-composer"
                    ? "SUBTASK PLAN: parser work"
                    : "manager done"
              return reply(input, text)
            }),
        }

        const result = yield* execManager(store, chat, assistant, promptOps, {
          manager: "manager-router",
          data: "explore",
          composer: "manager-composer",
        })

        // Data then Composer ran before the Manager's own turn.
        const agents = seen.map((s) => s.agent)
        expect(agents).toEqual(["explore", "manager-composer", "manager-router"])

        // The Manager received the COMPOSED brief (not the raw Architect prompt), wrapped
        // by the UNCHANGED persona prelude.
        const managerTurn = seen.find((s) => s.agent === "manager-router")
        const managerText = managerTurn?.parts[0]?.type === "text" ? managerTurn.parts[0].text : ""
        expect(managerText).toContain("You are the MANAGER tier")
        expect(managerText).toContain("SUBTASK PLAN: parser work")
        expect(managerText).not.toContain("look into the cache key path")

        // Data + Composer sub-sessions are parented under the Manager's own session and
        // consume NO delegation budget (the manager aggregate rosters no worker for them).
        const managerSession = SessionID.make(result.metadata.sessionId)
        const subs = yield* sessions.children(managerSession)
        expect(subs).toHaveLength(2)
        expect(store.get(managerSession).aggregate).toBeNull()
      }),
    handoffConfig,
  )

  it.instance(
    "Feature 053 — a synthetic spawning session never re-triggers the interception",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const store = createRoutingSessionStateStore()
        // Pretend the spawning session is itself a Data/Composer sub-session.
        store.markSynthetic(chat.id)
        const seen: SessionPrompt.PromptInput[] = []
        const promptOps = stubOps({ onPrompt: (input) => seen.push(input) })

        const result = yield* execManager(store, chat, assistant, promptOps, {
          manager: "manager-router",
          data: "explore",
          composer: "manager-composer",
        })

        // Zero nested interceptions: only the Manager's own turn ran, no Data/Composer.
        expect(seen.map((s) => s.agent)).toEqual(["manager-router"])
        const managerText = seen[0]?.parts[0]?.type === "text" ? seen[0].parts[0].text : ""
        expect(managerText).toContain("look into the cache key path")
        expect(yield* sessions.children(SessionID.make(result.metadata.sessionId))).toHaveLength(0)
      }),
    handoffConfig,
  )

  it.instance(
    "Feature 053 — an unbound composer_agent renders byte-identical to Feature 048 (raw prompt)",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const store = createRoutingSessionStateStore()
        const seen: SessionPrompt.PromptInput[] = []
        const promptOps = stubOps({ onPrompt: (input) => seen.push(input) })

        // Only a manager binding, no data/composer — the interception never runs.
        const result = yield* execManager(store, chat, assistant, promptOps, { manager: "manager-router" })

        expect(seen.map((s) => s.agent)).toEqual(["manager-router"])
        const managerText = seen[0]?.parts[0]?.type === "text" ? seen[0].parts[0].text : ""
        expect(managerText).toContain("You are the MANAGER tier")
        expect(managerText).toContain("look into the cache key path")
        expect(yield* sessions.children(SessionID.make(result.metadata.sessionId))).toHaveLength(0)
      }),
    handoffConfig,
  )

  // Feature 054 — completion metadata envelope (effort at spawn, tokens at return).
  it.instance("Feature 054 — stamps tokens from the child session on foreground completion", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps = stubOps()

      const result = yield* def.execute(
        { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const child = yield* sessions.get(SessionID.make(result.metadata.sessionId))
      expect(result.metadata.model).toEqual(ref)
      expect(result.metadata.effort).toBeUndefined()
      expect(result.metadata.tokens).toEqual(child.tokens)
      expect(result.metadata.tokens).toEqual({
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      })
    }),
  )

  it.instance(
    "Feature 054 — stamps effort from merged config model options at spawn",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const promptOps = stubOps()

        const result = yield* def.execute(
          { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.metadata.effort).toBe("xhigh")
        expect(result.metadata.model).toEqual(ref)
        expect(result.metadata.tokens).toBeDefined()
      }),
    {
      config: {
        provider: {
          test: {
            models: {
              "test-model": {
                options: { reasoningEffort: "xhigh" },
              },
            },
          },
        },
      },
    },
  )

  it.instance("Feature 054 — session-read failure leaves spawn metadata without tokens (AC4)", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      // Remove the child as soon as the prompt is admitted so the completion
      // re-read of the session record fails closed to the spawn envelope.
      const promptOps = stubOps({
        onPrompt: (input) => {
          void Effect.runPromise(sessions.remove(SessionID.make(input.sessionID)))
        },
      })

      const result = yield* def.execute(
        { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.metadata.model).toEqual(ref)
      expect(result.metadata.sessionId).toBeDefined()
      // Spawn-time envelope only — tokens key absent when the completion read fails.
      expect(result.metadata.tokens).toBeUndefined()
    }),
  )
})

describe("tool.task Feature 054 helpers", () => {
  test("resolveReasoningEffort prefers model options over provider options", () => {
    expect(
      resolveReasoningEffort(
        {
          provider: {
            openai: {
              options: { reasoningEffort: "medium" },
              models: { "gpt-x": { options: { reasoningEffort: "xhigh" } } },
            },
          },
        },
        { providerID: "openai", modelID: "gpt-x" },
      ),
    ).toBe("xhigh")
    expect(
      resolveReasoningEffort(
        { provider: { openai: { options: { reasoningEffort: "low" } } } },
        { providerID: "openai", modelID: "gpt-x" },
      ),
    ).toBe("low")
    expect(resolveReasoningEffort({}, { providerID: "openai", modelID: "gpt-x" })).toBeUndefined()
    expect(
      resolveReasoningEffort(
        { provider: { openai: { models: { "gpt-x": { options: { reasoningEffort: "" } } } } } },
        { providerID: "openai", modelID: "gpt-x" },
      ),
    ).toBeUndefined()
  })

  test("stampCompletionTokens spreads tokens or leaves the envelope unchanged", () => {
    const base = { sessionId: "ses_1", model: { providerID: "openai", modelID: "gpt-x" } }
    expect(stampCompletionTokens(base, undefined)).toBe(base)
    expect(
      stampCompletionTokens(base, {
        input: 10,
        output: 2,
        reasoning: 1,
        cache: { read: 0, write: 0 },
      }),
    ).toEqual({
      ...base,
      tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
    })
  })
})
