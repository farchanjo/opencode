/**
 * T014 — OTLP outbound adapter. Bounded queue wiring, redaction on the hot
 * path, signal-enablement gate, secret resolution through SecretPort, and
 * flush/connectivity semantics. No network (injected transport), no LLM.
 */
import { describe, expect, test } from "bun:test"
import { createMemorySecretPort } from "@/operator/adapters"
import { DEFAULT_TELEMETRY_CONFIG, REDACTED } from "../../src/routing/application/telemetry-service"
import {
  createOtlpAdapter,
  createUnavailableTransport,
  type OtlpTransport,
  type TelemetrySignal,
} from "../../src/routing/adapters/outbound/otlp-adapter"

function enabledConfig(overrides: Partial<(typeof DEFAULT_TELEMETRY_CONFIG)["signals"]> = {}) {
  return {
    ...DEFAULT_TELEMETRY_CONFIG,
    enabled: true,
    signals: { ...DEFAULT_TELEMETRY_CONFIG.signals, ...overrides },
    queue: { ...DEFAULT_TELEMETRY_CONFIG.queue, capacity: 4, batch_size: 2 },
  }
}

function recordingTransport() {
  const sent: TelemetrySignal[][] = []
  const transport: OtlpTransport = {
    async send(batch) {
      sent.push([...batch])
      return { ok: true, reason: null }
    },
    async probe() {
      return { ok: true, reason: null }
    },
  }
  return { transport, sent }
}

describe("OtlpAdapter offer (hot path)", () => {
  test("redacts attributes before enqueue and never blocks", () => {
    const { transport } = recordingTransport()
    const adapter = createOtlpAdapter({
      config: enabledConfig(),
      secret: createMemorySecretPort(),
      transport,
      now: () => 100,
    })
    const result = adapter.offer({
      kind: "traces",
      name: "routing.evaluate",
      attributes: { prompt: "secret prompt", "routing.task_class": "small" },
    })
    expect(result.accepted).toBe(true)
    expect(adapter.stats().queueDepth).toBe(1)
  })

  test("drops signals whose kind is disabled", () => {
    const adapter = createOtlpAdapter({
      config: enabledConfig({ metrics: false }),
      secret: createMemorySecretPort(),
      transport: recordingTransport().transport,
    })
    const result = adapter.offer({ kind: "metrics", name: "x", attributes: {} })
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain("disabled")
    expect(adapter.stats().queueDepth).toBe(0)
  })

  test("bounded queue applies drop policy at capacity without throwing", () => {
    const adapter = createOtlpAdapter({
      config: enabledConfig(),
      secret: createMemorySecretPort(),
      transport: recordingTransport().transport,
    })
    for (let i = 0; i < 10; i++) adapter.offer({ kind: "logs", name: `n${i}`, attributes: {} })
    const stats = adapter.stats()
    expect(stats.queueDepth).toBeLessThanOrEqual(stats.queueCapacity)
    expect(stats.dropCount).toBeGreaterThan(0)
    expect(stats.health).toBe("degraded")
  })
})

describe("OtlpAdapter flush + test signal", () => {
  test("flush drains the queue in batches and exports redacted content", async () => {
    const { transport, sent } = recordingTransport()
    const adapter = createOtlpAdapter({
      config: enabledConfig(),
      secret: createMemorySecretPort(),
      transport,
      now: () => 100,
    })
    adapter.offer({ kind: "traces", name: "a", attributes: { prompt: "leak" } })
    adapter.offer({ kind: "traces", name: "b", attributes: { apiKey: "sk-live" } })
    const out = await adapter.flush()
    expect(out.flushed).toBe(2)
    expect(out.discarded).toBe(0)
    // Two entries, batch_size 2 → single batch.
    expect(sent.length).toBe(1)
    expect(sent[0][0].attributes.prompt).toBe(REDACTED)
    expect(sent[0][1].attributes.apiKey).toBe(REDACTED)
    expect(adapter.stats().queueDepth).toBe(0)
  })

  test("emitTestSignal enqueues a content-free marker and flushes it", async () => {
    const { transport, sent } = recordingTransport()
    const adapter = createOtlpAdapter({ config: enabledConfig(), secret: createMemorySecretPort(), transport })
    const out = await adapter.emitTestSignal()
    expect(out.emitted).toBe(true)
    expect(sent[0][0].name).toBe("telemetry.test")
    expect(sent[0][0].attributes["telemetry.test"]).toBe(true)
  })

  test("failed transport export counts as discarded and degrades health", async () => {
    const failing: OtlpTransport = {
      async send() {
        return { ok: false, reason: "network down" }
      },
      async probe() {
        return { ok: false, reason: "network down" }
      },
    }
    const adapter = createOtlpAdapter({ config: enabledConfig(), secret: createMemorySecretPort(), transport: failing })
    adapter.offer({ kind: "logs", name: "x", attributes: {} })
    const out = await adapter.flush()
    expect(out.flushed).toBe(0)
    expect(out.discarded).toBe(1)
    expect(adapter.stats().exportErrorCount).toBe(1)
    expect(adapter.stats().health).toBe("degraded")
  })
})

describe("OtlpAdapter connectivity + secrets", () => {
  test("checkConnectivity resolves secrets then probes", async () => {
    const secret = createMemorySecretPort()
    await secret.put({ backend: "keychain", name: "tok", plaintext: "v" })
    const { transport } = recordingTransport()
    const adapter = createOtlpAdapter({
      config: {
        ...enabledConfig(),
        export: { ...enabledConfig().export, headers: { authorization: "keychain:tok" } },
      },
      secret,
      transport,
    })
    const out = await adapter.checkConnectivity()
    expect(out.ok).toBe(true)
  })

  test("checkConnectivity fails when a referenced secret is unresolvable", async () => {
    const { transport } = recordingTransport()
    const adapter = createOtlpAdapter({
      config: {
        ...enabledConfig(),
        export: { ...enabledConfig().export, headers: { authorization: "keychain:absent" } },
      },
      secret: createMemorySecretPort(),
      transport,
    })
    const out = await adapter.checkConnectivity()
    expect(out.ok).toBe(false)
    expect(out.reason).toContain("unresolved secret")
  })

  test("default (unavailable) transport reports offline and fails closed", async () => {
    const adapter = createOtlpAdapter({ config: enabledConfig(), secret: createMemorySecretPort() })
    expect(adapter.stats().offline).toBe(true)
    const out = await adapter.checkConnectivity()
    expect(out.ok).toBe(false)
    expect(createUnavailableTransport).toBeDefined()
  })
})
