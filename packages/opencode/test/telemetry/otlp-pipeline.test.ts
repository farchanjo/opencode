/**
 * Feature 001 / T037 + T039 — telemetry export pipeline verification.
 *
 * Stands up an in-process loopback HTTP server as the OTLP sink (never an
 * external service) and drives the real OtlpAdapter offer -> bounded queue ->
 * flush -> HTTP transport path end to end. Asserts the pipeline (a) delivers
 * batched signals to the endpoint, (b) strips prompts/secrets/file paths so the
 * exported labels are content-free (T039 "content-free OTEL labels"), and (c)
 * reports connectivity honestly against a live and a dead endpoint.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createMemorySecretPort } from "@/operator/adapters"
import { DEFAULT_TELEMETRY_CONFIG, REDACTED } from "@/routing/application/telemetry-service"
import { createOtlpAdapter, type OtlpTransport, type TelemetrySignal } from "@/routing/adapters/outbound/otlp-adapter"

interface LoopbackSink {
  readonly url: string
  readonly batches: TelemetrySignal[][]
  readonly probes: number
  stop(): void
}

/** In-process loopback OTLP sink: POST /v1/signals collects batches, GET /health probes. */
function startLoopbackSink(): LoopbackSink {
  const batches: TelemetrySignal[][] = []
  let probes = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)
      if (req.method === "GET" && pathname === "/health") {
        probes++
        return new Response("ok", { status: 200 })
      }
      if (req.method === "POST" && pathname === "/v1/signals") {
        const body = (await req.json()) as TelemetrySignal[]
        batches.push(body)
        return new Response(null, { status: 202 })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    batches,
    get probes() {
      return probes
    },
    stop: () => server.stop(true),
  }
}

/** A real HTTP transport that ships drained batches to the loopback sink. */
function httpTransport(baseUrl: string): OtlpTransport {
  return {
    async send(batch) {
      try {
        const res = await fetch(`${baseUrl}/v1/signals`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
        })
        return res.ok ? { ok: true, reason: null } : { ok: false, reason: `status ${res.status}` }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "send failed" }
      }
    },
    async probe() {
      try {
        const res = await fetch(`${baseUrl}/health`, { method: "GET" })
        return res.ok ? { ok: true, reason: null } : { ok: false, reason: `status ${res.status}` }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "probe failed" }
      }
    },
  }
}

function enabledConfig(baseUrl: string): typeof DEFAULT_TELEMETRY_CONFIG {
  return {
    ...DEFAULT_TELEMETRY_CONFIG,
    enabled: true,
    export: { ...DEFAULT_TELEMETRY_CONFIG.export, endpoint: baseUrl },
    signals: { metrics: true, logs: true, traces: true, profiling: false },
    queue: { ...DEFAULT_TELEMETRY_CONFIG.queue, capacity: 16, batch_size: 8 },
  }
}

let sink: LoopbackSink | null = null
afterEach(() => {
  sink?.stop()
  sink = null
})

describe("T037 OTLP export pipeline over loopback HTTP", () => {
  test("flush delivers batched, content-free signals to the live endpoint", async () => {
    sink = startLoopbackSink()
    const adapter = createOtlpAdapter({
      config: enabledConfig(sink.url),
      secret: createMemorySecretPort(),
      transport: httpTransport(sink.url),
    })

    // Offer signals whose attributes carry user content + secrets + a bounded
    // routing label; only the bounded label may survive redaction.
    adapter.offer({
      kind: "traces",
      name: "routing.evaluate",
      attributes: {
        prompt: "the raw user prompt that must never be exported",
        apiKey: "sk-live-must-not-leak",
        homePath: "/Users/someone/private/notes.txt",
        "routing.task_class": "small",
      },
    })
    adapter.offer({ kind: "logs", name: "task.execute", attributes: { "routing.hierarchy_role": "worker" } })

    const out = await adapter.flush()
    expect(out.flushed).toBe(2)
    expect(out.discarded).toBe(0)

    expect(sink.batches.length).toBe(1)
    const delivered = sink.batches[0]
    expect(delivered.length).toBe(2)

    const trace = delivered.find((s) => s.name === "routing.evaluate")!
    // Content-free: prompt + secret keys are fully redacted; a personal path has
    // its username stripped so no user-identifying prefix ever leaves the process.
    expect(trace.attributes.prompt).toBe(REDACTED)
    expect(trace.attributes.apiKey).toBe(REDACTED)
    expect(String(trace.attributes.homePath).startsWith("[redacted-path]")).toBe(true)
    expect(String(trace.attributes.homePath)).not.toContain("someone")
    // Bounded routing label survives.
    expect(trace.attributes["routing.task_class"]).toBe("small")

    // No plaintext secret/prompt/path substring anywhere in the exported payload.
    const wire = JSON.stringify(sink.batches)
    expect(wire).not.toContain("sk-live-must-not-leak")
    expect(wire).not.toContain("raw user prompt")
    expect(wire).not.toContain("/Users/someone")

    expect(adapter.stats().queueDepth).toBe(0)
  })

  test("test signal reaches the endpoint as a clearly-marked content-free marker", async () => {
    sink = startLoopbackSink()
    const adapter = createOtlpAdapter({
      config: enabledConfig(sink.url),
      secret: createMemorySecretPort(),
      transport: httpTransport(sink.url),
    })
    const out = await adapter.emitTestSignal()
    expect(out.emitted).toBe(true)
    const marker = sink.batches[0][0]
    expect(marker.name).toBe("telemetry.test")
    expect(marker.attributes["telemetry.test"]).toBe(true)
  })

  test("connectivity probe succeeds against the live endpoint and increments the sink probe count", async () => {
    sink = startLoopbackSink()
    const adapter = createOtlpAdapter({
      config: enabledConfig(sink.url),
      secret: createMemorySecretPort(),
      transport: httpTransport(sink.url),
    })
    const out = await adapter.checkConnectivity()
    expect(out.ok).toBe(true)
    expect(sink.probes).toBeGreaterThanOrEqual(1)
  })

  test("a dead endpoint degrades health and discards the batch without throwing", async () => {
    sink = startLoopbackSink()
    const url = sink.url
    const adapter = createOtlpAdapter({
      config: enabledConfig(url),
      secret: createMemorySecretPort(),
      transport: httpTransport(url),
    })
    sink.stop() // endpoint goes away before export
    sink = null

    adapter.offer({ kind: "logs", name: "x", attributes: {} })
    const out = await adapter.flush()
    expect(out.flushed).toBe(0)
    expect(out.discarded).toBe(1)
    expect(adapter.stats().exportErrorCount).toBeGreaterThanOrEqual(1)
    expect(adapter.stats().health).toBe("degraded")

    const probe = await adapter.checkConnectivity()
    expect(probe.ok).toBe(false)
  })
})
