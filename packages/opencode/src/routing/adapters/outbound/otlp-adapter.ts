/**
 * OTLP outbound adapter (Feature 001 — T014).
 *
 * Wires the telemetry application service (T013) to the extended core OTLP
 * exporter primitives (packages/core/src/observability/otlp.ts) through the
 * bounded, non-blocking export queue. It implements the TelemetrySink port:
 *
 *   - offer(): redact + signal-gate an outgoing signal, then enqueue. Enqueue
 *     never blocks the hot path (BoundedExportQueue drop/backpressure policy).
 *   - stats(): in-memory queue depth/capacity/drops + exporter error counters
 *     (offline-capable, zero-cost — the source for TelemetryPort.status).
 *   - emitTestSignal(): enqueue a content-free, clearly-marked test signal and
 *     flush it; no user content ever leaves the process.
 *   - checkConnectivity(): resolve referenced secrets through the SecretPort
 *     (material never surfaced) and probe the endpoint via the transport.
 *   - flush(): drain the queue in batches and hand them to the transport.
 *
 * The queue is the ADR-0001 bounded-queue extension of the core exporter; the
 * network transport is injectable so the adapter is drivable in tests and the
 * production OTLP Layers (Flag-driven) stay the process-wide sink.
 */

import { BoundedExportQueue } from "@opencode-ai/core/observability/otlp"
import type { QueueSignal } from "@opencode-ai/core/observability/otlp"
import type { TelemetryConfig } from "@opencode-ai/schema/telemetry/config"
import type { ExportHealth } from "@opencode-ai/protocol/telemetry/index"
import type { SecretPort } from "@/operator/application/ports/secret-port"
import {
  redactAttributes,
  redactionPolicyFromConfig,
  signalEnabled,
  parseTelemetrySecretRef,
  type TelemetrySink,
  type TelemetrySinkStats,
} from "@/routing/application/telemetry-service"

export type TelemetrySignalKind = "metrics" | "logs" | "traces"

// A single outgoing telemetry signal handed to the sink before export.
export interface TelemetrySignal {
  readonly kind: TelemetrySignalKind
  readonly name: string
  readonly attributes: Record<string, unknown>
  readonly timestamp?: number
}

// OtlpTransport is the injectable network boundary. `send` exports a drained
// batch; `probe` validates connectivity. Both are best-effort and never throw
// into the caller (errors surface as `{ ok: false, reason }`).
export interface OtlpTransport {
  readonly send: (batch: ReadonlyArray<TelemetrySignal>) => Promise<{ readonly ok: boolean; readonly reason: string | null }>
  readonly probe: () => Promise<{ readonly ok: boolean; readonly reason: string | null }>
}

export interface OtlpAdapterOptions {
  readonly config: TelemetryConfig
  readonly secret: SecretPort
  readonly transport?: OtlpTransport
  readonly now?: () => number
  // Bridge for queue depth/capacity/drop signals onto core metric instruments.
  readonly onQueueSignal?: (signal: QueueSignal) => void
}

export interface OtlpAdapter extends TelemetrySink {
  // Non-blocking hot-path entry point: redact, gate by signal enablement, enqueue.
  readonly offer: (signal: TelemetrySignal) => { readonly accepted: boolean; readonly reason: string | null }
}

// The unavailable transport is the default when the process is offline: exports
// fail closed, connectivity probes report unavailable. It never touches the network.
export function createUnavailableTransport(reason = "no OTLP transport configured"): OtlpTransport {
  return {
    async send() {
      return { ok: false, reason }
    },
    async probe() {
      return { ok: false, reason }
    },
  }
}

export function createOtlpAdapter(options: OtlpAdapterOptions): OtlpAdapter {
  const now = options.now ?? Date.now
  const offline = options.transport === undefined
  const transport = options.transport ?? createUnavailableTransport()
  const policy = redactionPolicyFromConfig(options.config)
  const queueCfg = options.config.queue

  let exportErrors = 0

  const queue = new BoundedExportQueue<TelemetrySignal>({
    capacity: queueCfg.capacity,
    batchSize: queueCfg.batch_size,
    dropPolicy: queueCfg.drop_policy,
    enqueueTimeoutMs: queueCfg.enqueue_timeout_ms,
    now,
    onSignal: options.onQueueSignal,
  })

  function health(): ExportHealth {
    if (!options.config.enabled) return "unavailable"
    if (exportErrors > 0) return "degraded"
    if (queue.isFull) return "degraded"
    return "ok"
  }

  function stats(): TelemetrySinkStats {
    return {
      queueDepth: queue.size,
      queueCapacity: queue.capacity,
      dropCount: queue.dropCount,
      exportErrorCount: exportErrors,
      health: health(),
      offline,
    }
  }

  function offer(signal: TelemetrySignal): { accepted: boolean; reason: string | null } {
    if (!signalEnabled(options.config, signal.kind)) {
      return { accepted: false, reason: `signal ${signal.kind} disabled` }
    }
    const redacted: TelemetrySignal = {
      kind: signal.kind,
      name: signal.name,
      attributes: redactAttributes(signal.attributes, policy),
      timestamp: signal.timestamp ?? now(),
    }
    const result = queue.enqueue(redacted)
    return { accepted: result.accepted, reason: result.dropReason ?? null }
  }

  // Confirm every referenced secret resolves; material is fetched but never
  // returned to the caller (SecretPort.resolveMaterial yields a redacted marker).
  async function secretsResolvable(): Promise<{ ok: boolean; reason: string | null }> {
    const refs: string[] = Object.values(options.config.export.headers)
    if (options.config.export.tls.enabled && options.config.export.tls.cert) {
      refs.push(options.config.export.tls.cert)
    }
    for (const raw of refs) {
      const parsed = parseTelemetrySecretRef(raw)
      if (!parsed) return { ok: false, reason: "malformed secret reference" }
      const resolved = await options.secret.resolveMaterial({ ...parsed, version: 1 })
      if (!resolved.ok) return { ok: false, reason: `unresolved secret: ${parsed.name}` }
    }
    return { ok: true, reason: null }
  }

  async function flush() {
    const start = now()
    let flushed = 0
    let discarded = 0
    for (let batch = queue.drain(); batch.length > 0; batch = queue.drain()) {
      const result = await transport.send(batch)
      if (result.ok) {
        flushed += batch.length
      } else {
        discarded += batch.length
        exportErrors += 1
      }
    }
    return { flushed, discarded, durationMs: Math.max(0, now() - start) }
  }

  return {
    offer,
    stats,
    async emitTestSignal() {
      const enqueued = offer({
        kind: "traces",
        name: "telemetry.test",
        attributes: { "telemetry.test": true, "telemetry.test.marker": "connectivity-check" },
      })
      if (!enqueued.accepted) return { emitted: false, reason: enqueued.reason }
      const result = await flush()
      if (result.flushed === 0) {
        if (result.discarded > 0) return { emitted: false, reason: "export transport rejected the test signal" }
        return { emitted: false, reason: "test signal was not exported" }
      }
      return { emitted: true, reason: null }
    },
    async checkConnectivity() {
      const secrets = await secretsResolvable()
      if (!secrets.ok) return { ok: false, reason: secrets.reason }
      return transport.probe()
    },
    flush,
  }
}

export * as OtlpAdapter from "./otlp-adapter"
