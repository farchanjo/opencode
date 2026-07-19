/**
 * Feature 013 / T012 — the real bounded `telemetry.test` OTLP reachability probe.
 *
 * Proves the environment-agnostic dial: an http endpoint that answers ANY HTTP
 * response resolves `reachable`; a refused/timed-out dial resolves `unreachable`
 * (bounded, never hangs); a grpc endpoint delegates to a bounded TCP dial. The probe
 * sends no telemetry signal content beyond an empty POST, carries no export header,
 * mutates nothing, and always resolves within the timeout (FR6, FR10). The absent /
 * malformed-endpoint `misconfigured` case is owned by the backend (no network I/O)
 * and covered in `telemetry-stack.test.ts`.
 */
import { EventEmitter } from "node:events"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createLiveTelemetryProbe } from "@/operator/telemetry/probe-live"
import type { ProbeTarget } from "@opencode-ai/protocol/telemetry/commands"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

const HTTP_TARGET: ProbeTarget = { transport: "http/protobuf", endpoint: "http://collector.internal:4318" }
const GRPC_TARGET: ProbeTarget = { transport: "grpc", endpoint: "https://collector.internal:4317" }

/** A fake TCP socket that emits `event` on the next tick, matching the node:net surface the probe uses. */
function fakeSocket(event: "connect" | "timeout" | "error") {
  const socket = new EventEmitter() as EventEmitter & {
    setTimeout: (ms: number) => void
    destroy: () => void
  }
  socket.setTimeout = () => {}
  socket.destroy = () => {}
  queueMicrotask(() => socket.emit(event))
  return socket
}

describe("T012 telemetry probe — http reachability", () => {
  test("an endpoint that answers any HTTP response is reachable, via an empty POST to /v1/metrics", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const probe = createLiveTelemetryProbe({
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return new Response("", { status: 415 })
      }) as unknown as typeof globalThis.fetch,
    })
    const result = await run(probe.dial(HTTP_TARGET))
    expect(result.reachable).toBe(true)
    expect(calls[0]?.url).toBe("http://collector.internal:4318/v1/metrics")
    expect(calls[0]?.init?.method).toBe("POST")
    // No telemetry signal content beyond an empty body; no export headers carried.
    expect(calls[0]?.init?.body).toBe("")
    expect(calls[0]?.init?.headers).toBeUndefined()
  })

  test("a refused connection resolves unreachable, never throws", async () => {
    const probe = createLiveTelemetryProbe({
      fetch: (async () => {
        throw new Error("connect ECONNREFUSED")
      }) as unknown as typeof globalThis.fetch,
    })
    const result = await run(probe.dial(HTTP_TARGET))
    expect(result.reachable).toBe(false)
    expect(result.reason).toBe("endpoint refused or unreachable")
  })

  test("a slow endpoint is bounded by the timeout and resolves unreachable (never blocks the loop)", async () => {
    const probe = createLiveTelemetryProbe({
      timeoutMs: 5,
      fetch: ((_url: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        })) as unknown as typeof globalThis.fetch,
    })
    const result = await run(probe.dial(HTTP_TARGET))
    expect(result.reachable).toBe(false)
    expect(result.reason).toContain("timed out")
  })
})

describe("T012 telemetry probe — grpc TCP dial", () => {
  test("a completed TCP handshake is reachable", async () => {
    const probe = createLiveTelemetryProbe({ connect: () => fakeSocket("connect") as never })
    const result = await run(probe.dial(GRPC_TARGET))
    expect(result.reachable).toBe(true)
  })

  test("a refused TCP dial resolves unreachable", async () => {
    const probe = createLiveTelemetryProbe({ connect: () => fakeSocket("error") as never })
    const result = await run(probe.dial(GRPC_TARGET))
    expect(result.reachable).toBe(false)
    expect(result.reason).toBe("endpoint refused or unreachable")
  })

  test("a TCP timeout resolves unreachable, bounded", async () => {
    const probe = createLiveTelemetryProbe({ connect: () => fakeSocket("timeout") as never })
    const result = await run(probe.dial(GRPC_TARGET))
    expect(result.reachable).toBe(false)
    expect(result.reason).toContain("timed out")
  })
})
