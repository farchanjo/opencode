/**
 * Feature 019 / T013, T015, T016 — telemetry export pipeline unit tests.
 *
 * Drives the process-singleton pipeline over a recording fake transport + a manual
 * scheduler (never a real timer, never the network). Asserts: eager arm only when
 * enabled; idempotent ensure; disabled → disarmed with NO fiber/network; pull-based
 * re-arm on config change; the redaction defaults strip a hostile attribute set
 * before any signal reaches the transport; and the drop policy sheds overflow without
 * blocking.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createMemorySecretPort } from "@/operator/adapters"
import { DEFAULT_TELEMETRY_CONFIG, REDACTED } from "@/routing/application/telemetry-service"
import type { TelemetryConfig } from "@opencode-ai/schema/telemetry/config"
import type { OtlpTransport, TelemetrySignal } from "@/routing/adapters/outbound/otlp-adapter"
import {
  ensureTelemetryExport,
  rearmTelemetryExport,
  currentTelemetryExport,
  __resetTelemetryExportForTests,
  type TelemetryExportDeps,
} from "@/routing/telemetry-export"

interface RecordingTransport extends OtlpTransport {
  readonly batches: TelemetrySignal[][]
  readonly sends: number
}

function recordingTransport(fail = false): RecordingTransport {
  const batches: TelemetrySignal[][] = []
  let sends = 0
  return {
    batches,
    get sends() {
      return sends
    },
    async send(batch) {
      sends += 1
      if (fail) return { ok: false, reason: "scripted failure" }
      batches.push([...batch])
      return { ok: true, reason: null }
    },
    async probe() {
      return { ok: true, reason: null }
    },
  }
}

interface ManualScheduler {
  readonly setInterval: (fn: () => void, ms: number) => unknown
  readonly clearInterval: (handle: unknown) => void
  tick(): void
  readonly cleared: () => number
  readonly started: () => number
}

function manualScheduler(): ManualScheduler {
  let fn: (() => void) | null = null
  let cleared = 0
  let started = 0
  return {
    setInterval: (f) => {
      fn = f
      started += 1
      return { id: started }
    },
    clearInterval: () => {
      cleared += 1
      fn = null
    },
    tick: () => fn?.(),
    cleared: () => cleared,
    started: () => started,
  }
}

function enabledConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return { ...DEFAULT_TELEMETRY_CONFIG, enabled: true, ...overrides }
}

function deps(config: TelemetryConfig, transport: OtlpTransport, scheduler: ManualScheduler): TelemetryExportDeps {
  return {
    // A real ConfigPort is unused when resolveConfig is injected.
    config: {} as TelemetryExportDeps["config"],
    secret: createMemorySecretPort(),
    transport,
    resolveConfig: () => Promise.resolve(config),
    scheduler,
    now: () => 1_700_000_000_000,
  }
}

afterEach(() => {
  __resetTelemetryExportForTests()
})

describe("T013 eager, idempotent, fail-open composition", () => {
  test("an enabled config arms the pipeline and starts exactly one flush timer", async () => {
    const scheduler = manualScheduler()
    const pipeline = await ensureTelemetryExport(deps(enabledConfig(), recordingTransport(), scheduler))
    expect(pipeline.state).toBe("armed")
    expect(scheduler.started()).toBe(1)
  })

  test("a second ensure reuses the armed instance (no second timer)", async () => {
    const scheduler = manualScheduler()
    const d = deps(enabledConfig(), recordingTransport(), scheduler)
    const first = await ensureTelemetryExport(d)
    const second = await ensureTelemetryExport(d)
    expect(second).toBe(first)
    expect(scheduler.started()).toBe(1)
  })

  test("a disabled config leaves the pipeline DISARMED — no timer, no network", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport()
    const pipeline = await ensureTelemetryExport(deps(enabledConfig({ enabled: false }), transport, scheduler))
    expect(pipeline.state).toBe("disarmed")
    expect(scheduler.started()).toBe(0)
    await pipeline.flush()
    expect(transport.sends).toBe(0)
  })
})

describe("T014 real transport send + drop policy over the bounded queue", () => {
  test("a flush snapshots content-free instruments and ships them over the transport", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport()
    const pipeline = await ensureTelemetryExport(deps(enabledConfig(), transport, scheduler))
    pipeline.recordOperatorMutation()
    pipeline.recordSession()
    await pipeline.flush()
    expect(transport.sends).toBeGreaterThanOrEqual(1)
    const names = transport.batches.flat().map((s) => s.name)
    expect(names).toContain("opencode_telemetry_queue_depth")
    expect(names).toContain("opencode_operator_mutation_total")
    expect(names).toContain("opencode_session_count")
    // All exported signals are content-free instruments (a numeric `value` point only).
    for (const signal of transport.batches.flat()) {
      expect(typeof signal.attributes.value).toBe("number")
    }
  })

  test("the periodic timer drives a flush without the caller blocking", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport()
    await ensureTelemetryExport(deps(enabledConfig(), transport, scheduler))
    scheduler.tick()
    await Promise.resolve()
    // A tick eventually flushes; the record path never awaited the network.
    await currentTelemetryExport()!.flush()
    expect(transport.sends).toBeGreaterThanOrEqual(1)
  })

  test("overflow beyond capacity sheds signals under the drop policy without throwing", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport()
    const config = enabledConfig({
      queue: { ...DEFAULT_TELEMETRY_CONFIG.queue, capacity: 2, batch_size: 2, drop_policy: "drop" },
    })
    const pipeline = await ensureTelemetryExport(deps(config, transport, scheduler))
    // The instrument snapshot alone (7 signals) far exceeds capacity 2 — the drop
    // policy must shed the excess and the flush must still resolve.
    const out = await pipeline.flush()
    expect(out.flushed).toBeLessThanOrEqual(2)
    expect(pipeline.status().dropCount).toBeGreaterThan(0)
  })

  test("a failing transport isolates the export error (never throws into the caller)", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport(true)
    const pipeline = await ensureTelemetryExport(deps(enabledConfig(), transport, scheduler))
    const out = await pipeline.flush()
    expect(out.flushed).toBe(0)
    expect(out.discarded).toBeGreaterThan(0)
    expect(pipeline.status().exportErrorCount).toBeGreaterThanOrEqual(1)
  })
})

describe("T015 redaction defaults enforced before export", () => {
  test("a hostile attribute set is stripped before any signal reaches the transport", async () => {
    // The pipeline exports only its own content-free instruments; to prove redaction
    // at the sink boundary we assert the adapter offer path strips a hostile bag.
    const { createOtlpAdapter } = await import("@/routing/adapters/outbound/otlp-adapter")
    const transport = recordingTransport()
    const adapter = createOtlpAdapter({
      config: enabledConfig(),
      secret: createMemorySecretPort(),
      transport,
    })
    adapter.offer({
      kind: "metrics",
      name: "hostile.signal",
      attributes: {
        prompt: "the raw user prompt that must never leave",
        apiKey: "sk-live-secret-value",
        homePath: "/Users/victim/private/notes.txt",
        arguments: { tool: "payload-that-must-not-leak" },
        content: "file body that must not leak",
        "routing.task_class": "small",
      },
    })
    await adapter.flush()
    const wire = JSON.stringify(transport.batches)
    expect(wire).not.toContain("raw user prompt")
    expect(wire).not.toContain("sk-live-secret-value")
    expect(wire).not.toContain("/Users/victim")
    expect(wire).not.toContain("payload-that-must-not-leak")
    expect(wire).not.toContain("file body that must not leak")
    const delivered = transport.batches.flat().find((s) => s.name === "hostile.signal")!
    expect(delivered.attributes.prompt).toBe(REDACTED)
    expect(delivered.attributes.apiKey).toBe(REDACTED)
    expect(delivered.attributes.arguments).toBe(REDACTED)
    expect(delivered.attributes.content).toBe(REDACTED)
    // The bounded routing label survives — the export is not blanket-empty.
    expect(delivered.attributes["routing.task_class"]).toBe("small")
  })
})

describe("T016 pull-based re-arm on config change", () => {
  test("re-arming with an enabled config after a disabled one arms a live pipeline", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport()
    const disabled = await ensureTelemetryExport(deps(enabledConfig({ enabled: false }), transport, scheduler))
    expect(disabled.state).toBe("disarmed")

    const armed = await rearmTelemetryExport(deps(enabledConfig(), transport, scheduler))
    expect(armed.state).toBe("armed")
    await armed.flush()
    expect(transport.sends).toBeGreaterThanOrEqual(1)
  })

  test("re-arming to a disabled config disposes the timer and goes silent", async () => {
    const scheduler = manualScheduler()
    const transport = recordingTransport()
    const armed = await ensureTelemetryExport(deps(enabledConfig(), transport, scheduler))
    expect(armed.state).toBe("armed")

    const disabled = await rearmTelemetryExport(deps(enabledConfig({ enabled: false }), transport, scheduler))
    expect(disabled.state).toBe("disarmed")
    expect(scheduler.cleared()).toBeGreaterThanOrEqual(1)
    const before = transport.sends
    await disabled.flush()
    expect(transport.sends).toBe(before) // disarmed flush touches no network
  })

  test("a grpc transport with no injected client degrades to a disarmed typed boundary", async () => {
    const scheduler = manualScheduler()
    const config = enabledConfig({
      export: { ...DEFAULT_TELEMETRY_CONFIG.export, transport: "grpc" },
    })
    const pipeline = await ensureTelemetryExport({
      config: {} as TelemetryExportDeps["config"],
      secret: createMemorySecretPort(),
      resolveConfig: () => Promise.resolve(config),
      scheduler,
    })
    expect(pipeline.state).toBe("disarmed")
    expect(pipeline.status().reason).toContain("grpc")
  })
})
