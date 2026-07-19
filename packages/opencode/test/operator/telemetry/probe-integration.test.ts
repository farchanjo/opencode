/**
 * Feature 013 / T017 — the `telemetry.test` reachability probe over REAL loopback.
 *
 * Complements the mocked `probe-live.test.ts` (T012) with a deterministic,
 * loopback-only integration pass — NO external network is ever contacted:
 *
 *   - reachable: a real http listener bound to `127.0.0.1:0` answers the empty POST
 *     to `/v1/metrics` → `reachable`; the probe carries no export header and sends no
 *     telemetry signal content (Feature 007 FR30).
 *   - unreachable: a port that was opened then closed (guaranteed refused) resolves
 *     `unreachable`, bounded by the timeout, and never hangs (FR6, FR10).
 *   - grpc: a real TCP listener → `reachable`; a closed TCP port → `unreachable`.
 *   - the backend routes a valid endpoint to the probe and threads its outcome into
 *     the typed `ProbeResult` (end-to-end over the effective config, no mutation).
 *
 * Note on `misconfigured`: the shipped `Telemetry.EndpointUrl` schema pattern-guards
 * every persisted endpoint to `^https?://`, and `resolveEffectiveTelemetryConfig`
 * falls back to the valid default, so the backend's `misconfigured` branch is not
 * reachable through a real config (reported for T021). The guard IS still exercised:
 * a valid endpoint is always dialed, never short-circuited.
 */
import net from "node:net"
import { afterAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createLiveTelemetryBackend } from "@/operator/telemetry/backend-live"
import { createLiveTelemetryProbe } from "@/operator/telemetry/probe-live"
import type { ProbeTarget } from "@opencode-ai/protocol/telemetry/commands"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

/** A real loopback http listener; records the probe requests it receives. */
function startHttpCollector() {
  const requests: { path: string; method: string; body: string; authorization: string | null }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      requests.push({
        path: url.pathname,
        method: req.method,
        body: await req.text(),
        authorization: req.headers.get("authorization"),
      })
      return new Response("", { status: 200 })
    },
  })
  return { requests, endpoint: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

/** A real loopback TCP listener (grpc dial target). */
function startTcpListener(): Promise<{ endpoint: string; stop: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end())
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo
      resolve({ endpoint: `http://127.0.0.1:${address.port}`, stop: () => server.close() })
    })
  })
}

/** Bind a port to learn it is free, then release it — a subsequent dial is guaranteed refused. */
function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

const servers: (() => void)[] = []
afterAll(() => {
  for (const stop of servers) stop()
})

describe("T017 telemetry probe — http reachability over real loopback", () => {
  test("a live local collector answers the empty probe → reachable, with no signal content or header", async () => {
    const collector = startHttpCollector()
    servers.push(collector.stop)
    const probe = createLiveTelemetryProbe({ timeoutMs: 2000 })
    const target: ProbeTarget = { transport: "http/protobuf", endpoint: collector.endpoint }

    const result = await run(probe.dial(target))
    expect(result.reachable).toBe(true)

    expect(collector.requests.length).toBe(1)
    const seen = collector.requests[0]!
    expect(seen.path).toBe("/v1/metrics")
    expect(seen.method).toBe("POST")
    // Test-signal only: no telemetry payload, and no export credential ever leaves the seam.
    expect(seen.body).toBe("")
    expect(seen.authorization).toBeNull()
  })

  test("a closed port resolves unreachable, bounded, never throwing", async () => {
    const port = await closedPort()
    const probe = createLiveTelemetryProbe({ timeoutMs: 1500 })
    const target: ProbeTarget = { transport: "http/protobuf", endpoint: `http://127.0.0.1:${port}` }

    const result = await run(probe.dial(target))
    expect(result.reachable).toBe(false)
    expect(typeof result.reason).toBe("string")
  })
})

describe("T017 telemetry probe — grpc TCP dial over real loopback", () => {
  test("a live local TCP listener completes the handshake → reachable", async () => {
    const listener = await startTcpListener()
    servers.push(listener.stop)
    const probe = createLiveTelemetryProbe({ timeoutMs: 2000 })
    const result = await run(probe.dial({ transport: "grpc", endpoint: listener.endpoint }))
    expect(result.reachable).toBe(true)
  })

  test("a closed TCP port resolves unreachable, bounded", async () => {
    const port = await closedPort()
    const probe = createLiveTelemetryProbe({ timeoutMs: 1500 })
    const result = await run(probe.dial({ transport: "grpc", endpoint: `http://127.0.0.1:${port}` }))
    expect(result.reachable).toBe(false)
  })
})

describe("T017 telemetry backend — end-to-end test() routes a valid endpoint to the probe", () => {
  test("backend.test dials the configured endpoint and threads the reachable outcome, mutating nothing", async () => {
    const collector = startHttpCollector()
    servers.push(collector.stop)
    const config = createMemoryConfigPort()
    const backend = createLiveTelemetryBackend({
      config,
      probe: createLiveTelemetryProbe({ timeoutMs: 2000 }),
    })
    // Configure a valid loopback endpoint so the effective config resolves it —
    // commit the validated mutation plan directly (the dispatcher's role in production).
    const cfgPlan = await run(
      backend.planConfigure({
        transport: "http/protobuf",
        endpoint: collector.endpoint,
        expectedVersion: "cas_v0",
        principal: { kind: "operator", id: "operator:root" },
      }),
    )
    await config.compareAndSet({ authority: "global:telemetry", expectedVersion: null, payload: cfgPlan.apply(null), nowMs: Date.now() })

    const result = await run(backend.test())
    expect(result.outcome).toBe("reachable")
    expect(result.target.endpoint).toBe(collector.endpoint)
    expect(collector.requests.some((r) => r.path === "/v1/metrics")).toBe(true)
  })

  test("backend.test degrades to unreachable when the configured endpoint is refused (bounded)", async () => {
    const port = await closedPort()
    const config = createMemoryConfigPort()
    const backend = createLiveTelemetryBackend({ config, probe: createLiveTelemetryProbe({ timeoutMs: 1500 }) })
    const cfgPlan = await run(
      backend.planConfigure({
        transport: "http/protobuf",
        endpoint: `http://127.0.0.1:${port}`,
        expectedVersion: "cas_v0",
        principal: { kind: "operator", id: "operator:root" },
      }),
    )
    await config.compareAndSet({ authority: "global:telemetry", expectedVersion: null, payload: cfgPlan.apply(null), nowMs: Date.now() })
    const result = await run(backend.test())
    expect(result.outcome).toBe("unreachable")
  })
})
