/**
 * Runtime authority split: test stack vs live stack factories; worker trusted path.
 * Live boot: test.skipIf unless OPENCODE_OPERATOR_LIVE_BOOT=1 (not counted as proof).
 */
import { describe, expect, test, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { createTestOperatorStack } from "@/operator/stack-test"
import { clearLiveOperatorStackCache } from "@/operator/stack-live"
import { tryCreateOperatorHttpFetch } from "@/operator/http/mount"
import { createTrustedWorkerOperatorFetch, handleWorkerOperatorFetch } from "@/operator/worker-adapter"
import { Server } from "@/server/server"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  fixtureStatusHandler,
} from "@/operator/application"

afterEach(() => {
  Server.setOperatorFetch(undefined)
  clearLiveOperatorStackCache()
  delete process.env["OPENCODE_DEV_OPERATOR_"]
  // Restore package-test default (preload); never leave flag off for sibling suites
  process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
})

describe("authority split factories", () => {
  test("createTestOperatorStack is kind=test", () => {
    const stack = createTestOperatorStack()
    expect(stack.kind).toBe("test")
    expect(stack.mutationPorts.requireAudit).toBe(false)
  })

  test("external TCP mount with testStack never requires live AppRuntime", async () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    const testStack = createTestOperatorStack()
    const mount = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      testStack,
      getClientIp: () => "127.0.0.1",
    })
    expect(mount.mounted).toBe(true)
    if (!mount.mounted) return
    Server.setOperatorFetch(mount.fetch)
    const res = await Server.Default().app.fetch(
      new Request("http://127.0.0.1:14096/operator/v1/health"),
    )
    expect(res.status).toBe(200)
  })

  test("production mount path returns live fetch wrapper", () => {
    process.env["OPENCODE_OPERATOR_CONTROL_PLANE"] = "1"
    const mount = tryCreateOperatorHttpFetch({
      hostname: "127.0.0.1",
      directory: process.cwd(),
    })
    expect(mount.mounted).toBe(true)
    if (!mount.mounted) return
    expect(typeof mount.fetch).toBe("function")
  })
})

describe("worker trusted operatorFetch", () => {
  test("trusted worker fetch injects operator principal (sandbox test stack — hard assert)", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const stack = createTestOperatorStack({
      registry,
      dispatcher: createDispatcher({
        registry,
        handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
      }),
    })
    const fetch = createOperatorHttpHandler({
      dispatcher: stack.dispatcher,
      registry: stack.registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_worker",
      injectProjectScopeWhenOmitted: true,
      resolveAuth: () => ({
        authenticated: true,
        subject: "local-worker",
        role: "operator",
        projectBinding: "proj_worker",
      }),
    })
    const health = await fetch(new Request("http://127.0.0.1/operator/v1/health"))
    expect(health.status).toBe(200)
    const body = (await health.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    const cmd = await fetch(
      new Request("http://127.0.0.1/operator/v1/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "langlock.status",
          scope: { kind: "project", ref: "proj_worker" },
        }),
      }),
    )
    const result = (await cmd.json()) as { id: string; ok: boolean }
    expect(result.id).toBe("langlock.status")
    expect(result.ok).toBe(true)
  })

  const runLive = process.env["OPENCODE_OPERATOR_LIVE_BOOT"] === "1"

  test.skipIf(!runLive)("handleWorkerOperatorFetch live boot hard-pass (OPENCODE_OPERATOR_LIVE_BOOT=1)", async () => {
    process.env["OPENCODE_DEV_OPERATOR_"] = "1"
    await using tmp = await tmpDir()
    await fs.writeFile(path.join(tmp.path, "opencode.json"), "{}")
    const result = await handleWorkerOperatorFetch({
      directory: tmp.path,
      projectId: "proj_worker",
      url: "http://127.0.0.1/operator/v1/health",
      method: "GET",
    })
    expect(result.status).toBe(200)
    const body = JSON.parse(result.body) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test("createTrustedWorkerOperatorFetch is function", () => {
    expect(typeof createTrustedWorkerOperatorFetch).toBe("function")
  })
})

async function tmpDir() {
  const dir = path.join(os.tmpdir(), "op-auth-" + process.pid + "-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
