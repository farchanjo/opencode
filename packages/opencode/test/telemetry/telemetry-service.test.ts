/**
 * T013 — TelemetryPort service. Config read/write through the Feature 007
 * Config.Service adapter; secret validation through the SecretPort; all reads
 * offline-capable and zero-cost. In-process style (fake Config.Service +
 * memory SecretPort), no LLM, no network.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createMemorySecretPort,
} from "@/operator/adapters"
import { createProcessMutexLockPort } from "@/operator/application"
import {
  createTelemetryService,
  DEFAULT_TELEMETRY_CONFIG,
  type TelemetrySink,
  type TelemetryError,
} from "../../src/routing/application/telemetry-service"

function makeService(sink?: TelemetrySink) {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  const secret = createMemorySecretPort()
  const service = createTelemetryService({ config: store.config, secret, sink, now: () => 1_000 })
  return { service, secret, store }
}

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff)
// Capture the typed error channel: flip swaps success/error so the failure value
// resolves directly (this effect build has no Either module).
const runError = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(eff))

function fakeSink(overrides: Partial<TelemetrySink> = {}): TelemetrySink {
  return {
    stats: () => ({
      queueDepth: 3,
      queueCapacity: 100,
      dropCount: 1,
      exportErrorCount: 0,
      health: "ok",
      offline: false,
    }),
    emitTestSignal: async () => ({ emitted: true, reason: null }),
    checkConnectivity: async () => ({ ok: true, reason: null }),
    flush: async () => ({ flushed: 5, discarded: 0, durationMs: 2 }),
    ...overrides,
  }
}

describe("TelemetryPort.status / show", () => {
  test("defaults to disabled default config with origin=default and no sink", async () => {
    const { service } = makeService()
    const status = await run(service.status())
    expect(status.enabled).toBe(false)
    expect(status.exportHealth).toBe("unavailable")
    expect(status.offline).toBe(true)
    expect(status.config.endpoint).toBe(DEFAULT_TELEMETRY_CONFIG.export.endpoint)

    const show = await run(service.show())
    expect(show.origin).toBe("default")
    // Redacted EffectiveConfig never exposes headers or tls cert.
    expect(Object.keys(show.config)).toEqual(["endpoint", "transport", "signals", "queue", "redact"])
  })

  test("status surfaces in-memory sink stats without network", async () => {
    const { service } = makeService(fakeSink())
    // enable first so health reflects the sink.
    await run(service.enable("project"))
    const status = await run(service.status())
    expect(status.enabled).toBe(true)
    expect(status.queueDepth).toBe(3)
    expect(status.queueCapacity).toBe(100)
    expect(status.dropCount).toBe(1)
    expect(status.exportHealth).toBe("ok")
    expect(status.offline).toBe(false)
  })
})

describe("TelemetryPort.enable / disable", () => {
  test("enable persists enabled=true at scope and show reports project origin", async () => {
    const { service, store } = makeService()
    const out = await run(service.enable("project"))
    expect(out.enabled).toBe(true)

    const show = await run(service.show())
    expect(show.origin).toBe("project")

    // Persisted through Config.Service under the telemetry authority.
    const entry = await store.config.get("telemetry")
    expect(entry).not.toBeNull()
    expect((entry!.payload as any).enabled).toBe(true)
  })

  test("global scope writes to the global authority", async () => {
    const { service, store } = makeService()
    await run(service.enable("global"))
    const show = await run(service.show())
    expect(show.origin).toBe("global")
    expect(await store.config.get("global:telemetry")).not.toBeNull()
    expect(await store.config.get("telemetry")).toBeNull()
  })

  test("project config overrides global for effective origin", async () => {
    const { service } = makeService()
    await run(service.enable("global"))
    await run(service.disable("project"))
    const show = await run(service.show())
    expect(show.origin).toBe("project")
    expect(show.config).toBeDefined()
    const status = await run(service.status())
    expect(status.enabled).toBe(false)
  })

  test("disable persists enabled=false", async () => {
    const { service } = makeService()
    await run(service.enable("project"))
    const disabled = await run(service.disable("project"))
    expect(disabled.enabled).toBe(false)
  })

  test("enable fails validation when a referenced secret is unresolvable", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    const secret = createMemorySecretPort()
    // Seed a project config referencing a secret that does not exist.
    await store.config.compareAndSet({
      authority: "telemetry",
      expectedVersion: null,
      nowMs: 1,
      payload: {
        ...DEFAULT_TELEMETRY_CONFIG,
        export: {
          ...DEFAULT_TELEMETRY_CONFIG.export,
          headers: { authorization: "keychain:missing-token" },
        },
      },
    })
    const service = createTelemetryService({ config: store.config, secret, now: () => 2 })
    const err = (await runError(service.enable("project"))) as TelemetryError
    expect(err.type).toBe("validation_failed")
    if (err.type === "validation_failed") expect(err.fields["headers.authorization"]).toBeDefined()
  })

  test("enable succeeds once the referenced secret resolves", async () => {
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
    const secret = createMemorySecretPort()
    await secret.put({ backend: "keychain", name: "otlp-token", plaintext: "x" })
    await store.config.compareAndSet({
      authority: "telemetry",
      expectedVersion: null,
      nowMs: 1,
      payload: {
        ...DEFAULT_TELEMETRY_CONFIG,
        export: {
          ...DEFAULT_TELEMETRY_CONFIG.export,
          headers: { authorization: "keychain:otlp-token" },
        },
      },
    })
    const service = createTelemetryService({ config: store.config, secret, now: () => 2 })
    const out = await run(service.enable("project"))
    expect(out.enabled).toBe(true)
  })
})

describe("TelemetryPort.test / flush", () => {
  test("test on disabled telemetry reports unavailable and exports nothing", async () => {
    const { service } = makeService(fakeSink())
    const out = await run(service.test("signal"))
    expect(out.outcome).toBe("unavailable")
    expect(out.testSignalEmitted).toBe(false)
    expect(out.noUserContentExported).toBe(true)
  })

  test("signal test emits a marked signal through the sink", async () => {
    const { service } = makeService(fakeSink())
    await run(service.enable("project"))
    const out = await run(service.test("signal"))
    expect(out.mode).toBe("signal")
    expect(out.outcome).toBe("ok")
    expect(out.testSignalEmitted).toBe(true)
    expect(out.noUserContentExported).toBe(true)
  })

  test("connectivity test delegates to the sink probe", async () => {
    const { service } = makeService(fakeSink({ checkConnectivity: async () => ({ ok: false, reason: "refused" }) }))
    await run(service.enable("project"))
    const out = await run(service.test("connectivity"))
    expect(out.mode).toBe("connectivity")
    expect(out.outcome).toBe("unavailable")
    expect(out.reason).toBe("refused")
    expect(out.testSignalEmitted).toBe(false)
  })

  test("flush returns sink counts", async () => {
    const { service } = makeService(fakeSink())
    const out = await run(service.flush())
    expect(out.flushedRecords).toBe(5)
    expect(out.discardedRecords).toBe(0)
    expect(out.durationMs).toBe(2)
  })

  test("flush without a sink returns zeros", async () => {
    const { service } = makeService()
    const out = await run(service.flush())
    expect(out).toEqual({ flushedRecords: 0, discardedRecords: 0, durationMs: 0 })
  })
})
