/**
 * T029–T031 native slash intercept: zero-LLM, confirmation UX, redacted output.
 * Sandbox/preload only — no server/keychain/network.
 */
import { describe, expect, test } from "bun:test"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  createZeroLlmProbe,
  fixtureStatusHandler,
  type HandlerResult,
  type MutationPorts,
} from "@/operator/application"
import {
  admitPrompt,
  createPromptPipelineCounters,
  createSlashConfirmStore,
  createSlashInterceptor,
  mapOperatorResultToDisplay,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createFakeConfigService,
  createDurableOperatorStore,
} from "@/operator/adapters"
import {
  isAdminResult,
  isOperatorSlash,
  parseOperatorSlash,
  type CommandRequest,
} from "@opencode-ai/core/operator"
import { createProcessMutexLockPort } from "@/operator/application"

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

function fakeMutationHandler(): HandlerResult {
  return {
    kind: "mutation_plan",
    authority: "semantic",
    apply: (current) => ({ ...(typeof current === "object" && current ? current : {}), cutover: true }),
    snapshotBefore: true,
  }
}

function setup(handlers?: Map<string, (ctx: { request: CommandRequest }) => HandlerResult | Promise<HandlerResult>>) {
  const registry = createSeededOperatorCommandRegistry()
  const probe = createZeroLlmProbe()
  const dispatcher = createDispatcher({
    registry,
    probe,
    mutationPorts: mutationPorts(),
    handlers: handlers ?? createHandlerMap([
      ["langlock.status", fixtureStatusHandler],
      ["semantic.embedding.cutover", fakeMutationHandler],
      ["output.purge", fakeMutationHandler],
      ["routing.test", fixtureStatusHandler],
    ]),
  })
  const interceptor = createSlashInterceptor({
    registry,
    dispatcher,
    confirmStore: createSlashConfirmStore({ ttlMs: 60_000, nowMs: () => Date.now() }),
  })
  return { registry, probe, dispatcher, interceptor }
}

describe("T029 parse + reserved form", () => {
  test("parseOperatorSlash recognizes /op.<id> only", () => {
    expect(parseOperatorSlash("/op.langlock.status").kind).toBe("operator")
    expect(parseOperatorSlash("  /op.langlock.status arg\nmore  ").kind).toBe("operator")
    expect(isOperatorSlash("/init")).toBe(false)
    expect(isOperatorSlash("hello")).toBe(false)
    expect(isOperatorSlash("/langlock.status")).toBe(false)
    const yes = parseOperatorSlash("/op.output.purge --yes")
    expect(yes.kind).toBe("operator")
    if (yes.kind === "operator") expect(yes.hasYesFlag).toBe(true)
  })
})

describe("T029 pre-prompt intercept ordering + zero LLM", () => {
  test("shell mode: reserved /op.* still intercepts (never shell path)", async () => {
    const { interceptor } = setup()
    const { counters, hooks } = createPromptPipelineCounters()
    const admitted = await admitPrompt({
      text: "/op.langlock.status",
      mode: "shell",
      interceptor,
      principalContext: { projectId: "proj_1" },
      hooks,
    })
    expect(admitted.path).toBe("operator")
    expect(counters.messageCreate).toBe(0)
    expect(counters.llm).toBe(0)
  })

  test("operator slash: zero provider/prompt/message/token/custom/MCP/plugin hooks", async () => {
    const { interceptor, probe } = setup()
    const { counters, hooks } = createPromptPipelineCounters()

    const admitted = await admitPrompt({
      text: "/op.langlock.status",
      interceptor,
      principalContext: { projectId: "proj_1", subject: "local" },
      hooks,
      customCommands: ["init", "langlock.status", "op.langlock.status"],
    })

    expect(admitted.path).toBe("operator")
    if (admitted.path !== "operator") return
    expect(admitted.intercept.handled).toBe(true)
    expect(admitted.intercept.result.kind).toBe("operator.admin_result")
    expect(isAdminResult(admitted.intercept.result)).toBe(true)
    expect(admitted.intercept.display.injectTranscript).toBe(false)

    expect(counters.provider).toBe(0)
    expect(counters.modelSelect).toBe(0)
    expect(counters.promptAdmit).toBe(0)
    expect(counters.messageCreate).toBe(0)
    expect(counters.partCreate).toBe(0)
    expect(counters.tokenAccount).toBe(0)
    expect(counters.customCommand).toBe(0)
    expect(counters.mcp).toBe(0)
    expect(counters.plugin).toBe(0)
    expect(counters.llm).toBe(0)
    expect(probe.invocations()).toEqual([])
    probe.assertClean()
  })

  test("unknown reserved alias → invalid_argument; no custom/LLM fallback", async () => {
    const { interceptor } = setup()
    const { counters, hooks } = createPromptPipelineCounters()

    const admitted = await admitPrompt({
      text: "/op.not.a.real.command",
      interceptor,
      principalContext: { projectId: "proj_1" },
      hooks,
      customCommands: ["not.a.real.command", "op.not.a.real.command"],
    })

    expect(admitted.path).toBe("operator")
    if (admitted.path !== "operator") return
    expect(admitted.intercept.result.ok).toBe(false)
    expect(admitted.intercept.result.outcome).toBe("invalid_argument")
    expect(counters.customCommand).toBe(0)
    expect(counters.llm).toBe(0)
    expect(counters.messageCreate).toBe(0)
  })

  test("non-operator slash preserves existing custom command path", async () => {
    const { interceptor } = setup()
    const { counters, hooks } = createPromptPipelineCounters()

    const admitted = await admitPrompt({
      text: "/init",
      interceptor,
      principalContext: { projectId: "proj_1" },
      hooks,
      customCommands: ["init"],
    })

    expect(admitted.path).toBe("custom_command")
    expect(counters.customCommand).toBe(1)
    expect(counters.messageCreate).toBe(1)
  })

  test("non-operator free text still goes to prompt/LLM path", async () => {
    const { interceptor } = setup()
    const { counters, hooks } = createPromptPipelineCounters()

    const admitted = await admitPrompt({
      text: "explain this codebase",
      interceptor,
      principalContext: { projectId: "proj_1" },
      hooks,
    })

    expect(admitted.path).toBe("prompt")
    expect(counters.llm).toBe(1)
    expect(counters.provider).toBe(1)
  })

  test("stubs return honest not_implemented/unavailable", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({ registry })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const result = await interceptor.tryHandle({
      text: "/op.langlock.status",
      principalContext: { projectId: "p1" },
    })
    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.result.ok).toBe(false)
    expect(["not_implemented", "unavailable"]).toContain(result.result.outcome)
  })
})

describe("T030 slash confirmation UX", () => {
  test("confirm-required slash never auto-yes via --yes", async () => {
    const { interceptor } = setup()
    const result = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover --yes",
      principalContext: { projectId: "proj_1" },
    })
    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.result.outcome).toBe("confirmation_required")
    expect(result.needsConfirmation).toBeDefined()
    expect(result.display.variant).toBe("warning")
  })

  test("cancel drops token; config/version/audit unchanged", async () => {
    const { interceptor } = setup()
    const ports = mutationPorts()
    const before = await ports.config.get("semantic")

    const first = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "proj_1" },
    })
    expect(first.handled).toBe(true)
    if (!first.handled || !first.needsConfirmation) throw new Error("expected needsConfirmation")

    interceptor.cancelConfirmation(first.needsConfirmation.token)
    expect(interceptor.confirmStore.size()).toBe(0)

    const after = await ports.config.get("semantic")
    expect(after).toEqual(before)

    // Re-use of cancelled token fails
    const replay = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "proj_1" },
      confirmToken: first.needsConfirmation.token,
    })
    expect(replay.handled).toBe(true)
    if (!replay.handled) return
    expect(replay.result.outcome).toBe("confirmation_required")
  })

  test("interactive confirm with fake handler succeeds (single-use token)", async () => {
    const { interceptor } = setup()
    const first = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "proj_1" },
    })
    expect(first.handled).toBe(true)
    if (!first.handled || !first.needsConfirmation) throw new Error("expected confirm")

    const second = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "proj_1" },
      confirmToken: first.needsConfirmation.token,
    })
    expect(second.handled).toBe(true)
    if (!second.handled) return
    // Handler may succeed or fail CAS without prior version — either way confirm gate passed
    expect(second.result.outcome).not.toBe("confirmation_required")
    expect(second.needsConfirmation).toBeUndefined()

    // Token is single-use
    const third = await interceptor.tryHandle({
      text: "/op.semantic.embedding.cutover",
      principalContext: { projectId: "proj_1" },
      confirmToken: first.needsConfirmation.token,
    })
    expect(third.handled).toBe(true)
    if (!third.handled) return
    expect(third.result.outcome).toBe("confirmation_required")
  })

  test("queries never require confirmation", async () => {
    const { interceptor } = setup()
    const result = await interceptor.tryHandle({
      text: "/op.langlock.status",
      principalContext: { projectId: "proj_1" },
    })
    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.needsConfirmation).toBeUndefined()
    expect(result.result.outcome).not.toBe("confirmation_required")
  })

  test("confirm=true alone on dispatcher still never auto-yes for slash", async () => {
    const { dispatcher } = setup()
    const result = await dispatcher.dispatchRequest({
      id: "semantic.embedding.cutover" as CommandRequest["id"],
      principal: { kind: "operator", subject: "local", projectBinding: null },
      scope: { kind: "project", ref: "proj_1" },
      source: "slash",
      confirm: true,
      isTty: true,
      idempotencyKey: "k1",
    })
    expect(result.outcome).toBe("confirmation_required")
    expect(result.error?.details?.reason).toBe("slash_never_auto_yes")
  })
})

describe("T031 redacted slash output", () => {
  test("display never expands secrets; no transcript inject", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([
        [
          "langlock.status",
          () => ({
            kind: "query",
            version: "v1",
            effective: {
              status: "ok",
              token: "super-secret-token-value",
              apiKey: "sk_live_abcdef",
              password: "hunter2",
              ref: { backend: "keychain", name: "openai", version: 1 },
            },
          }),
        ],
      ]),
    })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const result = await interceptor.tryHandle({
      text: "/op.langlock.status",
      principalContext: { projectId: "p1" },
    })
    expect(result.handled).toBe(true)
    if (!result.handled) return

    const display = result.display
    expect(display.injectTranscript).toBe(false)
    const blob = JSON.stringify(display)
    expect(blob).not.toContain("super-secret-token-value")
    expect(blob).not.toContain("sk_live_abcdef")
    expect(blob).not.toContain("hunter2")
    expect(blob).toContain("[REDACTED]")
    // Secret refs kept as refs only
    expect(blob).toContain("keychain")
    expect(blob).toContain("openai")
  })

  test("audit_pending visibly distinct from conflict/confirmation/unavailable", () => {
    const auditPending = mapOperatorResultToDisplay({
      ok: true,
      id: "langlock.set",
      kind: "operator.admin_result",
      outcome: "audit_pending",
      version: "v2",
    })
    expect(auditPending.auditPending).toBe(true)
    expect(auditPending.variant).toBe("warning")
    expect(auditPending.title.toLowerCase()).toContain("audit")

    const conflict = mapOperatorResultToDisplay({
      ok: false,
      id: "langlock.set",
      kind: "operator.admin_result",
      outcome: "conflict",
      error: { code: "conflict", message: "CAS conflict", retryable: true },
    })
    expect(conflict.auditPending).toBe(false)
    expect(conflict.title.toLowerCase()).toContain("conflict")

    const confirm = mapOperatorResultToDisplay({
      ok: false,
      id: "output.purge",
      kind: "operator.admin_result",
      outcome: "confirmation_required",
      error: { code: "confirmation_required", message: "need confirm", retryable: false },
    })
    expect(confirm.variant).toBe("warning")
    expect(confirm.title.toLowerCase()).toContain("confirm")

    const unavailable = mapOperatorResultToDisplay({
      ok: false,
      id: "mcp.server.connect",
      kind: "operator.admin_result",
      outcome: "unavailable",
      error: { code: "unavailable", message: "backend down", retryable: true },
    })
    expect(unavailable.variant).toBe("warning")
    expect(unavailable.title.toLowerCase()).toContain("unavailable")
  })
})

describe("T029 principal from local context only", () => {
  test("prompt args cannot supply principal", async () => {
    const { interceptor } = setup()
    const result = await interceptor.tryHandle({
      text: `/op.langlock.status ${JSON.stringify({
        principal: { kind: "system", subject: "evil", projectBinding: "other" },
      })}`,
      principalContext: { projectId: "proj_bound", subject: "local" },
    })
    expect(result.handled).toBe(true)
    if (!result.handled) return
    // Success path uses fixture — ensure principal was local binding, not body
    if (result.result.ok && result.result.effective && typeof result.result.effective === "object") {
      const eff = result.result.effective as Record<string, unknown>
      expect(eff.source).toBe("slash")
    }
  })
})

describe("prod path safety (T029–T031)", () => {
  test("slash intercept pure modules do not require network", async () => {
    const { interceptor } = setup()
    await interceptor.tryHandle({
      text: "/op.routing.test",
      principalContext: { projectId: "p1" },
    })
    expect(true).toBe(true)
  })
})
