/**
 * T032–T034 native CLI operator: parse, output/exit codes, confirmation matrix.
 * Unit + injected-handler mutation contract. No LLM. Prod paths untouched.
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
  createCliRunner,
  evaluateCliYesPolicy,
  resolveCliCommandId,
  resolveCliScope,
  parseCliPayload,
  parseCliInvocation,
  normalizeExpectedVersion,
  isBoundedCliJson,
  assertPayloadByteLimit,
  readBoundedPayloadSource,
  CLI_MAX_PAYLOAD_BYTES,
  formatOperatorCli,
  formatPreRunnerInvalidArgument,
  exitCodeForResult,
  redactCommandResult,
  CLI_EXIT_BY_OUTCOME,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createFakeConfigService,
  createDurableOperatorStore,
} from "@/operator/adapters"
import { createProcessMutexLockPort } from "@/operator/application"
import type { CommandResult } from "@opencode-ai/core/operator"
import { isAdminResult } from "@opencode-ai/core/operator"
import { isOperatorDevSandbox, ENV_DEV_OPERATOR } from "@/operator/dev-env"
import { selectKeychainBackend } from "@/operator/adapters/outbound/keychain-backend"

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

function mutationPlanHandler(): HandlerResult {
  return {
    kind: "mutation_plan",
    authority: "test.cli",
    apply: () => ({ applied: true }),
    snapshotBefore: true,
  }
}

function principalCtx(overrides?: Partial<{ projectId: string | null; authenticated: boolean; sessionId: string }>) {
  return {
    projectId: overrides?.projectId ?? "proj_local",
    subject: "local",
    authenticated: overrides?.authenticated ?? true,
    sessionId: overrides?.sessionId ?? null,
    rootTreeRef: null as string | null,
  }
}

describe("T032 CLI command parse + registry", () => {
  test("space-separated domain op resolves via registry", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["langlock", "status"], registry)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe("langlock.status")
  })

  test("dotted id form resolves", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["semantic.embedding.cutover"], registry)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe("semantic.embedding.cutover")
  })

  test("multi-segment qualifiers", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["semantic", "embedding", "cutover"], registry)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.id).toBe("semantic.embedding.cutover")
  })

  test("unknown reserved id → invalid_argument shape", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = resolveCliCommandId(["nope", "missing"], registry)
    expect(r.ok).toBe(false)
  })

  test("descriptor-aware scope: session-only prefers session when provided", () => {
    const registry = createSeededOperatorCommandRegistry()
    // Find a session-scoped command if any; else use project command with session flag denied.
    const sessionCmd = registry.list().find((d) => d.scopesAllowed.includes("session") && !d.scopesAllowed.includes("project"))
    if (sessionCmd) {
      const scope = resolveCliScope({
        descriptor: sessionCmd,
        ctx: principalCtx({ sessionId: "ses_1" }),
        flags: {},
      })
      expect(scope.ok).toBe(true)
      if (scope.ok) {
        expect(scope.scope.kind).toBe("session")
        expect(scope.scope.ref).toBe("ses_1")
      }
    } else {
      // Most reserved cmds allow project; ensure project preference when session not allowed
      const d = registry.lookup("langlock.status")!
      const scope = resolveCliScope({
        descriptor: d,
        ctx: principalCtx({ sessionId: "ses_1", projectId: "proj_a" }),
        flags: {},
      })
      expect(scope.ok).toBe(true)
      if (scope.ok) {
        // session not in scopes → project
        if (!d.scopesAllowed.includes("session")) {
          expect(scope.scope.kind).not.toBe("session")
        }
      }
    }
  })

  test("cross-project scope denied when cwd project differs", () => {
    const registry = createSeededOperatorCommandRegistry()
    const d = registry.lookup("langlock.status")!
    if (!d.scopesAllowed.includes("project")) return
    const scope = resolveCliScope({
      descriptor: d,
      ctx: principalCtx({ projectId: "proj_a" }),
      flags: { project: "proj_other" },
    })
    expect(scope.ok).toBe(false)
  })

  test("parse invocation rejects mutation without idempotency/version", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = parseCliInvocation({
      segments: ["output", "purge"],
      flags: {},
      registry,
      ctx: principalCtx(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.result.outcome).toBe("invalid_argument")
    }
  })

  test("strict JSON payload strips principal/scope/confirm", () => {
    const r = parseCliPayload(
      JSON.stringify({
        principal: { kind: "system" },
        confirm: true,
        scope: { kind: "global" },
        foo: 1,
        expectedVersion: "v1",
        idempotencyKey: "k1",
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.principal).toBeUndefined()
      expect(r.payload.confirm).toBeUndefined()
      expect(r.payload.scope).toBeUndefined()
      expect(r.payload.foo).toBe(1)
      expect(r.expectedVersion).toBe("v1")
      expect(r.idempotencyKey).toBe("k1")
    }
  })

  test("create sentinel --expected-version=- and null/none omit CAS token", () => {
    expect(normalizeExpectedVersion("-")).toBeUndefined()
    expect(normalizeExpectedVersion("null")).toBeUndefined()
    expect(normalizeExpectedVersion("none")).toBeUndefined()
    expect(normalizeExpectedVersion("cas_v1")).toBe("cas_v1")
    const registry = createSeededOperatorCommandRegistry()
    const r = parseCliInvocation({
      segments: ["output", "purge"],
      flags: { expectedVersion: "-", idempotencyKey: "k-create", yes: true },
      registry,
      ctx: principalCtx(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.version).toBeUndefined()
      expect(r.idempotencyKey).toBe("k-create")
    }
  })

  test("payload byte limit rejects oversized before deep parse", () => {
    const over = "x".repeat(CLI_MAX_PAYLOAD_BYTES + 1)
    expect(assertPayloadByteLimit(over).ok).toBe(false)
    const r = parseCliPayload(over)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("exceeds")
  })

  test("pre-runner bound failure uses operator invalid_argument envelope (json exit 40)", () => {
    const rendered = formatPreRunnerInvalidArgument({
      id: "langlock.status",
      message: `payload exceeds ${CLI_MAX_PAYLOAD_BYTES} bytes`,
      mode: "json",
    })
    expect(rendered.exitCode).toBe(40)
    const envelope = JSON.parse(rendered.stdout)
    expect(envelope.kind).toBe("operator.admin_result")
    expect(envelope.ok).toBe(false)
    expect(envelope.outcome).toBe("invalid_argument")
    expect(envelope.error.code).toBe("invalid_argument")
    expect(envelope.error.message).toContain("exceeds")
    expect(rendered.stdout.includes("Error:")).toBe(false)
    expect(rendered.stdout.includes("at ")).toBe(false)
  })

  test("pre-runner bound failure human mode is deterministic (no stack)", () => {
    const rendered = formatPreRunnerInvalidArgument({
      id: "langlock.status",
      message: `payload exceeds ${CLI_MAX_PAYLOAD_BYTES} bytes`,
      mode: "human",
    })
    expect(rendered.exitCode).toBe(40)
    expect(rendered.stdout).toContain("invalid_argument")
    expect(rendered.stdout).toContain("exceeds")
    expect(rendered.stdout.includes("    at ")).toBe(false)
    expect(rendered.stdout.includes("Error:")).toBe(false)
  })

  test("payload depth bound rejects deep JSON (HTTP parity)", () => {
    let deep: unknown = { v: 1 }
    for (let i = 0; i < 20; i++) deep = { nested: deep }
    expect(isBoundedCliJson(deep)).toBe(false)
    const r = parseCliPayload(JSON.stringify(deep))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("depth")
  })

  test("recursive secret scanner rejects nested plaintext and malformed SecretRef", () => {
    const nested = parseCliPayload(
      JSON.stringify({ outer: { apiKey: "sk_live_nested" } }),
    )
    expect(nested.ok).toBe(false)
    if (!nested.ok) expect(nested.reason).toContain("plaintext secrets")

    const badRef = parseCliPayload(
      JSON.stringify({ token: { backend: "keychain", name: "x", version: 1, extra: true } }),
    )
    expect(badRef.ok).toBe(false)

    const goodRef = parseCliPayload(
      JSON.stringify({ token: { backend: "keychain", name: "x", version: 1 } }),
    )
    expect(goodRef.ok).toBe(true)
  })

  test("readBoundedPayloadSource stats file and rejects oversize", async () => {
    const path = `/tmp/op-cli-payload-${Date.now()}.json`
    await Bun.write(path, "x".repeat(CLI_MAX_PAYLOAD_BYTES + 8))
    const r = await readBoundedPayloadSource({ payloadFile: path })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("exceeds")
    await Bun.file(path).exists() // keep path warm
    const { unlinkSync } = await import("fs")
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  })
})

describe("sandbox keychain env (OPENCODE_DEV_OPERATOR_)", () => {
  test("isOperatorDevSandbox reads canonical env only", () => {
    expect(isOperatorDevSandbox({ [ENV_DEV_OPERATOR]: "1" })).toBe(true)
    expect(isOperatorDevSandbox({ OPENCODE_OPERATOR_SANDBOX: "1" })).toBe(false)
    expect(isOperatorDevSandbox({})).toBe(false)
  })

  test("sandbox marker selects unavailable keychain backend (no real keychain)", async () => {
    const backend = selectKeychainBackend({
      sandbox: isOperatorDevSandbox({ [ENV_DEV_OPERATOR]: "1" }),
      platform: "darwin",
      ffi: {
        addGenericPassword: () => 0,
        findGenericPassword: () => null,
        existsGenericPassword: () => false,
        deleteGenericPassword: () => 0,
      },
    })
    expect(backend.available()).toBe(false)
    await expect(backend.put({ service: "s", account: "a", secret: "x" })).rejects.toThrow(/sandbox/i)
  })

  test("op.ts and worker/http use isOperatorDevSandbox not OPENCODE_OPERATOR_SANDBOX", async () => {
    const files = [
      new URL("../../src/cli/cmd/op.ts", import.meta.url),
      new URL("../../src/operator/worker-adapter.ts", import.meta.url),
      new URL("../../src/operator/http/mount.ts", import.meta.url),
    ]
    for (const url of files) {
      const text = await Bun.file(url).text()
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
      expect(code).toContain("isOperatorDevSandbox")
      expect(code).not.toMatch(/OPENCODE_OPERATOR_SANDBOX\s*===/)
    }
  })
})

describe("T033 CLI output + exit codes + redaction", () => {
  test("exit map distinct for audit_pending/conflict/confirmation/unavailable/not_implemented", () => {
    expect(CLI_EXIT_BY_OUTCOME.success).toBe(0)
    expect(CLI_EXIT_BY_OUTCOME.audit_pending).toBe(202)
    expect(CLI_EXIT_BY_OUTCOME.confirmation_required).toBe(44)
    expect(CLI_EXIT_BY_OUTCOME.conflict).toBe(49)
    expect(CLI_EXIT_BY_OUTCOME.unavailable).toBe(53)
    expect(CLI_EXIT_BY_OUTCOME.not_implemented).toBe(51)
    const codes = [
      CLI_EXIT_BY_OUTCOME.audit_pending,
      CLI_EXIT_BY_OUTCOME.confirmation_required,
      CLI_EXIT_BY_OUTCOME.conflict,
      CLI_EXIT_BY_OUTCOME.unavailable,
      CLI_EXIT_BY_OUTCOME.not_implemented,
    ]
    expect(new Set(codes).size).toBe(5)
  })

  test("json mode emits envelope only on stdout; diagnostic on stderr", () => {
    const result: CommandResult = {
      ok: false,
      id: "langlock.status",
      kind: "operator.admin_result",
      outcome: "not_implemented",
      error: {
        code: "not_implemented",
        message: "domain handler for langlock.status is not implemented",
        retryable: false,
      },
    }
    const rendered = formatOperatorCli({
      result,
      mode: "json",
      diagnostic: "hint: use registry",
    })
    const parsed = JSON.parse(rendered.stdout)
    expect(parsed.kind).toBe("operator.admin_result")
    expect(parsed.outcome).toBe("not_implemented")
    expect(rendered.stdout.includes("hint")).toBe(false)
    expect(rendered.stderr.includes("hint")).toBe(true)
    expect(rendered.exitCode).toBe(51)
  })

  test("redacts secret material; keeps SecretRef shape", () => {
    const result: CommandResult = {
      ok: true,
      id: "langlock.status",
      kind: "operator.admin_result",
      outcome: "success",
      effective: {
        token: "sk-abcdefghijklmnopqrstuvwxyz0123456789",
        ref: { backend: "keychain", name: "api", version: 1 },
        password: "supersecret",
      },
    }
    const redacted = redactCommandResult(result)
    const effective = redacted.effective as Record<string, unknown>
    expect(effective.token).toBe("[REDACTED]")
    expect(effective.password).toBe("[REDACTED]")
    expect(effective.ref).toEqual({ backend: "keychain", name: "api", version: 1 })
  })

  test("exitCodeForResult maps outcomes", () => {
    expect(
      exitCodeForResult({
        ok: true,
        id: "x",
        kind: "operator.admin_result",
        outcome: "audit_pending",
      }),
    ).toBe(202)
  })
})

describe("T034 CLI --yes / TTY confirmation matrix", () => {
  test("TTY + --yes rejected", () => {
    const r = evaluateCliYesPolicy({
      confirmRequired: true,
      yes: true,
      isTty: true,
      authenticated: true,
      commandId: "output.purge",
    })
    expect(r.proceed).toBe(false)
    if (!r.proceed) {
      expect(r.result.outcome).toBe("confirmation_required")
      expect(r.result.error?.details?.reason).toBe("tty_yes_rejected")
    }
  })

  test("non-TTY + --yes + authenticated allowed", () => {
    const r = evaluateCliYesPolicy({
      confirmRequired: true,
      yes: true,
      isTty: false,
      authenticated: true,
      commandId: "output.purge",
    })
    expect(r.proceed).toBe(true)
    if (r.proceed) {
      expect(r.confirm).toBe(true)
      expect(r.interactive).toBe(false)
    }
  })

  test("non-TTY + --yes without auth denied (test-injected principal only)", () => {
    // Production op.ts always passes authenticated:true (local process owner = V1 operator).
    const r = evaluateCliYesPolicy({
      confirmRequired: true,
      yes: true,
      isTty: false,
      authenticated: false,
      commandId: "output.purge",
    })
    expect(r.proceed).toBe(false)
    if (!r.proceed) {
      expect(r.result.outcome).toBe("unauthorized")
      expect(r.result.error?.details?.testOnly).toBe(true)
    }
  })

  test("non-TTY without --yes → confirmation_required", () => {
    const r = evaluateCliYesPolicy({
      confirmRequired: true,
      yes: false,
      isTty: false,
      authenticated: true,
      commandId: "output.purge",
    })
    expect(r.proceed).toBe(false)
    if (!r.proceed) expect(r.result.outcome).toBe("confirmation_required")
  })

  test("TTY without --yes → interactive path", () => {
    const r = evaluateCliYesPolicy({
      confirmRequired: true,
      yes: false,
      isTty: true,
      authenticated: true,
      commandId: "output.purge",
    })
    expect(r.proceed).toBe(true)
    if (r.proceed) expect(r.interactive).toBe(true)
  })

  test("cancel leaves no mutation (injected prompt false)", async () => {
    const registry = createSeededOperatorCommandRegistry()
    let applied = 0
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      handlers: createHandlerMap([
        [
          "output.purge",
          () => {
            applied += 1
            return mutationPlanHandler()
          },
        ],
      ]),
    })
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["output", "purge"],
      flags: {
        expectedVersion: "-",
        idempotencyKey: "cancel-1",
      },
      ctx: principalCtx(),
      isTty: true,
      confirmPrompt: async () => false,
    })
    expect(out.cancelled).toBe(true)
    expect(out.result.outcome).toBe("confirmation_required")
    expect(applied).toBe(0)
    expect(out.exitCode).toBe(130)
  })

  test("TTY interactive confirm single execution", async () => {
    const registry = createSeededOperatorCommandRegistry()
    let applied = 0
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      handlers: createHandlerMap([
        [
          "output.purge",
          () => {
            applied += 1
            return mutationPlanHandler()
          },
        ],
      ]),
    })
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["output.purge"],
      flags: {
        expectedVersion: "-",
        idempotencyKey: "ok-1",
        json: true,
      },
      ctx: principalCtx(),
      isTty: true,
      confirmPrompt: async () => true,
    })
    expect(out.cancelled).toBeUndefined()
    expect(applied).toBe(1)
    expect(out.result.ok).toBe(true)
    expect(isAdminResult(out.result)).toBe(true)
    const envelope = JSON.parse(out.stdout)
    expect(envelope.kind).toBe("operator.admin_result")
    expect(envelope.ok).toBe(true)
  })

  test("non-TTY --yes mutation path", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      handlers: createHandlerMap([["output.purge", () => mutationPlanHandler()]]),
    })
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["output", "purge"],
      flags: {
        yes: true,
        expectedVersion: "-",
        idempotencyKey: "yes-1",
        json: true,
      },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.ok).toBe(true)
    expect(out.exitCode).toBe(0)
  })

  test("query path no-LLM + not_implemented from stubs", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const probe = createZeroLlmProbe()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: mutationPorts(),
      probe,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["langlock", "status"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.kind).toBe("operator.admin_result")
    expect(out.result.outcome === "success" || out.result.outcome === "not_implemented").toBe(true)
    probe.assertClean()
  })

  test("unknown command does not call LLM", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const probe = createZeroLlmProbe()
    const dispatcher = createDispatcher({
      registry,
      probe,
      handlers: createHandlerMap([]),
    })
    const runner = createCliRunner({ registry, dispatcher })
    const out = await runner.run({
      segments: ["totally", "unknown"],
      flags: { json: true },
      ctx: principalCtx(),
      isTty: false,
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.outcome).toBe("invalid_argument")
    probe.assertClean()
  })
})

describe("CLI import surface no LLM modules", () => {
  test("cli adapter source does not import provider/session prompt/mcp/plugin", async () => {
    const files = [
      new URL("../../src/operator/adapters/inbound/cli.ts", import.meta.url),
      new URL("../../src/operator/adapters/inbound/cli-parse.ts", import.meta.url),
      new URL("../../src/operator/adapters/inbound/cli-output.ts", import.meta.url),
      new URL("../../src/cli/cmd/op.ts", import.meta.url),
    ]
    for (const url of files) {
      const text = await Bun.file(url).text()
      // Strip comments so docstrings mentioning forbidden names do not false-positive.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
      expect(code).not.toMatch(/from ["']@\/provider/)
      expect(code).not.toMatch(/from ["']@\/session\/prompt/)
      expect(code).not.toMatch(/from ["'][^"']*ToolRegistry/)
      expect(code).not.toMatch(/from ["']@\/mcp/)
      expect(code).not.toMatch(/from ["']@\/plugin/)
    }
  })
})
