import { describe, expect, test } from "bun:test"
import {
  createCompositeSecretPort,
  createDomainStubs,
  createEnvRefSecretPort,
  createKeychainSecretPort,
  createMemorySecretPort,
  domainHandlerFor,
  wireDomainPorts,
} from "@/operator/adapters"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  DOMAIN_PORT_NAMES,
  rejectPlaintextSecrets,
  type HandlerContext,
} from "@/operator/application"
import type { CommandRequest, OperatorCommandDescriptor } from "@opencode-ai/core/operator"

function baseReq(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: "semantic.provider.add" as CommandRequest["id"],
    principal: { kind: "operator", subject: "local", projectBinding: null },
    scope: { kind: "project", ref: "p1" },
    source: "api",
    isTty: false,
    confirm: false,
    payload: {},
    ...overrides,
  }
}

describe("SecretPort (T018–T021)", () => {
  test("put/get/rotate return refs only; resolve never exposes plaintext in result type", async () => {
    const secrets = createMemorySecretPort()
    const put = await secrets.put({ backend: "keychain", name: "openai", plaintext: "sk_live_secret_value" })
    expect(put.ok).toBe(true)
    if (!put.ok) return
    expect(put.value).toEqual({ backend: "keychain", name: "openai", version: 1 })
    expect(JSON.stringify(put.value)).not.toContain("sk_live")

    const rotated = await secrets.rotate({
      backend: "keychain",
      name: "openai",
      plaintext: "sk_live_new",
    })
    expect(rotated.ok).toBe(true)
    if (!rotated.ok) return
    expect(rotated.value.version).toBe(2)

    const resolved = await secrets.resolveMaterial(rotated.value)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value).toBe("__redacted__")
  })

  test("keychain adapter does not touch real keychain; unavailable by default", async () => {
    const kc = createKeychainSecretPort()
    const r = await kc.put({ backend: "keychain", name: "x", plaintext: "nope" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("unavailable")
      expect(r.reason).toContain("keychain")
    }
  })

  test("keychain fake backend works without real OS keychain", async () => {
    const { createMemoryKeychainBackend } = await import("@/operator/adapters")
    const kc = createKeychainSecretPort({
      backend: createMemoryKeychainBackend(),
      sandbox: false,
    })
    const r = await kc.put({ backend: "keychain", name: "test", plaintext: "val" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.backend).toBe("keychain")
  })

  test("env-ref missing → secret_backend; present → ref only", async () => {
    const envPort = createEnvRefSecretPort({ CI_TOKEN: "hidden-value" })
    const missing = await envPort.getRef({ backend: "env-ref", name: "MISSING" })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.code).toBe("secret_backend")

    const put = await envPort.put({ backend: "env-ref", name: "CI_TOKEN", plaintext: "ignored" })
    expect(put.ok).toBe(true)
    if (!put.ok) return
    expect(JSON.stringify(put.value)).not.toContain("hidden-value")
    const resolved = await envPort.resolveMaterial(put.value)
    expect(resolved.ok && resolved.value).toBe("__redacted__")
  })

  test("plaintext rejection on known secret fields", () => {
    const denied = rejectPlaintextSecrets(
      baseReq({
        payload: { apiKey: "sk_live_abc", endpoint: "https://x" },
      }),
    )
    expect(denied).not.toBeNull()
    expect(denied?.outcome).toBe("invalid_argument")

    const allowed = rejectPlaintextSecrets(
      baseReq({
        payload: {
          apiKey: { backend: "keychain", name: "openai", version: 1 },
        },
      }),
    )
    expect(allowed).toBeNull()
  })

  test("dispatcher rejects plaintext secrets", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({ registry })
    const result = await dispatcher.dispatchRequest(
      baseReq({
        id: "langlock.status" as CommandRequest["id"],
        payload: { password: "hunter2" },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("invalid_argument")
  })

  test("composite routes backends", async () => {
    const port = createCompositeSecretPort({
      keychain: createMemorySecretPort(),
      envRef: createEnvRefSecretPort({ A: "1" }),
    })
    const a = await port.put({ backend: "keychain", name: "k", plaintext: "p" })
    const b = await port.put({ backend: "env-ref", name: "A", plaintext: "x" })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })
})

describe("domain ports + stubs (T038–T040)", () => {
  test("all domain ports present", () => {
    const ports = createDomainStubs()
    for (const name of DOMAIN_PORT_NAMES) {
      expect(typeof ports[name].invoke).toBe("function")
    }
  })

  test("stubs return not_implemented; never fake cutover success", async () => {
    const ports = createDomainStubs()
    const descriptor = {
      id: "semantic.embedding.cutover",
      aliases: [],
      mutates: true,
      scopesAllowed: ["project"],
      confirmRequired: true,
      offlineCapable: true,
      schemaVersion: "1.0.0",
      authority: "native",
      domain: "semantic",
    } as unknown as OperatorCommandDescriptor
    const ctx = {
      request: baseReq({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        confirm: true,
      }),
      descriptor,
    } as HandlerContext
    const cut = await ports.semantic.invoke(ctx)
    expect(cut.kind).toBe("failure")
    if (cut.kind === "failure") expect(cut.code).toBe("not_implemented")
    expect(JSON.stringify(cut)).not.toMatch(/"ok":true/)
  })

  test("stubs return unavailable for network test ops", async () => {
    const ports = createDomainStubs()
    const descriptor = {
      id: "telemetry.test",
      aliases: [],
      mutates: true,
      scopesAllowed: ["project"],
      confirmRequired: false,
      offlineCapable: false,
      schemaVersion: "1.0.0",
      authority: "native",
      domain: "telemetry",
    } as unknown as OperatorCommandDescriptor
    const r = await ports.telemetry.invoke({
      request: baseReq({ id: "telemetry.test" as CommandRequest["id"] }),
      descriptor,
    } as HandlerContext)
    expect(r.kind).toBe("failure")
    if (r.kind === "failure") expect(r.code).toBe("unavailable")
  })

  test("dispatcher + domain stub handler for all domains sample", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const ports = wireDomainPorts()
    const dispatcher = createDispatcher({
      registry,
      defaultHandler: domainHandlerFor(ports),
    })
    const samples = [
      "telemetry.status",
      "smart.status",
      "routing.test",
      "budget.status",
      "pools.status",
      "process.status",
      "task.status",
      "jobs.list",
      "langlock.status",
      "output.stat",
      "semantic.binding.status",
      "mcp.server.list",
    ] as const
    for (const id of samples) {
      const scope =
        id.startsWith("process.") || id.startsWith("task.") || id.startsWith("output.")
          ? ({ kind: "session" as const, ref: "ses_1" })
          : ({ kind: "project" as const, ref: "p1" })
      const result = await dispatcher.dispatchRequest(
        baseReq({
          id: id as CommandRequest["id"],
          scope,
        }),
      )
      expect(result.ok).toBe(false)
      expect(["not_implemented", "unavailable", "forbidden_scope"]).toContain(result.outcome)
    }
  })

  test("application domain ports module has no direct domain package imports", async () => {
    const fs = await import("fs/promises")
    const path = await import("path")
    const file = path.resolve(import.meta.dir, "../../src/operator/application/ports/domain-ports.ts")
    const text = await fs.readFile(file, "utf8")
    expect(text).not.toMatch(/from\s+["']@\/mcp/)
    expect(text).not.toMatch(/from\s+["']@\/provider/)
    expect(text).not.toMatch(/from\s+["']@opencode-ai\/core\/(provider|model|llm)/)
  })
})
