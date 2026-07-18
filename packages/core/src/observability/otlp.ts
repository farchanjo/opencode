import { Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpMetrics, OtlpSerialization } from "effect/unstable/observability"
import { Flag } from "../flag/flag"
import { InstallationChannel, InstallationVersion } from "../installation/version"
import { runID } from "./shared"
import { boundEnum, createCardinalityAllowlist, Labels } from "./telemetry-instruments"
import type { CardinalityAllowlist, DropReason } from "./telemetry-instruments"

const endpoint = Flag.OTEL_EXPORTER_OTLP_ENDPOINT

const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
  ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
      (acc, entry) => {
        const [key, ...value] = entry.split("=")
        acc[key] = value.join("=")
        return acc
      },
      {} as Record<string, string>,
    )
  : undefined

function resourceAttributes() {
  const value = process.env.OTEL_RESOURCE_ATTRIBUTES
  if (!value) return {}
  try {
    return Object.fromEntries(
      value.split(",").map((entry) => {
        const index = entry.indexOf("=")
        if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
        return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
      }),
    )
  } catch {
    return {}
  }
}

export function resource(): { serviceName: string; serviceVersion: string; attributes: Record<string, string> } {
  return {
    serviceName: "opencode",
    serviceVersion: InstallationVersion,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": InstallationChannel,
      "opencode.client": Flag.OPENCODE_CLIENT,
      "opencode.run": runID,
      "service.instance.id": runID,
    },
  }
}

export function loggers() {
  if (!endpoint) return []
  return [OtlpLogger.make({ url: `${endpoint}/v1/logs`, resource: resource(), headers })]
}

// metricsLayer installs the OTLP metrics exporter alongside traces/logs. The
// exporter snapshots the Effect metric registry on its interval and is
// self-contained (bundles JSON serialization and a fetch HTTP client), so it
// composes with the trace NodeSdk layer without shared dependencies. Activation
// is Flag-driven: no endpoint yields an empty layer.
export function metricsLayer() {
  if (!endpoint) return Layer.empty
  return OtlpMetrics.layer({ url: `${endpoint}/v1/metrics`, resource: resource(), headers }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  )
}

export async function tracingLayer() {
  if (!endpoint) return Layer.empty
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const { context } = await import("@opentelemetry/api")

  // The Effect Node SDK does not register a global context manager, but the AI SDK uses it to parent spans.
  const manager = new AsyncLocalStorageContextManager()
  manager.enable()
  context.setGlobalContextManager(manager)

  return NodeSdk.layer(() => ({
    resource: resource(),
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
        headers,
      }),
    ),
  }))
}

// =============================================================================
// Bounded async export queue (ADR-0001)
// =============================================================================

// DropPolicy mirrors @opencode-ai/schema/telemetry/config #DropPolicy.
export type DropPolicy = "drop" | "backpressure"

// Signals emitted by the queue so the caller can bridge them onto metric
// instruments (queue depth/capacity gauges, drop counter). Emission is
// synchronous and side-effect free from the queue's perspective.
export type QueueSignalKind = "queue_depth" | "queue_capacity" | "drop"

export interface QueueSignal {
  readonly kind: QueueSignalKind
  readonly value: number
  readonly dropReason?: DropReason
}

export interface EnqueueResult {
  // Whether the incoming item was retained in the queue.
  readonly accepted: boolean
  // Set when an item (incoming or evicted) was dropped during this call.
  readonly dropReason?: DropReason
}

export interface BoundedExportQueueOptions<T> {
  // Hard maximum number of buffered signals before the policy applies.
  readonly capacity: number
  // Maximum number of signals returned per drain (one export batch).
  readonly batchSize: number
  // Policy applied when the queue is at capacity.
  readonly dropPolicy: DropPolicy
  // Optional staleness bound; entries older than this are dropped at enqueue.
  readonly enqueueTimeoutMs?: number
  // Injectable clock for deterministic testing.
  readonly now?: () => number
  // Observer for queue depth/capacity/drop signals.
  readonly onSignal?: (signal: QueueSignal) => void
}

interface QueueEntry<T> {
  readonly item: T
  readonly enqueuedAt: number
}

// BoundedExportQueue is an in-memory, non-blocking bounded buffer for OTLP
// export. `enqueue` never awaits and never blocks the hot path: at capacity it
// either drops the incoming signal (`drop`) or evicts the oldest to admit the
// newest (`backpressure`). Depth/capacity/drop signals are emitted through
// `onSignal` for metric bridging.
export class BoundedExportQueue<T> {
  private readonly entries: Array<QueueEntry<T>> = []
  private readonly options: BoundedExportQueueOptions<T>
  private readonly clock: () => number
  private drops = 0

  constructor(options: BoundedExportQueueOptions<T>) {
    this.options = options
    this.clock = options.now ?? Date.now
    this.emit({ kind: "queue_capacity", value: options.capacity })
  }

  get size(): number {
    return this.entries.length
  }

  get capacity(): number {
    return this.options.capacity
  }

  get dropCount(): number {
    return this.drops
  }

  get isFull(): boolean {
    return this.entries.length >= this.options.capacity
  }

  enqueue(item: T): EnqueueResult {
    this.pruneStale()
    if (!this.isFull) {
      this.entries.push({ item, enqueuedAt: this.clock() })
      this.emitDepth()
      return { accepted: true }
    }
    if (this.options.dropPolicy === "drop") {
      this.recordDrop("queue_full")
      this.emitDepth()
      return { accepted: false, dropReason: "queue_full" }
    }
    // backpressure: favor fresh data by evicting the oldest entry.
    this.entries.shift()
    this.recordDrop("backpressure_evict")
    this.entries.push({ item, enqueuedAt: this.clock() })
    this.emitDepth()
    return { accepted: true, dropReason: "backpressure_evict" }
  }

  // drain removes and returns up to `batchSize` entries (one export batch).
  drain(): Array<T> {
    const batch = this.entries.splice(0, this.options.batchSize).map((entry) => entry.item)
    if (batch.length > 0) this.emitDepth()
    return batch
  }

  private pruneStale(): void {
    const timeout = this.options.enqueueTimeoutMs
    if (!timeout) return
    const cutoff = this.clock() - timeout
    let pruned = false
    while (this.entries.length > 0 && this.entries[0].enqueuedAt < cutoff) {
      this.entries.shift()
      this.recordDrop("stale")
      pruned = true
    }
    if (pruned) this.emitDepth()
  }

  private recordDrop(reason: DropReason): void {
    this.drops++
    this.emit({ kind: "drop", value: this.drops, dropReason: reason })
  }

  private emitDepth(): void {
    this.emit({ kind: "queue_depth", value: this.entries.length })
  }

  private emit(signal: QueueSignal): void {
    this.options.onSignal?.(signal)
  }
}

// =============================================================================
// Cardinality allowlist application (ADR-0001)
// =============================================================================

// Dynamic identifier label dimensions gated by the cardinality budget.
const DYNAMIC_LABELS = ["provider", "model", "variant", "agent"] as const

// cardinalityBudget resolves the configurable per-dimension budget. Defaults to
// 128 distinct values when unset or invalid.
export function cardinalityBudget(): number {
  const raw = process.env.OPENCODE_OTEL_CARDINALITY_BUDGET
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 128
}

export interface LabelBounder {
  // Applies bounded enums and the cardinality allowlist to a label bag.
  readonly bound: (labels: Record<string, string>) => Record<string, string>
  // Resets admitted dynamic identifiers (e.g. on catalog reload).
  readonly reset: () => void
}

// createLabelBounder builds a bounder that maps enum labels to their allowlist
// (over-budget → `other`) and admits up to `budget` distinct dynamic IDs per
// dimension, collapsing the rest to `other`.
export function createLabelBounder(budget: number = cardinalityBudget()): LabelBounder {
  const allow = {} as Record<(typeof DYNAMIC_LABELS)[number], CardinalityAllowlist>
  for (const key of DYNAMIC_LABELS) allow[key] = createCardinalityAllowlist(budget)
  return {
    bound(labels) {
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(labels)) {
        if (key in Labels) out[key] = boundEnum(Labels[key as keyof typeof Labels], value)
        else if (key in allow) out[key] = allow[key as (typeof DYNAMIC_LABELS)[number]].bound(value)
        else out[key] = value
      }
      return out
    },
    reset() {
      for (const key of DYNAMIC_LABELS) allow[key].reset()
    },
  }
}

export * as Otlp from "./otlp"
