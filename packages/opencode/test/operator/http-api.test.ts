/**
 * T025–T028 operator HTTP contract tests (review-fix pass).
 */
import { describe, expect, test, afterEach } from "bun:test"
import { bootstrapOperatorHttp } from "@/operator/http/bootstrap"
import {
  assertOperatorBind,
  assertOperatorRequestAccess,
  assertOriginPolicy,
  isLoopbackHost,
} from "@/operator/http/loopback"
import { bindOperatorPrincipal } from "@/operator/auth/principal"
import { createOperatorClient } from "../../../sdk/js/src/operator/client"
import { listReservedIds, RESERVED_CATALOG_VERSION } from "@opencode-ai/core/operator"
import { createProcessMutexLockPort, mutateAuthority, type MutationPorts } from "@/operator/application"
import { createDurableOperatorStore, createFakeConfigService, createMemoryOutboxPort } from "@/operator/adapters"
import type { CommandRequest } from "@opencode-ai/core/operator"
import { Server } from "@/server/server"
import { tryCreateOperatorHttpFetch, isOperatorHttpEnabled } from "@/operator/http/mount"
import { createTestOperatorStack } from "@/operator/stack-test"

const PASS = "op-test-secret"
const authHeader = `Basic ${btoa(`opencode:${PASS}`)}`

function url(path: string, host = "127.0.0.1") {
  return `http://${host}:14096${path}`
}

afterEach(() => {
  Server.setOperatorFetch(undefined)
  delete process.env["OPENCODE_DEV_OPERATOR_"]
  // restore package test default (preload sets this for operator suites)
  process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
})

describe("T025 mount + Server.Default intercept", () => {
  test("tryCreateOperatorHttpFetch mounts on loopback only (flag is per-request)", async () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    expect(isOperatorHttpEnabled()).toBe(true)
    const ok = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      testStack: createTestOperatorStack(),
    })
    expect(ok.mounted).toBe(true)
    if (ok.mounted) Server.setOperatorFetch(ok.fetch)

    const denied = tryCreateOperatorHttpFetch({ hostname: "0.0.0.0" })
    expect(denied.mounted).toBe(false)

    // Flag off: still mounted on loopback; request returns unavailable/404
    delete process.env["OPENCODE_OPERATOR_CONTROL_PLANE"]
    delete process.env["OPENCODE_DEV_OPERATOR_"]
    let enabled = false
    const off = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      testStack: createTestOperatorStack({ featureEnabled: () => enabled }),
    })
    expect(off.mounted).toBe(true)
    if (off.mounted) {
      expect((await off.fetch(new Request(url("/operator/v1/health")))).status).toBe(404)
      enabled = true
      expect((await off.fetch(new Request(url("/operator/v1/health")))).status).toBe(200)
    }
    // restore package test default
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
  })

  test("Server.Default.app.fetch routes /operator/v1 when mounted", async () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    const mount = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      testStack: createTestOperatorStack(),
    })
    expect(mount.mounted).toBe(true)
    if (!mount.mounted) return
    Server.setOperatorFetch(mount.fetch)

    const res = await Server.Default().app.fetch(new Request(url("/operator/v1/health")))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; service: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe("operator")
  })

  test("Server.Default returns 404 for operator when not mounted", async () => {
    Server.setOperatorFetch(undefined)
    const res = await Server.Default().app.fetch(new Request(url("/operator/v1/health")))
    expect(res.status).toBe(404)
  })
})

describe("T025 loopback authority (no Host/header trust)", () => {
  test("Host spoof does not grant access when clientIp non-loopback", async () => {
    const { fetch } = bootstrapOperatorHttp({
      expectedPassword: PASS,
      serverBind: "127.0.0.1",
      clientIp: "8.8.8.8",
    })
    const res = await fetch(new Request(url("/operator/v1/health", "127.0.0.1")))
    expect(res.status).toBe(403)
  })

  test("X-Forwarded-For ignored; loopback clientIp allows", async () => {
    const { fetch } = bootstrapOperatorHttp({
      expectedPassword: PASS,
      serverBind: "127.0.0.1",
      clientIp: "127.0.0.1",
    })
    const res = await fetch(
      new Request(url("/operator/v1/health"), {
        headers: { "x-forwarded-for": "8.8.8.8", "x-opencode-socket-host": "evil.com" },
      }),
    )
    expect(res.status).toBe(200)
  })

  test("non-loopback serverBind never serves (404)", async () => {
    const { fetch } = bootstrapOperatorHttp({
      expectedPassword: PASS,
      serverBind: "0.0.0.0",
      clientIp: "127.0.0.1",
    })
    const res = await fetch(new Request(url("/operator/v1/health")))
    expect(res.status).toBe(404)
  })

  test("assertOperatorRequestAccess uses bind+clientIp only", () => {
    expect(assertOperatorRequestAccess({ serverBind: "127.0.0.1", clientIp: "127.0.0.1" }).ok).toBe(true)
    expect(assertOperatorRequestAccess({ serverBind: "0.0.0.0", clientIp: "127.0.0.1" }).ok).toBe(false)
    expect(assertOperatorRequestAccess({ serverBind: "127.0.0.1", clientIp: "10.0.0.1" }).ok).toBe(false)
    expect(assertOperatorBind("0.0.0.0").ok).toBe(false)
    expect(isLoopbackHost("127.0.0.1")).toBe(true)
  })
})

describe("T025 routes + body contract", () => {
  test("health minimal; registry auth; no password ⇒ deny", async () => {
    const noPass = bootstrapOperatorHttp({ serverBind: "127.0.0.1" })
    const regDenied = await noPass.fetch(
      new Request(url("/operator/v1/registry"), { headers: { authorization: authHeader } }),
    )
    expect(regDenied.status).toBe(401)

    const { fetch } = bootstrapOperatorHttp({ expectedPassword: PASS })
    expect((await fetch(new Request(url("/operator/v1/health")))).status).toBe(200)

    const denied = await fetch(new Request(url("/operator/v1/registry")))
    expect(denied.status).toBe(401)

    const ok = await fetch(new Request(url("/operator/v1/registry"), { headers: { authorization: authHeader } }))
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ids: string[]; catalogVersion: string }
    expect(body.ids.length).toBe(listReservedIds().length)
    expect(body.catalogVersion).toBe(RESERVED_CATALOG_VERSION)
  })

  test("missing scope is invalid; body principal rejected", async () => {
    const { fetch } = bootstrapOperatorHttp({ expectedPassword: PASS, projectId: "proj_a" })
    const noScope = await fetch(
      new Request(url("/operator/v1/commands"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({ id: "langlock.status" }),
      }),
    )
    expect(noScope.status).toBe(400)

    const withPrincipal = await fetch(
      new Request(url("/operator/v1/commands"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({
          id: "langlock.status",
          principal: { kind: "operator", subject: "x", projectBinding: "evil" },
          scope: { kind: "project", ref: "proj_a" },
        }),
      }),
    )
    expect(withPrincipal.status).toBe(400)
  })

  test("cross-project scope denied when projectId bound", async () => {
    const { fetch } = bootstrapOperatorHttp({
      expectedPassword: PASS,
      projectId: "proj_a",
    })
    const res = await fetch(
      new Request(url("/operator/v1/commands"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({
          id: "langlock.status",
          scope: { kind: "project", ref: "proj_b" },
        }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test("malformed scope rejected", async () => {
    const { fetch } = bootstrapOperatorHttp({ expectedPassword: PASS })
    const res = await fetch(
      new Request(url("/operator/v1/commands"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({ id: "langlock.status", scope: { kind: "project", ref: null } }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe("T026 auth", () => {
  test("LLM role denied; manager-view mutation denied", async () => {
    const { fetch } = bootstrapOperatorHttp({ expectedPassword: PASS, forceRole: "llm" })
    const res = await fetch(
      new Request(url("/operator/v1/commands"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: authHeader },
        body: JSON.stringify({
          id: "langlock.set",
          scope: { kind: "project", ref: "p1" },
          idempotencyKey: "llm1",
        }),
      }),
    )
    expect(res.status).toBe(401)

    expect(
      bindOperatorPrincipal({ auth: { authenticated: true, subject: "v", role: "manager-view" }, mutates: true }).ok,
    ).toBe(false)
    expect(
      bindOperatorPrincipal({ auth: { authenticated: true, subject: "v", role: "manager-view" }, mutates: false }).ok,
    ).toBe(true)
  })
})

describe("T028 origin", () => {
  test("non-loopback Origin rejected on POST; loopback ok", () => {
    expect(assertOriginPolicy({ method: "POST", origin: "https://evil.example" }).ok).toBe(false)
    expect(assertOriginPolicy({ method: "POST", origin: "http://127.0.0.1:14096" }).ok).toBe(true)
    expect(assertOriginPolicy({ method: "POST", origin: null }).ok).toBe(true)
  })
})

describe("T027 SDK client + catalog parity", () => {
  test("client against bootstrap; catalog ids match core", async () => {
    const { fetch } = bootstrapOperatorHttp({ expectedPassword: PASS })
    const client = createOperatorClient({
      baseUrl: "http://127.0.0.1:14096",
      authorization: authHeader,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(new Request(input, init))) as typeof globalThis.fetch,
    })
    expect((await client.health()).ok).toBe(true)
    const reg = await client.registry()
    expect(reg.ids?.length).toBe(listReservedIds().length)
    const cmd = await client.command({
      id: "langlock.status",
      scope: { kind: "project", ref: "p1" },
    })
    expect(cmd.kind).toBe("operator.admin_result")
  })
})

describe("audit_pending", () => {
  test("publish fail after CAS → audit_pending 202 semantics + stable replay", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    let fail = true
    const ports: MutationPorts = {
      config: store.config,
      idempotency: store.idempotency,
      requireAudit: true,
      events: {
        appendAudit: async () => {
          if (fail) {
            fail = false
            return { ok: false, code: "unavailable", reason: "down" }
          }
          return { ok: true, auditId: "evt_ok" }
        },
        listAudits: async () => [],
        pruneAudits: async () => 0,
      },
      outbox: createMemoryOutboxPort(),
    }
    const request = {
      id: "langlock.set" as CommandRequest["id"],
      principal: { kind: "operator" as const, subject: "local", projectBinding: null },
      scope: { kind: "project" as const, ref: "p1" },
      source: "api" as const,
      isTty: false,
      confirm: false,
      idempotencyKey: "ap-1",
    }
    const r1 = await mutateAuthority(ports, {
      request,
      authority: "langlock",
      apply: () => ({ language: "en" }),
    })
    expect(r1.outcome).toBe("audit_pending")
    expect(r1.ok).toBe(true)
    expect(r1.version).toBeTruthy()

    const r2 = await mutateAuthority(ports, {
      request: { ...request, version: r1.version },
      authority: "langlock",
      apply: () => ({ language: "no" }),
    })
    expect(r2.outcome).toBe("idempotent_replay")
    expect(r2.version).toBe(r1.version)
  })
})
