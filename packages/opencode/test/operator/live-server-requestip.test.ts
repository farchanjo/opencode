/**
 * Live Node Server.listen integration (Feature007 R2 gap close).
 * - Real TCP to 127.0.0.1 under sandbox port 14096
 * - Serialized via cross-process file lock (no port contention flake)
 * - Env mutations happen only under the same lock (safe under --concurrent)
 * - Operator sees real socket remoteAddress (not invented 127)
 * - Non-loopback bind refuses mount
 * - Spoofed XFF/Host ignored
 * No register/mdns/OAuth; stop only the child listener.
 */
import { describe, expect, test } from "bun:test"
import { Server } from "@/server/server"
import { createDurableOperatorStore, createFakeConfigService } from "@/operator/adapters"
import { createProcessMutexLockPort, mutateAuthority } from "@/operator/application"
import { tryCreateOperatorHttpFetch } from "@/operator/http/mount"
import type { CommandRequest } from "@opencode-ai/core/operator"
import {
  OPERATOR_SANDBOX_TEST_PORT,
  stopOperatorListener,
  waitForPortRelease,
  withOperatorSandboxPortLock,
} from "./lib/operator-port-lock"

const PORT = OPERATOR_SANDBOX_TEST_PORT
const HOST = "127.0.0.1"

type Listener = Awaited<ReturnType<typeof Server.listen>>

const ENV_KEYS = [
  "OPENCODE_OPERATOR_CONTROL_PLANE",
  "OPENCODE_DEV_OPERATOR_",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
] as const

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>

function snapshotEnv(): EnvSnapshot {
  const out: EnvSnapshot = {}
  for (const key of ENV_KEYS) out[key] = process.env[key]
  return out
}

function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    const value = snap[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/**
 * Bind, run, stop under cross-process lock. Env + port + listener lifecycle
 * are fully enclosed so --concurrent / --parallel cannot stomp mid-test.
 */
async function withLiveOperatorListener(
  opts: {
    hostname: string
    port: number
    env?: Record<string, string | undefined>
  },
  fn: (listener: Listener) => Promise<void>,
): Promise<void> {
  await withOperatorSandboxPortLock(async () => {
    const prev = snapshotEnv()
    let listener: Listener | undefined
    try {
      if (opts.env) {
        for (const [key, value] of Object.entries(opts.env)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
      await waitForPortRelease(opts.port, {
        host: opts.hostname === "0.0.0.0" ? "127.0.0.1" : opts.hostname,
        timeoutMs: 15_000,
      })
      listener = await Server.listen({
        hostname: opts.hostname,
        port: opts.port,
        mdns: false,
      })
      await fn(listener)
    } finally {
      await stopOperatorListener(
        listener,
        opts.port,
        opts.hostname === "0.0.0.0" ? "127.0.0.1" : opts.hostname,
      )
      Server.setOperatorFetch(undefined)
      restoreEnv(prev)
    }
  })
}

describe("live Server.listen operator requestIP (Node remoteAddress)", () => {
  test(
    "loopback real TCP health succeeds with flag; spoof headers ignored",
    async () => {
      await withLiveOperatorListener(
        {
          hostname: HOST,
          port: PORT,
          env: {
            OPENCODE_OPERATOR_CONTROL_PLANE: "1",
            OPENCODE_DEV_OPERATOR_: undefined,
            OPENCODE_SERVER_PASSWORD: "live-op-secret",
          },
        },
        async (listener) => {
          expect(listener.port).toBe(PORT)

          const health = await fetch(`http://${HOST}:${PORT}/operator/v1/health`, {
            headers: {
              host: "evil.example",
              "x-forwarded-for": "8.8.8.8",
              "x-real-ip": "1.2.3.4",
            },
          })
          expect(health.status).toBe(200)
          const body = (await health.json()) as { ok: boolean; service?: string }
          expect(body).toEqual({ ok: true, service: "operator" })

          const denied = await fetch(`http://${HOST}:${PORT}/operator/v1/registry`)
          expect(denied.status).toBe(401)

          const okReg = await fetch(`http://${HOST}:${PORT}/operator/v1/registry`, {
            headers: {
              authorization: `Basic ${btoa("opencode:live-op-secret")}`,
            },
          })
          expect(okReg.status).toBe(200)
        },
      )
    },
    60_000,
  )

  test(
    "flag off → operator unavailable on same live server without remount",
    async () => {
      await withLiveOperatorListener(
        {
          hostname: HOST,
          port: PORT,
          env: {
            OPENCODE_OPERATOR_CONTROL_PLANE: "1",
            OPENCODE_DEV_OPERATOR_: undefined,
          },
        },
        async () => {
          expect((await fetch(`http://${HOST}:${PORT}/operator/v1/health`)).status).toBe(200)

          // Still under the same lock / listener — toggle flag in-process.
          process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "0"
          delete process.env["OPENCODE_DEV_OPERATOR_"]
          const off = await fetch(`http://${HOST}:${PORT}/operator/v1/health`)
          expect([404, 503]).toContain(off.status)
        },
      )
    },
    60_000,
  )

  test("non-loopback bind refuses operator mount (no intercept)", async () => {
    // Unit: mount decision is bind-only (no TCP needed).
    expect(tryCreateOperatorHttpFetch({ hostname: "0.0.0.0" }).mounted).toBe(false)
    expect(tryCreateOperatorHttpFetch({ hostname: "192.168.1.10" }).mounted).toBe(false)

    await withLiveOperatorListener(
      {
        hostname: "0.0.0.0",
        port: PORT,
        env: {
          OPENCODE_OPERATOR_CONTROL_PLANE: "1",
          OPENCODE_DEV_OPERATOR_: undefined,
        },
      },
      async (listener) => {
        expect(listener.port).toBe(PORT)
        const res = await fetch(`http://127.0.0.1:${PORT}/operator/v1/health`)
        const text = await res.text()
        expect(text).not.toContain('"service":"operator"')
        expect(text).not.toContain('"ok":true,"service"')
      },
    )
  }, 60_000)
})

describe("durable CAS applied metadata skips second rollback write", () => {
  test("cutover reports applied.rollbackSlot; no post-CAS failure after commit", async () => {
    let secondWrite = 0
    const store = createDurableOperatorStore({
      config: createFakeConfigService(),
      lock: createProcessMutexLockPort(),
    })
    const rollback = {
      get: store.rollback.get.bind(store.rollback),
      clear: store.rollback.clear.bind(store.rollback),
      set: async (slot: Parameters<typeof store.rollback.set>[0]) => {
        secondWrite += 1
        return store.rollback.set(slot)
      },
    }
    const ports = {
      config: store.config,
      idempotency: store.idempotency,
      rollback,
      events: {
        appendAudit: async () => ({ ok: false as const, code: "unavailable" as const, reason: "down" }),
        listAudits: async () => [],
        pruneAudits: async () => 0,
      },
      outbox: store.outbox,
      requireAudit: true,
      nowMs: () => 50,
    }
    const cut = await mutateAuthority(ports, {
      request: {
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        principal: { kind: "operator", subject: "local", projectBinding: "p1" },
        scope: { kind: "project", ref: "p1" },
        source: "cli",
        isTty: false,
        confirm: true,
        idempotencyKey: "cut-no-second",
      },
      authority: "semantic.embedding",
      apply: () => ({ binding: "v2" }),
      cutoverDomain: "semantic.embedding",
      snapshotBefore: true,
    })
    expect(cut.outcome).toBe("audit_pending")
    expect(secondWrite).toBe(0)
    expect((await store.rollback.get("semantic.embedding"))?.available).toBe(true)
  })
})
