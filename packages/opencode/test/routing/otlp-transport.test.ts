/**
 * Feature 019 / T014 — real OTLP/HTTP transport unit tests.
 *
 * Drives `createHttpOtlpTransport` over a scripted fake `fetch` (never the network):
 * asserts spec-shaped OTLP/JSON encoding per signal kind, the `retry_budget`
 * enforcement (transient retried within budget then given up; permanent 4xx not
 * retried), the bounded timeout, and that a fault always resolves `{ ok:false }`
 * rather than throwing into the caller.
 */
import { describe, expect, test } from "bun:test"
import {
  createHttpOtlpTransport,
  encodeOtlpJson,
} from "@/routing/adapters/outbound/otlp-transport"
import type { TelemetrySignal } from "@/routing/adapters/outbound/otlp-adapter"

const noSleep = () => Promise.resolve()

function metric(name: string, value: number, attrs: Record<string, unknown> = {}): TelemetrySignal {
  return { kind: "metrics", name, attributes: { value, ...attrs }, timestamp: 1_700_000_000_000 }
}

describe("T014 OTLP/JSON encoding", () => {
  test("metrics encode as a single-point gauge with the value point and label attributes", () => {
    const body = encodeOtlpJson("metrics", [metric("opencode_session_count", 3, { run_id: "abc" })]) as any
    const m = body.resourceMetrics[0].scopeMetrics[0].metrics[0]
    expect(m.name).toBe("opencode_session_count")
    expect(m.gauge.dataPoints[0].asDouble).toBe(3)
    // `value` becomes the point, not a label; other attrs become labels.
    const labels = m.gauge.dataPoints[0].attributes.map((kv: any) => kv.key)
    expect(labels).toContain("run_id")
    expect(labels).not.toContain("value")
    expect(m.gauge.dataPoints[0].timeUnixNano).toBe("1700000000000000000")
  })

  test("logs encode as logRecords with the signal name as the body", () => {
    const body = encodeOtlpJson("logs", [{ kind: "logs", name: "task.execute", attributes: { role: "worker" } }]) as any
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0]
    expect(record.body.stringValue).toBe("task.execute")
    expect(record.severityText).toBe("INFO")
  })

  test("traces encode as spans with random 16-byte trace + 8-byte span ids", () => {
    const body = encodeOtlpJson("traces", [{ kind: "traces", name: "route", attributes: {} }]) as any
    const span = body.resourceSpans[0].scopeSpans[0].spans[0]
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(span.name).toBe("route")
  })
})

describe("T014 transport send + retry budget", () => {
  test("a batch groups by kind and POSTs each to its /v1/<kind> path", async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://collector:4318/", fetch: fetchImpl, sleep: noSleep })

    const out = await transport.send([
      metric("m", 1),
      { kind: "logs", name: "l", attributes: {} },
      { kind: "traces", name: "t", attributes: {} },
    ])
    expect(out.ok).toBe(true)
    expect(calls).toContain("http://collector:4318/v1/metrics")
    expect(calls).toContain("http://collector:4318/v1/logs")
    expect(calls).toContain("http://collector:4318/v1/traces")
  })

  test("a transient 503 is retried within the budget then succeeds", async () => {
    let attempts = 0
    const fetchImpl = (async () => {
      attempts += 1
      return attempts < 3 ? new Response(null, { status: 503 }) : new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://c:4318", retryBudget: 3, fetch: fetchImpl, sleep: noSleep })
    const out = await transport.send([metric("m", 1)])
    expect(out.ok).toBe(true)
    expect(attempts).toBe(3)
  })

  test("a persistent 503 gives up after the budget and reports the failure (never throws)", async () => {
    let attempts = 0
    const fetchImpl = (async () => {
      attempts += 1
      return new Response(null, { status: 503 })
    }) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://c:4318", retryBudget: 2, fetch: fetchImpl, sleep: noSleep })
    const out = await transport.send([metric("m", 1)])
    expect(out.ok).toBe(false)
    expect(attempts).toBe(3) // 1 initial + 2 retries
    expect(out.reason).toContain("503")
  })

  test("a permanent 400 is NOT retried", async () => {
    let attempts = 0
    const fetchImpl = (async () => {
      attempts += 1
      return new Response(null, { status: 400 })
    }) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://c:4318", retryBudget: 5, fetch: fetchImpl, sleep: noSleep })
    const out = await transport.send([metric("m", 1)])
    expect(out.ok).toBe(false)
    expect(attempts).toBe(1)
  })

  test("a network throw resolves { ok:false } rather than escaping to the caller", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://c:4318", retryBudget: 0, fetch: fetchImpl, sleep: noSleep })
    const out = await transport.send([metric("m", 1)])
    expect(out.ok).toBe(false)
    expect(out.reason).toContain("ECONNREFUSED")
  })

  test("an empty batch is a no-op success and touches no network", async () => {
    let called = 0
    const fetchImpl = (async () => {
      called += 1
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://c:4318", fetch: fetchImpl })
    const out = await transport.send([])
    expect(out.ok).toBe(true)
    expect(called).toBe(0)
  })

  test("probe treats any HTTP response as reachable", async () => {
    const fetchImpl = (async () => new Response(null, { status: 405 })) as unknown as typeof fetch
    const transport = createHttpOtlpTransport({ endpoint: "http://c:4318", fetch: fetchImpl })
    const out = await transport.probe()
    expect(out.ok).toBe(true)
  })
})
