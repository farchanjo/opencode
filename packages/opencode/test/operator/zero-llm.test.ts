import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  assertAdminResultShape,
  createDispatcher,
  createForbiddenLlmPort,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  createZeroLlmProbe,
  findForbiddenImports,
  fixtureStatusHandler,
} from "@/operator/application"
import { isAdminResult, isTranscriptLike, successResult, type CommandRequest } from "@opencode-ai/core/operator"

const applicationDir = path.resolve(import.meta.dir, "../../src/operator/application")

describe("zero-LLM invariant (T012)", () => {
  test("dispatcher and registry source have no provider/LLM imports", async () => {
    const files = ["dispatcher.ts", "registry.ts", "confirmation.ts", "handler.ts", "zero-llm.ts", "index.ts"]
    for (const file of files) {
      const text = await fs.readFile(path.join(applicationDir, file), "utf8")
      const hits = findForbiddenImports(text)
      expect(hits).toEqual([])
    }
  })

  test("core operator domain has no provider/LLM imports", async () => {
    const coreDir = path.resolve(import.meta.dir, "../../../core/src/operator")
    const entries = await fs.readdir(coreDir)
    for (const file of entries) {
      if (!file.endsWith(".ts")) continue
      const text = await fs.readFile(path.join(coreDir, file), "utf8")
      const hits = findForbiddenImports(text)
      expect(hits).toEqual([])
    }
  })

  test("dispatch never records provider/model/session_prompt/tool_registry", async () => {
    const probe = createZeroLlmProbe()
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      probe,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest({
      id: "langlock.status" as CommandRequest["id"],
      principal: { kind: "operator", subject: "local", projectBinding: null },
      scope: { kind: "project", ref: "p1" },
      source: "cli",
      isTty: false,
    })
    expect(result.ok).toBe(true)
    expect(probe.invocations()).toEqual([])
    probe.assertClean()
  })

  test("forbidden LLM port records and fails when invoked from handler", async () => {
    const forbidden = createForbiddenLlmPort()
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      probe: forbidden.probe,
      handlers: createHandlerMap([
        [
          "langlock.status",
          () => {
            forbidden.invokeProvider()
            return { kind: "query", effective: { status: "ok" } }
          },
        ],
      ]),
    })
    await expect(
      dispatcher.dispatchRequest({
        id: "langlock.status" as CommandRequest["id"],
        principal: { kind: "operator", subject: "local", projectBinding: null },
        scope: { kind: "project", ref: "p1" },
        source: "api",
      }),
    ).rejects.toThrow(/provider must not be invoked/)
  })

  test("admin result is never transcript/message type", () => {
    const result = successResult({ id: "langlock.status", effective: { language: "en-US" } })
    expect(isAdminResult(result)).toBe(true)
    expect(isTranscriptLike(result)).toBe(false)
    expect(result.kind).toBe("operator.admin_result")
    assertAdminResultShape(result)

    expect(isTranscriptLike({ kind: "message", role: "user" })).toBe(true)
    expect(isTranscriptLike({ type: "assistant" })).toBe(true)
    expect(isTranscriptLike({ role: "user" })).toBe(true)
  })

  test("sample admin commands complete with zero provider calls", async () => {
    const probe = createZeroLlmProbe()
    const registry = createSeededOperatorCommandRegistry()
    const samples = ["telemetry.status", "routing.test", "langlock.status", "semantic.binding.status", "mcp.server.list"]
    const dispatcher = createDispatcher({
      registry,
      probe,
      handlers: createHandlerMap(samples.map((id) => [id, fixtureStatusHandler] as const)),
    })
    for (const id of samples) {
      const result = await dispatcher.dispatchRequest({
        id: id as CommandRequest["id"],
        principal: { kind: "operator", subject: "local", projectBinding: null },
        scope: { kind: "project", ref: "p1" },
        source: "cli",
        isTty: false,
      })
      expect(result.ok).toBe(true)
      expect(result.kind).toBe("operator.admin_result")
      expect(isTranscriptLike(result)).toBe(false)
    }
    expect(probe.invocations()).toEqual([])
  })
})
