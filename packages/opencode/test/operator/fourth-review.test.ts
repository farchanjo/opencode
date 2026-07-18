/**
 * Fourth-review acceptance proofs (shared document lock, live adapters, fail-closed audit).
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createFileConfigService,
  createLiveConfigServiceLike,
  createLiveEventV2AuditPort,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createDarwinNativeKeychainBackend,
  createKeychainSecretPort,
  createMemoryKeychainBackend,
} from "@/operator/adapters"
import {
  createFlockLockPort,
  createProcessMutexLockPort,
  mutateAuthority,
  type MutationPorts,
} from "@/operator/application"
import { composeOperatorControlPlane } from "@/operator/main"
import type { CommandRequest } from "@opencode-ai/core/operator"
import { Effect, Stream } from "effect"
import { OperatorAuditEvent } from "@opencode-ai/core/operator"

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

async function tmpDir() {
  const dir = path.join(os.tmpdir(), "op-4th-" + process.pid + "-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe("shared document lock (finding 1)", () => {
  test("two processes DIFFERENT authorities + sibling keys: no lost updates", async () => {
    await using tmp = await tmpDir()
    const lockDir = path.join(tmp.path, "locks")
    const configFile = path.join(tmp.path, "config.json")
    await fs.mkdir(lockDir, { recursive: true })
    // Seed document with sibling key
    await Bun.write(
      configFile,
      JSON.stringify({ theme: "dark", plugin: ["a"], operator: { authorities: {}, idempotency: {}, rollback: {} } }),
    )

    const worker = `
      import { createFileConfigService, createDurableOperatorStore } from ${JSON.stringify(
        path.resolve(import.meta.dir, "../../src/operator/adapters/outbound/config-service.ts"),
      )};
      import { createFlockLockPort } from ${JSON.stringify(
        path.resolve(import.meta.dir, "../../src/operator/application/ports/lock-port.ts"),
      )};
      const configFile = process.env.CFG!;
      const lockDir = process.env.LOCK!;
      const authority = process.env.AUTH!;
      const payload = process.env.PAYLOAD!;
      const lock = await createFlockLockPort({ dir: lockDir });
      const store = createDurableOperatorStore({
        config: createFileConfigService(configFile),
        lock,
        projectKey: "project",
      });
      const r = await store.config.compareAndSet({
        authority,
        expectedVersion: null,
        payload: { v: payload },
        nowMs: Date.now(),
      });
      process.stdout.write(JSON.stringify(r));
    `

    const spawn = (authority: string, payload: string) =>
      Bun.spawn(["bun", "-e", worker], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: { ...process.env, CFG: configFile, LOCK: lockDir, AUTH: authority, PAYLOAD: payload },
        stdout: "pipe",
        stderr: "pipe",
      })

    const a = spawn("langlock", "en")
    const b = spawn("telemetry", "on")
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
    expect(JSON.parse(outA).ok).toBe(true)
    expect(JSON.parse(outB).ok).toBe(true)

    const doc = JSON.parse(await Bun.file(configFile).text()) as {
      theme: string
      plugin: string[]
      operator: { authorities: Record<string, { payload: { v: string } }> }
    }
    // Sibling keys preserved
    expect(doc.theme).toBe("dark")
    expect(doc.plugin).toEqual(["a"])
    // Both authorities present (no lost update under document lock)
    expect(doc.operator.authorities.langlock?.payload.v).toBe("en")
    expect(doc.operator.authorities.telemetry?.payload.v).toBe("on")
  })
})

describe("live Config.Service-like adapter (finding 2)", () => {
  test("createLiveConfigServiceLike wraps Effect Config surface", async () => {
    let project: Record<string, unknown> = { sibling: true }
    const fakeEffectConfig = {
      get: () => Effect.succeed(project),
      getGlobal: () => Effect.succeed({}),
      update: (c: Record<string, unknown>) =>
        Effect.sync(() => {
          project = { ...project, ...c }
        }),
      updateGlobal: (c: Record<string, unknown>) =>
        Effect.sync(() => {
          project = { ...project, ...c }
          return { changed: true }
        }),
    }
    const like = createLiveConfigServiceLike({
      useConfig: (fn) => Effect.runPromise(fn(fakeEffectConfig)),
    })
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: like, lock })
    const cas = await store.config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { language: "en" },
      nowMs: 1,
    })
    expect(cas.ok).toBe(true)
    expect(project.sibling).toBe(true)
    expect((project.operator as { authorities: unknown })?.authorities).toBeDefined()
  })
})

describe("live EventV2 adapter + fail-closed audit (finding 3)", () => {
  test("createLiveEventV2AuditPort publishes via Effect EventV2 surface", async () => {
    const published: unknown[] = []
    const fakeEvents = {
      publish: (_def: unknown, data: unknown) =>
        Effect.sync(() => {
          published.push(data)
          return { id: "evt_live_1", type: OperatorAuditEvent.type, data }
        }),
      durable: () => Stream.empty,
    }
    const port = createLiveEventV2AuditPort({
      events: fakeEvents as never,
      run: (e) => Effect.runPromise(e),
    })
    const r = await port.appendAudit({
      source: "cli",
      actorRef: "operator:local",
      scope: { kind: "project", ref: "p" },
      commandId: "langlock.set",
      beforeVersion: null,
      afterVersion: "cas_v1",
      outcome: "success",
      createdAtMs: 1,
    })
    expect(r.ok).toBe(true)
    expect(published.length).toBe(1)
    expect(await port.pruneAudits(["x"])).toBe(0)
  })

  test("requireAudit fails closed when EventPort missing", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      requireAudit: true,
      // no events
      outbox: createMemoryOutboxPort(),
    }
    const r = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "no-audit" }),
      authority: "a",
      apply: () => ({ x: 1 }),
    })
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe("unavailable")
    expect(await store.config.get("a")).toBeNull()
  })

  test("requireAudit returns audit_pending (not silent success) when publish fails after CAS", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      requireAudit: true,
      events: {
        appendAudit: async () => ({ ok: false, code: "unavailable", reason: "publish down" }),
        listAudits: async () => [],
        pruneAudits: async () => 0,
      },
      outbox: createMemoryOutboxPort(),
    }
    const r = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "audit-fail" }),
      authority: "a",
      apply: () => ({ x: 1 }),
    })
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe("audit_pending")
    expect(r.version).toBeTruthy()
  })
})

describe("Darwin keychain selection (finding 4)", () => {
  test("sandbox always unavailable; mock backend works without real keychain", async () => {
    const sand = createDarwinNativeKeychainBackend({ sandbox: true })
    expect(sand.available()).toBe(false)
    const mock = createMemoryKeychainBackend()
    const port = createKeychainSecretPort({ backend: mock, sandbox: false })
    const put = await port.put({ backend: "keychain", name: "t", plaintext: "secret" })
    expect(put.ok).toBe(true)
    if (put.ok) {
      const mat = await port.resolveMaterial(put.value)
      expect(mat.ok && mat.value).toBe("__redacted__")
    }
  })

  test("composition live requires events; secrets not void", async () => {
    await using tmp = await tmpDir()
    const lockDir = path.join(tmp.path, "locks")
    await fs.mkdir(lockDir, { recursive: true })
    await expect(
      composeOperatorControlPlane({
        mode: "live",
        config: createFakeConfigService(),
        lockDir,
      }),
    ).rejects.toThrow(/EventPort required/)

    const composed = await composeOperatorControlPlane({
      mode: "test",
      config: createFakeConfigService(),
      lockDir,
      events: createMemoryEventPort(),
    })
    expect(composed.secrets).toBeDefined()
    expect(composed.mutationPorts.requireAudit).toBe(false)
  })
})
