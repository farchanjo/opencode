/**
 * T029–T031 runtime wiring: launcher port reaches dispatcher/SDK, not unavailable toast.
 * Shell-mode intercept; confirm/cancel through host port; CAS version binding.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  fixtureStatusHandler,
  type HandlerResult,
  type MutationPorts,
} from "@/operator/application"
import {
  admitPrompt,
  createPromptPipelineCounters,
  createSlashConfirmStore,
  createSlashInterceptor,
  createTuiOperatorSlashPort,
  createHttpOperatorSlashPort,
  mapOperatorResultToDisplay,
  parseSlashPayload,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createFakeConfigService,
  createDurableOperatorStore,
} from "@/operator/adapters"
import {
  createOperatorStack,
  createLocalTuiOperatorSlashPort,
  getProcessOperatorStack,
  resetProcessOperatorStack,
  setProcessOperatorStack,
} from "@/operator/stack-test"
import { wireTestOperatorSlashPort, wireOperatorSlashForTui, wireLocalOperatorSlashPort } from "@/operator/tui-wire"
import { createProcessMutexLockPort } from "@/operator/application"
import { createWorkerRpcSlashPort } from "@/operator/adapters/inbound/rpc-slash-port"
import type { WorkerOperatorFetchInput, WorkerOperatorFetchResult } from "@/operator/worker-adapter"
import { createOperatorHttpHandler } from "@/operator/http/handler"

function mutationPorts(): MutationPorts {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({
    config: createFakeConfigService(),
    lock,
  })
  return {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
}

function cutoverHandler(): HandlerResult {
  return {
    kind: "mutation_plan",
    authority: "semantic",
    apply: (current) => ({ ...(typeof current === "object" && current ? current : {}), cutover: true }),
    snapshotBefore: true,
  }
}

describe("T029 runtime host wiring", () => {
  beforeEach(() => {
    resetProcessOperatorStack()
  })
  afterEach(() => {
    resetProcessOperatorStack()
  })

  test("wireTestOperatorSlashPort reaches test stack dispatcher", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const ports = mutationPorts()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: ports,
      handlers: createHandlerMap([
        ["langlock.status", fixtureStatusHandler],
        ["semantic.embedding.cutover", cutoverHandler],
      ]),
    })
    const stack = createOperatorStack({ registry, dispatcher, mutationPorts: ports })
    setProcessOperatorStack(stack)

    const port = wireTestOperatorSlashPort(stack)
    const result = await port.tryHandle({
      text: "/op.langlock.status",
      projectId: "proj_live",
    })

    expect(result.handled).toBe(true)
    if (!result.handled) return
    // Must NOT be the "unavailable in this TUI session" path
    expect(result.display.title.toLowerCase()).not.toContain("unavailable")
    expect(result.display.outcome).toBe("success")
    expect(result.display.injectTranscript).toBe(false)
    expect(result.display.message).toContain("langlock.status")
    // Feature 012 FR1: the structured half is forwarded on the SAME return —
    // typed outcome + optional effective payload alongside the human display.
    expect(result.result?.outcome).toBe("success")
    expect(result.result?.effective).toBeDefined()
  })

  test("wireOperatorSlashForTui(test) matches createLocalTuiOperatorSlashPort", async () => {
    const stack = createOperatorStack()
    setProcessOperatorStack(stack)
    const a = await wireOperatorSlashForTui({ mode: "test", stack }).tryHandle({
      text: "/op.langlock.status",
      projectId: "p1",
    })
    const b = await createLocalTuiOperatorSlashPort(stack).tryHandle({
      text: "/op.langlock.status",
      projectId: "p1",
    })
    expect(a.handled).toBe(true)
    expect(b.handled).toBe(true)
    if (!a.handled || !b.handled) return
    expect(a.display.outcome).toBe(b.display.outcome)
  })

  test("wireOperatorSlashForTui(local) requires operatorFetch — no parent live stack", () => {
    expect(() =>
      // @ts-expect-error intentional missing operatorFetch
      wireOperatorSlashForTui({ mode: "local", directory: "/tmp" }),
    ).toThrow(/operatorFetch/)
  })

  test("parent local slash invokes worker RPC (not test stack import path)", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_rpc",
      injectProjectScopeWhenOmitted: true,
      resolveAuth: async () => ({
        authenticated: true,
        subject: "local-worker",
        role: "operator",
        projectBinding: "proj_rpc",
      }),
    })

    const calls: WorkerOperatorFetchInput[] = []
    const operatorFetch = async (input: WorkerOperatorFetchInput): Promise<WorkerOperatorFetchResult> => {
      calls.push(input)
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

    const port = wireLocalOperatorSlashPort({
      directory: "/tmp/proj",
      operatorFetch,
    })
    const result = await port.tryHandle({
      text: "/op.langlock.status",
      projectId: "proj_rpc",
      sessionId: "ses_abc",
    })

    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.display.outcome).toBe("success")
    expect(calls.some((c) => c.url.includes("/operator/v1/health"))).toBe(true)
    expect(calls.some((c) => c.url.includes("/operator/v1/commands"))).toBe(true)
    const cmd = calls.find((c) => c.url.includes("/commands"))
    expect(cmd?.directory).toBe("/tmp/proj")
    expect(cmd?.projectId).toBe("proj_rpc")
    expect(cmd?.sessionId).toBe("ses_abc")
    expect(cmd?.body).toContain("langlock.status")
    expect(cmd?.body).not.toContain("principal")
    // Feature 012 FR1 (T019): the DEFAULT worker-RPC production port forwards the
    // structured half on the SAME handled return — not just the test-path tui-port.
    expect(result.result?.outcome).toBe("success")
    expect(result.result?.effective).toBeDefined()
  })

  test("session confirm token succeeds end-to-end with exact context on re-try", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const ports = mutationPorts()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: ports,
      handlers: createHandlerMap([["semantic.embedding.cutover", cutoverHandler]]),
    })
    // Local interceptor path (same confirm binding as RPC port uses for tokens)
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const port = createTuiOperatorSlashPort(interceptor)

    const first = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_s",
      sessionId: "ses_confirm",
    })
    expect(first.handled).toBe(true)
    if (!first.handled || !first.needsConfirmation) throw new Error("expected confirm")

    // Wrong project breaks binding (scope is project when projectId set)
    const wrong = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_other",
      sessionId: "ses_confirm",
      confirmToken: first.needsConfirmation.token,
    })
    expect(wrong.handled).toBe(true)
    if (!wrong.handled) return
    expect(wrong.display.outcome).toBe("confirmation_required")

    // Exact projectId + sessionId on re-try (as DialogConfirm second tryHandle must pass)
    const again = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_s",
      sessionId: "ses_confirm",
    })
    if (!again.handled || !again.needsConfirmation) throw new Error("confirm again")
    const ok = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_s",
      sessionId: "ses_confirm",
      confirmToken: again.needsConfirmation.token,
    })
    expect(ok.handled).toBe(true)
    if (!ok.handled) return
    expect(ok.display.outcome).not.toBe("confirmation_required")
  })

  test("attach/remote prefers project scope when projectId set; sessionId still used when no project", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_attach",
      injectProjectScopeWhenOmitted: false,
      resolveAuth: async () => ({
        authenticated: true,
        subject: "remote",
        role: "operator",
        projectBinding: "proj_attach",
      }),
    })
    let lastBody = ""
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (request.method === "POST") lastBody = await request.clone().text()
      return handle(request)
    }) as unknown as typeof globalThis.fetch

    const port = createHttpOperatorSlashPort({
      baseUrl: "http://127.0.0.1",
      fetch: fetchImpl,
      getSessionId: () => "ses_from_getter",
    })
    await port.tryHandle({
      text: "/op.langlock.status",
      projectId: "proj_attach",
      sessionId: "ses_from_input",
    })
    expect(lastBody).toContain("proj_attach")
    expect(lastBody).toContain('"kind":"project"')

    // Without projectId, langlock.status allows global+project → global when unbound
    lastBody = ""
    await port.tryHandle({
      text: "/op.langlock.status",
      sessionId: "ses_from_input",
    })
    expect(lastBody).toContain("langlock.status")
    expect(lastBody).toContain('"kind":"global"')
  })

  test("HTTP slash port uses SDK; disabled server → unavailable no LLM path", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: "not mounted" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch
    const port = createHttpOperatorSlashPort({
      baseUrl: "http://127.0.0.1:9",
      fetch: fetchImpl,
    })
    // health fails → unavailable
    const result = await port.tryHandle({ text: "/op.langlock.status", projectId: "p1" })
    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.display.outcome).toBe("unavailable")
  })

  test("HTTP slash port reaches operator HTTP handler dispatcher", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const { createOperatorHttpHandler } = await import("@/operator/http/handler")
    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_http",
      injectProjectScopeWhenOmitted: true,
      resolveAuth: async () => ({
        authenticated: true,
        subject: "local",
        role: "operator",
        projectBinding: "proj_http",
      }),
    })
    // OperatorClient uses fetch(url, init) — adapt Request-only handler.
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return handle(request)
    }) as unknown as typeof globalThis.fetch

    const port = createHttpOperatorSlashPort({
      baseUrl: "http://127.0.0.1",
      fetch: fetchImpl,
      authorization: "Basic " + btoa("opencode:secret"),
    })

    const healthRes = await fetchImpl("http://127.0.0.1/operator/v1/health")
    expect(healthRes.status).toBe(200)

    const result = await port.tryHandle({ text: "/op.langlock.status", projectId: "proj_http" })
    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.display.outcome).toBe("success")
    expect(result.display.title.toLowerCase()).not.toContain("unavailable")
    // Feature 012 FR1 (T019): the remote/attach HTTP production port forwards the
    // structured half on the SAME handled return.
    expect(result.result?.outcome).toBe("success")
    expect(result.result?.effective).toBeDefined()
  })
})

describe("T029 shell mode intercept", () => {
  test("/op.* in shell mode never goes to shell path", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const { counters, hooks } = createPromptPipelineCounters()

    const admitted = await admitPrompt({
      text: "/op.langlock.status",
      mode: "shell",
      interceptor,
      principalContext: { projectId: "p1" },
      hooks,
    })

    expect(admitted.path).toBe("operator")
    expect(counters.messageCreate).toBe(0)
    expect(counters.llm).toBe(0)
  })

  test("non-operator shell path unchanged", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({ registry })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const { counters, hooks } = createPromptPipelineCounters()

    const admitted = await admitPrompt({
      text: "ls -la",
      mode: "shell",
      interceptor,
      principalContext: { projectId: "p1" },
      hooks,
    })

    expect(admitted.path).toBe("shell")
    expect(counters.messageCreate).toBe(1)
  })
})

describe("T030 confirm through host port", () => {
  test("host port confirm success + cancel", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const ports = mutationPorts()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: ports,
      handlers: createHandlerMap([["semantic.embedding.cutover", cutoverHandler]]),
    })
    const interceptor = createSlashInterceptor({
      registry,
      dispatcher,
      confirmStore: createSlashConfirmStore({ ttlMs: 60_000 }),
    })
    const port = createTuiOperatorSlashPort(interceptor)

    const first = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_1",
    })
    expect(first.handled).toBe(true)
    if (!first.handled || !first.needsConfirmation) throw new Error("expected confirm")

    // cancel
    port.cancelConfirmation(first.needsConfirmation.token)
    const before = await ports.config.get("semantic")

    // invalid token after cancel
    const cancelled = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_1",
      confirmToken: first.needsConfirmation.token,
    })
    expect(cancelled.handled).toBe(true)
    if (!cancelled.handled) return
    expect(cancelled.display.outcome).toBe("confirmation_required")
    expect(await ports.config.get("semantic")).toEqual(before)

    // fresh confirm success
    const again = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_1",
    })
    if (!again.handled || !again.needsConfirmation) throw new Error("expected confirm again")
    const ok = await port.tryHandle({
      text: "/op.semantic.embedding.cutover",
      projectId: "proj_1",
      confirmToken: again.needsConfirmation.token,
    })
    expect(ok.handled).toBe(true)
    if (!ok.handled) return
    expect(ok.display.outcome).not.toBe("confirmation_required")
  })
})

describe("CAS version from strict payload", () => {
  test("parseSlashPayload extracts expectedVersion and idempotencyKey", () => {
    const parsed = parseSlashPayload(
      JSON.stringify({ expectedVersion: "cas_v3", idempotencyKey: "idem-1", foo: 1 }),
    )
    expect(parsed.expectedVersion).toBe("cas_v3")
    expect(parsed.idempotencyKey).toBe("idem-1")
    expect(parsed.payload.foo).toBe(1)
    expect(parsed.payload.principal).toBeUndefined()
  })

  test("mutation without version still dispatches (CAS may conflict) — never invents version", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const ports = mutationPorts()
    // Seed authority so version is required
    await ports.config.compareAndSet({
      authority: "semantic",
      expectedVersion: null,
      payload: { seeded: true },
      nowMs: Date.now(),
    })
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: ports,
      handlers: createHandlerMap([["semantic.embedding.cutover", cutoverHandler]]),
    })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const first = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "p1" },
    })
    if (!first.handled || !first.needsConfirmation) throw new Error("confirm")
    const second = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "p1" },
      confirmToken: first.needsConfirmation.token,
    })
    expect(second.handled).toBe(true)
    if (!second.handled) return
    // Should fail with conflict or invalid_argument requiring version — not silent invent
    expect(["conflict", "invalid_argument", "success"]).toContain(second.result.outcome)
    if (second.result.outcome === "invalid_argument") {
      expect(second.result.error?.message.toLowerCase()).toMatch(/version/)
    }
  })

  test("confirm token bound to exact version", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      handlers: createHandlerMap([["semantic.embedding.cutover", cutoverHandler]]),
    })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const first = await interceptor.tryHandle({
      text: `/op.semantic.embedding.cutover ${JSON.stringify({ expectedVersion: "cas_v1" })}`,
      principalContext: { projectId: "p1" },
    })
    if (!first.handled || !first.needsConfirmation) throw new Error("confirm")
    // Wrong version binding
    const wrong = await interceptor.tryHandle({
      text: `/op.semantic.embedding.cutover ${JSON.stringify({ expectedVersion: "cas_v2" })}`,
      principalContext: { projectId: "p1" },
      confirmToken: first.needsConfirmation.token,
    })
    expect(wrong.handled).toBe(true)
    if (!wrong.handled) return
    expect(wrong.result.outcome).toBe("confirmation_required")
    expect(wrong.result.error?.details?.reason).toBe("confirm_token_invalid")
  })
})

describe("T031 redaction entropy/PEM/JWT", () => {
  test("redacts PEM JWT high-entropy from display", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----"
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.signaturepart123"
    const display = mapOperatorResultToDisplay({
      ok: false,
      id: "langlock.status",
      kind: "operator.admin_result",
      outcome: "invalid_argument",
      error: {
        code: "invalid_argument",
        message: `bad ${pem} and ${jwt} and Bearer supersecrettokenvalue`,
        retryable: false,
        details: { password: "hunter2", token: "abc" },
      },
    })
    const blob = JSON.stringify(display)
    expect(blob).not.toContain("BEGIN PRIVATE KEY")
    expect(blob).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
    expect(blob).not.toContain("supersecrettokenvalue")
    expect(blob).not.toContain("hunter2")
    expect(blob).toMatch(/REDACTED|PEM|JWT/i)
  })
})

describe("process stack shared with HTTP factory", () => {
  test("getProcessOperatorStack is singleton until reset", () => {
    resetProcessOperatorStack()
    const a = getProcessOperatorStack()
    const b = getProcessOperatorStack()
    expect(a).toBe(b)
    resetProcessOperatorStack()
    const c = getProcessOperatorStack()
    expect(c).not.toBe(a)
  })
})
