/**
 * Code-review Critical/High/Medium fixes (pre-T025).
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createKeychainSecretPort,
  createDomainStubs,
  handlersFromDomainPorts,
} from "@/operator/adapters"
import {
  createDispatcher,
  createProcessMutexLockPort,
  createSeededOperatorCommandRegistry,
  mutateAuthority,
  type MutationPorts,
} from "@/operator/application"
import {
  findPlaintextSecretFields,
  isExactSecretRef,
  isScopeAllowedForPrincipal,
  listReservedIds,
  parsePrincipal,
  type CommandRequest,
} from "@opencode-ai/core/operator"
import {
  assertCommandPolicy,
  assertRepoSandboxLayout,
  assertUnderSandboxRoot,
  FORBIDDEN_PROD_PORT,
} from "@/dev/sandbox"

function req(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: "langlock.set" as CommandRequest["id"],
    principal: { kind: "operator", subject: "local", projectBinding: null },
    scope: { kind: "project", ref: "p1" },
    source: "api",
    isTty: false,
    confirm: false,
    idempotencyKey: "k-" + Math.random().toString(36).slice(2),
    ...overrides,
  }
}

describe("durable Config.Service authority (fix #1)", () => {
  test("no memory bookkeeping; restart preserves version/payload", async () => {
    const svc = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const store1 = createDurableOperatorStore({ config: svc, lock })
    const cas = await store1.config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { language: "en-US" },
      nowMs: 1,
    })
    expect(cas.ok).toBe(true)
    if (!cas.ok) return

    const store2 = createDurableOperatorStore({ config: svc, lock })
    const got = await store2.config.get("langlock")
    expect(got?.version).toBe(cas.version)
    expect(got?.payload).toEqual({ language: "en-US" })
    expect(svc.dump().project.operator).toBeDefined()
  })

  test("fail injection before write leaves state unchanged", async () => {
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({
      config: svc,
      lock: createProcessMutexLockPort(),
      beforeWrite: () => {
        throw new Error("injected fail")
      },
    })
    const r = await store.config.compareAndSet({
      authority: "a",
      expectedVersion: null,
      payload: { x: 1 },
      nowMs: 1,
    })
    expect(r.ok).toBe(false)
    expect(await store.config.get("a")).toBeNull()
    expect(svc.dump().project.operator).toBeUndefined()
  })

  test("concurrent multi-adapter CAS one winner", async () => {
    const svc = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const a = createDurableOperatorStore({ config: svc, lock })
    const b = createDurableOperatorStore({ config: svc, lock })
    await a.config.compareAndSet({
      authority: "x",
      expectedVersion: null,
      payload: { n: 0 },
      nowMs: 0,
    })
    const cur = await a.config.get("x")
    const v = cur!.version
    const [r1, r2] = await Promise.all([
      a.config.compareAndSet({ authority: "x", expectedVersion: v, payload: { n: 1 }, nowMs: 1 }),
      b.config.compareAndSet({ authority: "x", expectedVersion: v, payload: { n: 2 }, nowMs: 1 }),
    ])
    expect([r1, r2].filter((r) => r.ok).length).toBe(1)
    expect([r1, r2].filter((r) => !r.ok).length).toBe(1)
  })
})

describe("mutation contract + idempotency race (fix #2/#3)", () => {
  test("mutation without idempotencyKey rejected", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({ config: svc, lock: createProcessMutexLockPort() })
    const events = createMemoryEventPort()
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      events,
      outbox: createMemoryOutboxPort(),
    }
    const dispatcher = createDispatcher({ registry, mutationPorts: ports })
    const r = await dispatcher.dispatchRequest(
      req({
        id: "langlock.set" as CommandRequest["id"],
        idempotencyKey: undefined,
        version: undefined,
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe("invalid_argument")
  })

  test("concurrent same idempotency key cannot double mutate", async () => {
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({ config: svc, lock: createProcessMutexLockPort() })
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      outbox: createMemoryOutboxPort(),
      nowMs: () => 100,
    }
    const key = "same-key"
    const request = req({ idempotencyKey: key })
    const [a, b] = await Promise.all([
      mutateAuthority(ports, {
        request,
        authority: "langlock",
        apply: () => ({ language: "en" }),
      }),
      mutateAuthority(ports, {
        request: { ...request },
        authority: "langlock",
        apply: () => ({ language: "pt" }),
      }),
    ])
    const successes = [a, b].filter((r) => r.ok && r.outcome === "success")
    const replays = [a, b].filter((r) => r.outcome === "idempotent_replay")
    const busy = [a, b].filter((r) => r.outcome === "conflict")
    expect(successes.length + replays.length + busy.length).toBe(2)
    expect(successes.length).toBeLessThanOrEqual(1)
  })
})

describe("rollback full payload (fix #4)", () => {
  test("cutover stores full prior payload; rollback restores it", async () => {
    let clock = 1
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({ config: svc, lock: createProcessMutexLockPort() })
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      rollback: store.rollback,
      outbox: createMemoryOutboxPort(),
      nowMs: () => clock++,
    }
    const first = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "init" }),
      authority: "semantic.embedding",
      apply: () => ({ model: "emb-v1", dim: 128 }),
    })
    expect(first.ok).toBe(true)

    const cut = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        confirm: true,
        version: first.version,
        idempotencyKey: "cut",
      }),
      authority: "semantic.embedding",
      apply: () => ({ model: "emb-v2", dim: 256 }),
      cutoverDomain: "semantic.embedding",
      snapshotBefore: true,
    })
    expect(cut.ok).toBe(true)

    const rb = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.rollback" as CommandRequest["id"],
        confirm: true,
        version: cut.version,
        idempotencyKey: "rb",
      }),
      authority: "semantic.embedding",
      apply: (c) => c,
      rollbackDomain: "semantic.embedding",
    })
    expect(rb.ok).toBe(true)
    expect(rb.effective).toEqual({ model: "emb-v1", dim: 128 })
  })
})

describe("outbox prepare before mutation (fix #5)", () => {
  test("external outbox prepare failure leaves config unchanged", async () => {
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({ config: svc, lock: createProcessMutexLockPort() })
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      outbox: createMemoryOutboxPort({ failPrepare: true }),
      nowMs: () => 1,
    }
    const r = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "o1" }),
      authority: "a",
      apply: () => ({ x: 1 }),
    })
    expect(r.ok).toBe(false)
    expect(await store.config.get("a")).toBeNull()
  })
})

describe("keychain mock runner (fix #7)", () => {
  test("uses injectable backend; no real keychain", async () => {
    const { createMemoryKeychainBackend } = await import("@/operator/adapters")
    const backend = createMemoryKeychainBackend()
    const kc = createKeychainSecretPort({ backend, sandbox: false })
    const put = await kc.put({ backend: "keychain", name: "t", plaintext: "secret" })
    expect(put.ok).toBe(true)
    if (put.ok) {
      const mat = await kc.resolveMaterial(put.value)
      expect(mat.ok && mat.value).toBe("__redacted__")
    }
  })

  test("sandbox default is unavailable (no real keychain)", async () => {
    const kc = createKeychainSecretPort({ sandbox: true })
    const r = await kc.put({ backend: "keychain", name: "x", plaintext: "y" })
    expect(r.ok).toBe(false)
  })
})

describe("plaintext scanner (fix #8)", () => {
  test("exact SecretRef only; reject extra keys and nested secrets", () => {
    expect(isExactSecretRef({ backend: "keychain", name: "k", version: 1 })).toBe(true)
    expect(isExactSecretRef({ backend: "keychain", name: "k", version: 1, extra: "x" })).toBe(false)
    expect(findPlaintextSecretFields({ apiKey: "sk" })).toEqual(["apiKey"])
    expect(
      findPlaintextSecretFields({
        apiKey: { backend: "keychain", name: "k", version: 1, token: "leak" },
      }),
    ).toContain("apiKey")
    expect(findPlaintextSecretFields({ credential: "x" })).toEqual(["credential"])
    // cycle safe
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => findPlaintextSecretFields(a)).not.toThrow()
  })
})

describe("scope fail-closed (fix #9)", () => {
  test("project-bound cannot global or other project or unscoped session", () => {
    const p = parsePrincipal({ kind: "operator", subject: "local", projectBinding: "proj_a" })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(isScopeAllowedForPrincipal(p.value, { kind: "global", ref: null })).toBe(false)
    expect(isScopeAllowedForPrincipal(p.value, { kind: "project", ref: "proj_b" })).toBe(false)
    expect(isScopeAllowedForPrincipal(p.value, { kind: "project", ref: "proj_a" })).toBe(true)
    expect(isScopeAllowedForPrincipal(p.value, { kind: "session", ref: "s1" })).toBe(false)
    expect(isScopeAllowedForPrincipal(p.value, { kind: "session", ref: "s1" }, { projectId: "proj_a" })).toBe(true)
    expect(isScopeAllowedForPrincipal(p.value, { kind: "session", ref: "s1" }, { projectId: "proj_b" })).toBe(false)
  })
})

describe("sandbox hardening (fix #10)", () => {
  test("port 40960 does not match forbidden 4096", () => {
    // serve requires operator port 14096; use non-serve to test false-positive substring
    expect(assertCommandPolicy(["tool", "--callback", "http://127.0.0.1:40960"]).ok).toBe(true)
    expect(assertCommandPolicy(["tool", "--callback", `http://127.0.0.1:${FORBIDDEN_PROD_PORT}`]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--port", String(FORBIDDEN_PROD_PORT)]).ok).toBe(false)
  })

  test("symlink escape rejected", async () => {
    await using tmp = await makeTmpPath()
    const repo = path.join(tmp.path, "repo")
    const sandbox = path.join(repo, ".dev", "opencode-operator")
    await fs.mkdir(sandbox, { recursive: true })
    const outside = path.join(tmp.path, "outside")
    await fs.mkdir(outside, { recursive: true })
    const link = path.join(sandbox, "escape")
    await fs.symlink(outside, link)
    const r = assertUnderSandboxRoot(link, sandbox)
    expect(r.ok).toBe(false)
  })

  test("external sandbox root rejected", () => {
    const r = assertRepoSandboxLayout({
      repoRoot: "/Users/example/opencode",
      configDir: "/tmp/evil/config",
      sandboxRoot: "/tmp/evil",
    })
    expect(r.ok).toBe(false)
  })
})

describe("domain handler map (fix #11)", () => {
  test("handlersFromDomainPorts maps all catalog ids", () => {
    const map = handlersFromDomainPorts(createDomainStubs())
    const ids = listReservedIds()
    expect(map.size).toBe(ids.length)
    expect(map.size).toBeGreaterThan(50)
    for (const id of ids) {
      expect(map.has(id)).toBe(true)
    }
  })
})

describe("zero-LLM import boundary (fix #12)", () => {
  test("operator application/adapters have no provider/llm imports", async () => {
    const roots = [
      path.resolve(import.meta.dir, "../../src/operator/application"),
      path.resolve(import.meta.dir, "../../src/operator/adapters"),
    ]
    for (const root of roots) {
      const files = await walkTs(root)
      for (const file of files) {
        const text = await fs.readFile(file, "utf8")
        const importLines = text.split("\n").filter((l) => /^\s*import\b/.test(l) && /\bfrom\s+["']/.test(l))
        for (const line of importLines) {
          expect(line).not.toMatch(/\/provider(\/|"|')/)
          expect(line).not.toMatch(/\/llm(\/|"|')/)
          expect(line).not.toMatch(/aisdk/)
          expect(line).not.toMatch(/session\/prompt/)
        }
      }
    }
  })
})

async function makeTmpPath(): Promise<{ path: string; [Symbol.asyncDispose]: () => Promise<void> }> {
  const dir = path.join(os.tmpdir(), "op-review-" + process.pid + "-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  return {
    path: dir,
    [Symbol.asyncDispose]: async () => {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkTs(p)))
    else if (e.name.endsWith(".ts")) out.push(p)
  }
  return out
}
