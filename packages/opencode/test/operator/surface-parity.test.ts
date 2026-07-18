/**
 * T037 surface parity: palette registration, CLI runner, HTTP, slash/RPC/SDK.
 * Config-backed langlock.status; zero-LLM; confirm cancel.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOperatorPaletteCommands,
  listOperatorPaletteEntries,
  listReservedIds,
  RESERVED_CATALOG,
  resolveScopeForCommandId,
  isOperatorSecretRelatedId,
} from "@opencode-ai/core/operator"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  fixtureStatusHandler,
} from "@/operator/application"
import {
  createSlashInterceptor,
  createSlashConfirmStore,
  createPromptPipelineCounters,
  admitPrompt,
  createHttpOperatorSlashPort,
  createWorkerRpcSlashPort,
  createCliRunner,
  createTuiOperatorSlashPort,
} from "@/operator/adapters"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import { createOperatorClient } from "@opencode-ai/sdk/operator"
import type { WorkerOperatorFetchInput, WorkerOperatorFetchResult } from "@/operator/worker-adapter"
import { createTestOperatorStack } from "@/operator/stack-test"
import { executeOperatorCommand, operatorPaletteCommandRegistrations } from "../../../tui/src/operator/execute"

describe("T037 registry ID parity + palette registration", () => {
  test("palette entries match catalog IDs exactly", () => {
    const palette = listOperatorPaletteEntries()
    const catalogIds = listReservedIds()
    expect(palette.length).toBe(catalogIds.length)
    expect(new Set(palette.map((e) => e.id)).size).toBe(palette.length)
    for (const id of catalogIds) {
      expect(palette.some((e) => e.id === id)).toBe(true)
    }
  })

  test("buildOperatorPaletteCommands / app registration shape", () => {
    const regs = buildOperatorPaletteCommands()
    const appRegs = operatorPaletteCommandRegistrations()
    expect(regs.length).toBe(appRegs.length)
    expect(regs.length).toBe(RESERVED_CATALOG.ids.length)
    for (const r of regs) {
      expect(r.name.startsWith("operator.")).toBe(true)
      if (r.secretRelated) expect(r.enabled).toBe(false)
    }
    // Perf/count: generation is O(n) and stable
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) listOperatorPaletteEntries()
    expect(performance.now() - t0).toBeLessThan(500)
  })

  test("secret mutations not executable; safe auth status is", () => {
    const secrets = listOperatorPaletteEntries().filter((e) => e.secretRelated)
    expect(secrets.every((e) => !e.executable)).toBe(true)
    expect(isOperatorSecretRelatedId("semantic.provider.rotate-secret")).toBe(true)
    expect(isOperatorSecretRelatedId("mcp.auth.start")).toBe(true)
    const authStatus = listOperatorPaletteEntries().find((e) => e.id === "mcp.auth.status")
    expect(authStatus?.secretRelated).toBe(false)
    expect(authStatus?.executable).toBe(true)
  })

  test("scope missing session → forbidden_scope", () => {
    const r = resolveScopeForCommandId("process.cancel", { projectId: "p1" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe("forbidden_scope")
  })
})

describe("T037 langlock.status multi-surface parity (canonical test stack)", () => {
  test("CLI, slash, HTTP, RPC, SDK, TUI execute share id/outcome/version shape", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const base = createTestOperatorStack()
    const { mutationPorts } = base
    // Shared dispatcher with fixture query handler for parity across surfaces
    const dispatcher = createDispatcher({
      registry,
      mutationPorts,
      featureEnabled: true,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const interceptor = createSlashInterceptor({
      registry,
      dispatcher,
      confirmStore: createSlashConfirmStore(),
    })

    // Seed authority so status shows configured version
    await mutationPorts.config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { enabled: true },
      nowMs: Date.now(),
    })

    // Slash
    const slash = await interceptor.tryHandle({
      text: "/op.langlock.status",
      principalContext: { projectId: "proj_parity", subject: "local" },
    })
    expect(slash.handled).toBe(true)
    if (!slash.handled) return
    expect(slash.result.id).toBe("langlock.status")
    expect(slash.result.ok).toBe(true)
    expect(slash.display.injectTranscript).toBe(false)
    const version = slash.result.version
    expect(typeof version === "string" || version === undefined).toBe(true)

    // CLI runner
    const cli = createCliRunner({ registry, dispatcher })
    const cliOut = await cli.run({
      segments: ["langlock", "status"],
      flags: { json: true },
      isTty: false,
      ctx: {
        authenticated: true,
        projectId: "proj_parity",
        subject: "cli",
      },
    })
    expect(cliOut.result.id).toBe("langlock.status")
    expect(cliOut.result.ok).toBe(true)
    expect(cliOut.result.outcome).toBe(slash.result.outcome)

    // HTTP
    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_parity",
      injectProjectScopeWhenOmitted: true,
      resolveAuth: async () => ({
        authenticated: true,
        subject: "local",
        role: "operator",
        projectBinding: "proj_parity",
      }),
    })
    const httpRes = await handle(
      new Request("http://127.0.0.1/operator/v1/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "langlock.status",
          scope: { kind: "project", ref: "proj_parity" },
        }),
      }),
    )
    const httpJson = (await httpRes.json()) as { id: string; outcome: string; ok: boolean; version?: string }
    expect(httpJson.id).toBe("langlock.status")
    expect(httpJson.ok).toBe(true)
    expect(httpJson.outcome === slash.result.outcome).toBe(true)

    // RPC
    const operatorFetch = async (input: WorkerOperatorFetchInput): Promise<WorkerOperatorFetchResult> => {
      const request = new Request(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
      })
      const response = await handle(request)
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      }
    }
    const rpcPort = createWorkerRpcSlashPort({ directory: "/tmp", call: operatorFetch })
    const rpc = await rpcPort.tryHandle({ text: "/op.langlock.status", projectId: "proj_parity" })
    expect(rpc.handled).toBe(true)
    if (!rpc.handled) return
    expect(rpc.display.outcome === slash.result.outcome).toBe(true)

    // SDK
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return handle(request)
    }) as unknown as typeof globalThis.fetch
    const client = createOperatorClient({ baseUrl: "http://127.0.0.1", fetch: fetchImpl })
    const sdk = await client.command({
      id: "langlock.status",
      scope: { kind: "project", ref: "proj_parity" },
    })
    expect(sdk.id).toBe("langlock.status")
    expect(sdk.ok).toBe(true)

    // TUI executeOperatorCommand (pure path, fake dialog confirm never needed for query)
    const tuiPort = createTuiOperatorSlashPort(interceptor, { config: mutationPorts.config })
    const entry = listOperatorPaletteEntries().find((e) => e.id === "langlock.status")
    expect(entry).toBeDefined()
    if (!entry) return
    const dialog = {
      clear: () => {},
      replace: () => {},
    } as never
    const toasts: string[] = []
    const tuiResult = await executeOperatorCommand({
      entry,
      port: tuiPort,
      projectId: "proj_parity",
      dialog,
      toast: {
        show: (o: { message: string }) => {
          toasts.push(o.message)
        },
      },
    })
    expect(tuiResult.outcome === slash.result.outcome).toBe(true)
    expect(toasts.length).toBeGreaterThan(0)
  })

  test("zero LLM hooks for palette/settings operator path", async () => {
    const stack = createTestOperatorStack()
    const { counters, hooks } = createPromptPipelineCounters()
    const admitted = await admitPrompt({
      text: "/op.langlock.status",
      interceptor: stack.interceptor,
      principalContext: { projectId: "p1" },
      hooks,
    })
    expect(admitted.path).toBe("operator")
    expect(counters.llm).toBe(0)
    expect(counters.messageCreate).toBe(0)
    expect(counters.tokenAccount).toBe(0)
    expect(counters.customCommand).toBe(0)
  })

  test("confirm cancel leaves no mutation", async () => {
    const stack = createTestOperatorStack()
    const first = await stack.interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "p1" },
    })
    expect(first.handled).toBe(true)
    if (!first.handled || !first.needsConfirmation) return
    stack.interceptor.cancelConfirmation(first.needsConfirmation.token)
    expect(stack.interceptor.confirmStore.size()).toBe(0)
    const after = await stack.mutationPorts.config.get("semantic")
    expect(after).toBeNull()
  })

  test("preflight returns currentVersion for configured authority", async () => {
    const stack = createTestOperatorStack()
    await stack.mutationPorts.config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { x: 1 },
      nowMs: Date.now(),
    })
    const port = createTuiOperatorSlashPort(stack.interceptor, { config: stack.mutationPorts.config })
    expect(port.preflightMutation).toBeDefined()
    const pre = await port.preflightMutation!({
      commandId: "langlock.set",
      projectId: "p1",
    })
    expect(pre.ok).toBe(true)
    if (!pre.ok) return
    expect(pre.configured).toBe(true)
    expect(typeof pre.currentVersion).toBe("string")
  })
})

describe("T037 live worker boot", () => {
  const runLive = process.env["OPENCODE_OPERATOR_LIVE_BOOT"] === "1"

  test.skipIf(!runLive)("handleWorkerOperatorFetch health hard-pass under live boot flag", async () => {
    const { handleWorkerOperatorFetch } = await import("@/operator/worker-adapter")
    const path = await import("path")
    const fs = await import("fs/promises")
    const os = await import("os")
    const dir = path.join(os.tmpdir(), "op-live-" + process.pid)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "opencode.json"), "{}")
    process.env["OPENCODE_DEV_OPERATOR_"] = "1"
    try {
      const result = await handleWorkerOperatorFetch({
        directory: dir,
        projectId: "proj_live",
        url: "http://127.0.0.1/operator/v1/health",
        method: "GET",
      })
      expect(result.status).toBe(200)
      const body = JSON.parse(result.body) as { ok: boolean }
      expect(body.ok).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
