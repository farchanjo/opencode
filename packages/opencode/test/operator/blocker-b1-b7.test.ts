/**
 * Blockers B1–B7 proof suite (third-review readiness).
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createFileConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createKeychainSecretPort,
  createMemoryKeychainBackend,
  createDomainStubs,
  domainHandlerFor,
} from "@/operator/adapters"
import {
  createDispatcher,
  createFlockLockPort,
  createProcessMutexLockPort,
  createSeededOperatorCommandRegistry,
  mutateAuthority,
  type HandlerResult,
  type MutationPorts,
} from "@/operator/application"
import type { CommandRequest } from "@opencode-ai/core/operator"
import { assertRepoSandboxLayout, buildSandboxEnv, resolveSandboxPaths } from "@/dev/sandbox"

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

describe("B1/B6/B7 Flock-locked durable Config", () => {
  test("createDurableOperatorStore requires lock", () => {
    const svc = createFakeConfigService()
    expect(() =>
      // @ts-expect-error lock required
      createDurableOperatorStore({ config: svc }),
    ).toThrow(/lock/)
  })

  test("adapter recreation preserves state under Flock dir", async () => {
    await using tmp = await tmpDir()
    const lockDir = path.join(tmp.path, "locks")
    await fs.mkdir(lockDir, { recursive: true })
    const lock = await createFlockLockPort({ dir: lockDir })
    const svc = createFakeConfigService()
    // Feature 032 follow-up: the project-profile write is wholesale-replace (the file is
    // 100% operator-owned — see config-service.ts mergeOperator), so it never preserves
    // sibling keys by design; sibling preservation is asserted below on the GLOBAL write,
    // which legitimately shares its file with user-authored config.
    await svc.update({ theme: "dark", other: { nested: true } })

    const store1 = createDurableOperatorStore({ config: svc, lock })
    const cas = await store1.config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { language: "en" },
      nowMs: 1,
    })
    expect(cas.ok).toBe(true)

    const store2 = createDurableOperatorStore({ config: svc, lock })
    const got = await store2.config.get("langlock")
    expect(got?.payload).toEqual({ language: "en" })
    // The project profile write dropped the pre-existing sibling keys (wholesale replace).
    expect(svc.dump().project.theme).toBeUndefined()
    expect(svc.dump().project.other).toBeUndefined()

    // A GLOBAL authority write still deep-merges: pre-existing global sibling keys survive.
    await svc.updateGlobal({ theme: "dark", other: { nested: true } })
    const globalCas = await store1.config.compareAndSet({
      authority: "global:langlock",
      expectedVersion: null,
      payload: { language: "en" },
      nowMs: 2,
    })
    expect(globalCas.ok).toBe(true)
    expect(svc.dump().global.theme).toBe("dark")
    expect(svc.dump().global.other).toEqual({ nested: true })
  })

  test("two processes contend same version: exactly one success", async () => {
    await using tmp = await tmpDir()
    const lockDir = path.join(tmp.path, "locks")
    const configFile = path.join(tmp.path, "config.json")
    await fs.mkdir(lockDir, { recursive: true })
    await Bun.write(configFile, "{}")

    // Seed v1
    const lock = await createFlockLockPort({ dir: lockDir })
    const seed = createDurableOperatorStore({
      config: createFileConfigService(configFile),
      lock,
    })
    const init = await seed.config.compareAndSet({
      authority: "race",
      expectedVersion: null,
      payload: { n: 0 },
      nowMs: 0,
    })
    expect(init.ok).toBe(true)
    if (!init.ok) return
    const expected = init.version

    const worker = `
      import { createFileConfigService, createDurableOperatorStore } from ${JSON.stringify(
        path.resolve(import.meta.dir, "../../src/operator/adapters/outbound/config-service.ts"),
      )};
      import { createFlockLockPort } from ${JSON.stringify(
        path.resolve(import.meta.dir, "../../src/operator/application/ports/lock-port.ts"),
      )};
      const configFile = process.env.CFG;
      const lockDir = process.env.LOCK;
      const expected = process.env.VER;
      const payload = Number(process.env.PAYLOAD);
      const lock = await createFlockLockPort({ dir: lockDir });
      const store = createDurableOperatorStore({
        config: createFileConfigService(configFile),
        lock,
      });
      const r = await store.config.compareAndSet({
        authority: "race",
        expectedVersion: expected,
        payload: { n: payload },
        nowMs: Date.now(),
      });
      process.stdout.write(JSON.stringify(r));
    `

    const spawnOne = (payload: number) =>
      Bun.spawn(["bun", "-e", worker], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          CFG: configFile,
          LOCK: lockDir,
          VER: expected,
          PAYLOAD: String(payload),
        },
        stdout: "pipe",
        stderr: "pipe",
      })

    const a = spawnOne(1)
    const b = spawnOne(2)
    const [outA, errA, codeA] = await Promise.all([
      new Response(a.stdout).text(),
      new Response(a.stderr).text(),
      a.exited,
    ])
    const [outB, errB, codeB] = await Promise.all([
      new Response(b.stdout).text(),
      new Response(b.stderr).text(),
      b.exited,
    ])
    expect(codeA, errA).toBe(0)
    expect(codeB, errB).toBe(0)
    const rA = JSON.parse(outA) as { ok: boolean }
    const rB = JSON.parse(outB) as { ok: boolean }
    const successes = [rA, rB].filter((r) => r.ok).length
    const conflicts = [rA, rB].filter((r) => !r.ok).length
    expect(successes).toBe(1)
    expect(conflicts).toBe(1)
  })
})

describe("B2 typed handler + mutation pipeline", () => {
  test("mutation_plan executes via mutateAuthority; success/replay/conflict", async () => {
    const lock = createProcessMutexLockPort()
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({ config: svc, lock })
    const events = createMemoryEventPort()
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      events,
      outbox: createMemoryOutboxPort(),
      nowMs: () => Date.now(),
    }
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: ports,
      handlers: new Map([
        [
          "langlock.set",
          () =>
            ({
              kind: "mutation_plan",
              authority: "langlock",
              apply: () => ({ language: "pt-BR" }),
            }) satisfies HandlerResult,
        ],
      ]),
    })

    const r1 = await dispatcher.dispatchRequest(
      req({ id: "langlock.set" as CommandRequest["id"], idempotencyKey: "m1" }),
    )
    expect(r1.ok).toBe(true)
    expect(r1.outcome).toBe("success")
    expect(r1.auditId).toBeDefined()

    const r2 = await dispatcher.dispatchRequest(
      req({
        id: "langlock.set" as CommandRequest["id"],
        idempotencyKey: "m1",
        version: r1.version,
      }),
    )
    expect(r2.outcome).toBe("idempotent_replay")

    const r3 = await dispatcher.dispatchRequest(
      req({
        id: "langlock.set" as CommandRequest["id"],
        idempotencyKey: "m2",
        version: "cas_v0",
      }),
    )
    expect(r3.outcome).toBe("conflict")
  })

  test("illegal handler commit rejected", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: {
        config: store.config,
        idempotency: store.idempotency,
        outbox: createMemoryOutboxPort(),
      },
      handlers: new Map([
        [
          "langlock.set",
          // intentional illegal legacy shape for runtime rejection
          (() =>
            ({
              ok: true,
              kind: "operator.admin_result",
              id: "langlock.set",
              outcome: "success",
            })) as unknown as () => HandlerResult,
        ],
      ]),
    })
    const r = await dispatcher.dispatchRequest(
      req({ id: "langlock.set" as CommandRequest["id"], idempotencyKey: "bad" }),
    )
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe("invalid_argument")
  })
})

describe("B4 keychain backend (no argv plaintext)", () => {
  test("mock backend never exposes secret in public resolve", async () => {
    const backend = createMemoryKeychainBackend()
    const port = createKeychainSecretPort({ backend, sandbox: false })
    const put = await port.put({ backend: "keychain", name: "k", plaintext: "super-secret" })
    expect(put.ok).toBe(true)
    if (!put.ok) return
    const mat = await port.resolveMaterial(put.value)
    expect(mat.ok && mat.value).toBe("__redacted__")
    // sandbox default unavailable
    const sand = createKeychainSecretPort({ sandbox: true })
    const denied = await sand.put({ backend: "keychain", name: "k", plaintext: "x" })
    expect(denied.ok).toBe(false)
  })
})

describe("B5 sandbox containment after overrides", () => {
  test("buildSandboxEnv rejects external OPENCODE_CONFIG_DIR override", () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../../../")
    expect(() =>
      buildSandboxEnv({
        repoRoot,
        realHome: os.homedir(),
        extra: { OPENCODE_CONFIG_DIR: "/tmp/evil-config" },
      }),
    ).toThrow()
  })

  test("assertRepoSandboxLayout rejects external root", () => {
    const r = assertRepoSandboxLayout({
      repoRoot: "/Users/x/opencode",
      configDir: "/tmp/x/config",
      sandboxRoot: "/tmp/x",
    })
    expect(r.ok).toBe(false)
  })

  test("resolveSandboxPaths under .dev", () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../../../")
    const p = resolveSandboxPaths(repoRoot)
    expect(p.root.includes(".dev/opencode-operator")).toBe(true)
  })
})

async function tmpDir() {
  const dir = path.join(os.tmpdir(), "op-b-" + process.pid + "-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
