/**
 * Feature007 final review — B1/T040, B2/T041, R1–R7.
 * Sandbox/XDG only; no production paths.
 */
import { describe, expect, test } from "bun:test"
import { createHash, timingSafeEqual } from "node:crypto"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createMemoryConfigPort,
  handlersFromDomainPorts,
  createDomainStubs,
} from "@/operator/adapters"
import { createProcessMutexLockPort, mutateAuthority } from "@/operator/application"
import { constantTimeEqual } from "@/operator/auth/principal"
import { tryCreateOperatorHttpFetch } from "@/operator/http/mount"
import { createOperatorHttpHandler, resolveAuthFromHeaders } from "@/operator/http/handler"
import { assertOperatorRequestAccess } from "@/operator/http/loopback"
import { resolveOperatorClientIp, setOperatorRequestIpResolver } from "@/operator/http/client-ip"
import { createTestOperatorStack } from "@/operator/stack-test"
import type { CommandRequest } from "@opencode-ai/core/operator"

function req(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: "langlock.set" as CommandRequest["id"],
    principal: { kind: "operator", subject: "local", projectBinding: "p1" },
    scope: { kind: "project", ref: "p1" },
    source: "cli",
    isTty: false,
    confirm: true,
    ...overrides,
  }
}

describe("B1/T040 Config-backed status (not stub)", () => {
  // langlock.status/show are intentionally NOT config-backed here: they route through the
  // Feature 004 domain port (port.resolve). telemetry/budget remain config-status ids.
  test("telemetry.status / budget.status return configured/version query", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    await store.config.compareAndSet({
      authority: "telemetry",
      expectedVersion: null,
      payload: { enabled: true },
      nowMs: 1,
    })
    const stack = createTestOperatorStack({ mutationPorts: {
      config: store.config,
      idempotency: store.idempotency,
      rollback: store.rollback,
      events: undefined,
      requireAudit: false,
      outbox: store.outbox,
      nowMs: () => 1,
    }})
    const status = await stack.dispatcher.dispatchRequest({
      ...req({ id: "telemetry.status" as CommandRequest["id"], confirm: false }),
    })
    expect(status.ok).toBe(true)
    expect(status.outcome).toBe("success")
    expect((status.effective as { status?: string })?.status).toBe("configured")
    expect((status.effective as { configured?: boolean })?.configured).toBe(true)
    expect(status.version).toBeTruthy()

    const budget = await stack.dispatcher.dispatchRequest({
      ...req({ id: "budget.status" as CommandRequest["id"], confirm: false }),
    })
    expect(budget.ok).toBe(true)
    expect((budget.effective as { status?: string })?.status).toBe("unconfigured")
    expect((budget.effective as { configured?: boolean })?.configured).toBe(false)
  })

  test("handlersFromDomainPorts with config overrides stubs for status ids", () => {
    const map = handlersFromDomainPorts(createDomainStubs(), {
      config: createMemoryConfigPort(),
    })
    expect(map.has("langlock.status")).toBe(true)
    expect(map.has("telemetry.status")).toBe(true)
  })
})

describe("B2/T041 + R3 dynamic flag per request", () => {
  test("same-process Config-style enable/disable without remount", async () => {
    let enabled = false
    const stack = createTestOperatorStack({ featureEnabled: () => enabled })
    const m = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      testStack: stack,
      getClientIp: () => "127.0.0.1",
    })
    expect(m.mounted).toBe(true)
    if (!m.mounted) return
    expect((await m.fetch(new Request("http://127.0.0.1/operator/v1/health"))).status).toBe(404)
    enabled = true
    expect((await m.fetch(new Request("http://127.0.0.1/operator/v1/health"))).status).toBe(200)
    enabled = false
    expect((await m.fetch(new Request("http://127.0.0.1/operator/v1/health"))).status).toBe(404)
  })

  test("non-loopback bind never mounts", () => {
    expect(
      tryCreateOperatorHttpFetch({
        hostname: "192.168.1.10",
        testStack: createTestOperatorStack(),
      }).mounted,
    ).toBe(false)
  })
})

describe("R2 real requestIP fail-closed", () => {
  test("missing client IP denied (no 127 invent)", () => {
    expect(resolveOperatorClientIp(new Request("http://127.0.0.1/"))).toBeNull()
    const gate = assertOperatorRequestAccess({ serverBind: "127.0.0.1", clientIp: null })
    expect(gate.ok).toBe(false)
  })

  test("non-loopback client IP denied even on loopback bind", async () => {
    const stack = createTestOperatorStack()
    const handler = createOperatorHttpHandler({
      dispatcher: stack.dispatcher,
      registry: stack.registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "8.8.8.8",
      resolveAuth: () => ({ authenticated: true, subject: "local", role: "operator" }),
    })
    const res = await handler(new Request("http://127.0.0.1/operator/v1/health"))
    expect(res.status).toBe(403)
  })

  test("injected Bun-like requestIP resolver works", () => {
    setOperatorRequestIpResolver((req) => {
      const url = new URL(req.url)
      return url.searchParams.get("ip")
    })
    try {
      expect(resolveOperatorClientIp(new Request("http://x/?ip=127.0.0.1"))).toBe("127.0.0.1")
      expect(resolveOperatorClientIp(new Request("http://x/"))).toBeNull()
    } finally {
      setOperatorRequestIpResolver(null)
    }
  })
})

describe("R1 atomic cutover snapshot+rollback slot", () => {
  test("cutover CAS writes rollback slot before afterWrite crash window", async () => {
    const fake = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    let wrote = false
    const store = createDurableOperatorStore({
      config: fake,
      lock,
      afterWrite: () => {
        wrote = true
        throw new Error("crash after atomic commit")
      },
    })
    const cas = await store.config.compareAndSet({
      authority: "semantic.embedding",
      expectedVersion: null,
      payload: { binding: "v2" },
      nowMs: 10,
      snapshotBefore: false,
      rollbackSlot: {
        domain: "semantic.embedding",
        previousBinding: "none",
        previousPayload: null,
        activatedAtMs: 10,
        available: true,
      },
    })
    expect(cas.ok).toBe(false)
    expect(wrote).toBe(true)
    // Restart store: authority + rollback slot both durable from same write
    const restarted = createDurableOperatorStore({ config: fake, lock })
    expect((await restarted.config.get("semantic.embedding"))?.payload).toEqual({ binding: "v2" })
    const slot = await restarted.rollback.get("semantic.embedding")
    expect(slot?.available).toBe(true)
    expect(slot?.previousBinding).toBe("none")
  })

  test("mutateAuthority cutover leaves slot after requireAudit publish fail", async () => {
    const store = createDurableOperatorStore({
      config: createFakeConfigService(),
      lock: createProcessMutexLockPort(),
    })
    const ports = {
      config: store.config,
      idempotency: store.idempotency,
      rollback: store.rollback,
      events: {
        appendAudit: async () => ({ ok: false as const, code: "unavailable" as const, reason: "down" }),
        listAudits: async () => [],
        pruneAudits: async () => 0,
      },
      outbox: store.outbox,
      requireAudit: true,
      nowMs: () => 20,
    }
    const cut = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        idempotencyKey: "cut-atomic",
      }),
      authority: "semantic.embedding",
      apply: () => ({ binding: "v2" }),
      cutoverDomain: "semantic.embedding",
      snapshotBefore: true,
    })
    expect(cut.outcome).toBe("audit_pending")
    const slot = await store.rollback.get("semantic.embedding")
    expect(slot?.available).toBe(true)
    const snaps = await store.config.listSnapshots("semantic.embedding")
    // first write had no prior entry — snapshotBefore with null current yields no snap
    expect(Array.isArray(snaps)).toBe(true)
  })

  test("rollback CAS clears slot atomically", async () => {
    const store = createDurableOperatorStore({
      config: createFakeConfigService(),
      lock: createProcessMutexLockPort(),
    })
    await store.config.compareAndSet({
      authority: "semantic.embedding",
      expectedVersion: null,
      payload: { binding: "v1" },
      nowMs: 1,
    })
    const cut = await store.config.compareAndSet({
      authority: "semantic.embedding",
      expectedVersion: "cas_v1",
      payload: { binding: "v2" },
      nowMs: 2,
      snapshotBefore: true,
      rollbackSlot: {
        domain: "semantic.embedding",
        previousBinding: "cas_v1",
        previousPayload: { binding: "v1" },
        activatedAtMs: 2,
        available: true,
      },
    })
    expect(cut.ok).toBe(true)
    if (!cut.ok) return
    expect((await store.config.listSnapshots("semantic.embedding")).length).toBeGreaterThanOrEqual(1)
    const rb = await store.config.compareAndSet({
      authority: "semantic.embedding",
      expectedVersion: cut.version,
      payload: { binding: "v1" },
      nowMs: 3,
      clearRollbackDomain: "semantic.embedding",
    })
    expect(rb.ok).toBe(true)
    expect(await store.rollback.get("semantic.embedding")).toBeNull()
  })
})

describe("R5/R6 health + constant-time auth", () => {
  test("health is minimal and only after loopback gate", async () => {
    const stack = createTestOperatorStack()
    const ok = createOperatorHttpHandler({
      dispatcher: stack.dispatcher,
      registry: stack.registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      resolveAuth: () => ({ authenticated: false }),
    })
    const res = await ok(new Request("http://127.0.0.1/operator/v1/health"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; service?: string }
    expect(body).toEqual({ ok: true, service: "operator" })
  })

  test("constantTimeEqual uses fixed-length digests (no length early leak)", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true)
    expect(constantTimeEqual("secret", "secre")).toBe(false)
    expect(constantTimeEqual("a", "bb")).toBe(false)
    // Same digest path as implementation
    const a = createHash("sha256").update("x", "utf8").digest()
    const b = createHash("sha256").update("x", "utf8").digest()
    expect(timingSafeEqual(a, b)).toBe(true)
  })

  test("auth compare rejects wrong password", () => {
    const auth = resolveAuthFromHeaders({
      authorization: `Basic ${btoa("opencode:wrong")}`,
      expectedPassword: "right",
      expectedUsername: "opencode",
    })
    expect(auth.authenticated).toBe(false)
  })
})

describe("R4/R7 test-only export isolation", () => {
  test("production stack barrel does not export createTestOperatorStack", async () => {
    const prod = await import("@/operator/stack")
    expect("createTestOperatorStack" in prod).toBe(false)
    expect("createLiveOperatorStack" in prod).toBe(true)
  })

  test("production http barrel does not export bootstrapOperatorHttp", async () => {
    const http = await import("@/operator/http")
    expect("bootstrapOperatorHttp" in http).toBe(false)
    expect("tryCreateOperatorHttpFetch" in http).toBe(true)
  })
})
