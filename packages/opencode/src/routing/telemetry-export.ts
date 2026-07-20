/**
 * Real OTLP telemetry export pipeline (Feature 019 — T013, T016; FR11).
 *
 * A process-singleton, eager, fail-open export pipeline mirroring the Feature 017
 * `ensureProcessSpoolWriter` and Feature 018 `ensureExecutorComposition` precedent.
 * It replaces the offline `createUnavailableTransport` sink: when the effective
 * telemetry config has `enabled=true` it binds a REAL `http/protobuf` OTLP transport
 * and starts a bounded periodic flush that drains the `BoundedExportQueue` onto it;
 * when `enabled=false` it stays DISARMED — no interval fiber, no adapter, no network.
 *
 * Reactivity is PULL-BASED (ADR-0019 decision 8 — no push config-invalidation seam
 * exists): the pipeline re-resolves the effective config at server start
 * (`ensureTelemetryExport`) and on a `telemetry.*` mutation commit
 * (`rearmTelemetryExport`, poked by the operator dispatcher). A slow/unreachable
 * collector NEVER affects the session loop — every export is fail-open and bounded.
 *
 * The exported signals are a small, honest, CONTENT-FREE set built by an in-process
 * meter: the pipeline's own queue/export instruments (depth, capacity, drops, export
 * errors), a flush heartbeat, and operator/session counters incremented from the
 * live seams. The redaction defaults (prompts/secrets/paths/content/payloads) run in
 * the OTLP adapter's `offer` BEFORE any signal is queued, so nothing sensitive can
 * reach the transport (FR12, Security).
 */

import type { TelemetryConfig } from "@opencode-ai/schema/telemetry/config"
import type { SecretPort } from "@/operator/application/ports/secret-port"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import { resolveEffectiveTelemetryConfig, parseTelemetrySecretRef } from "@/routing/application/telemetry-service"
import { createOtlpAdapter, type OtlpAdapter, type OtlpTransport, type TelemetrySignal } from "./adapters/outbound/otlp-adapter"
import { createHttpOtlpTransport, type OtlpResource } from "./adapters/outbound/otlp-transport"

export type TelemetryExportState = "armed" | "disarmed"

export interface TelemetryExportStatus {
  readonly state: TelemetryExportState
  readonly enabled: boolean
  readonly endpoint: string | null
  readonly transport: TelemetryConfig["export"]["transport"] | null
  readonly reason: string | null
  readonly queueDepth: number
  readonly queueCapacity: number
  readonly dropCount: number
  readonly exportErrorCount: number
}

export interface TelemetryExportPipeline {
  readonly state: TelemetryExportState
  /** Count one committed operator mutation (content-free; exported on the next flush). */
  readonly recordOperatorMutation: () => void
  /** Count one session start (content-free; exported on the next flush). */
  readonly recordSession: () => void
  /** Snapshot the meter into signals, offer them, and drain the queue over the transport. */
  readonly flush: () => Promise<{ readonly flushed: number; readonly discarded: number; readonly durationMs: number }>
  readonly status: () => TelemetryExportStatus
  readonly dispose: () => void
}

export interface TelemetryExportDeps {
  readonly config: ConfigPort
  readonly secret: SecretPort
  /** Test-injected transport; production builds a real `createHttpOtlpTransport`. */
  readonly transport?: OtlpTransport
  /** Test override for effective-config resolution (defaults to `resolveEffectiveTelemetryConfig`). */
  readonly resolveConfig?: () => Promise<TelemetryConfig>
  readonly now?: () => number
  /** Periodic flush cadence in ms (default 10s); a disabled config starts no timer. */
  readonly flushIntervalMs?: number
  /** Injected scheduler (tests); production uses global timers, unref'd so they never pin the loop. */
  readonly scheduler?: {
    readonly setInterval: (fn: () => void, ms: number) => unknown
    readonly clearInterval: (handle: unknown) => void
  }
  /** The content-free OTLP resource; defaults to a minimal `opencode` resource. */
  readonly resource?: OtlpResource
}

const DEFAULT_FLUSH_INTERVAL_MS = 10_000

// Instrument names — static, content-free identifiers (no user content in labels).
const METRIC_QUEUE_DEPTH = "opencode_telemetry_queue_depth"
const METRIC_QUEUE_CAPACITY = "opencode_telemetry_queue_capacity"
const METRIC_DROP_TOTAL = "opencode_telemetry_drop_total"
const METRIC_EXPORT_ERROR_TOTAL = "opencode_telemetry_export_error_total"
const METRIC_FLUSH_TOTAL = "opencode_telemetry_flush_total"
const METRIC_OPERATOR_MUTATION_TOTAL = "opencode_operator_mutation_total"
const METRIC_SESSION_COUNT = "opencode_session_count"

let singleton: TelemetryExportPipeline | undefined
let pending: Promise<TelemetryExportPipeline> | undefined
let attempted = false
let activeDeps: TelemetryExportDeps | undefined

function boundedReason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.length > 200 ? `${message.slice(0, 197)}...` : message
}

/** The disarmed pipeline: no adapter, no interval, no network — every record is a no-op. */
function disarmed(reason: string, config?: TelemetryConfig): TelemetryExportPipeline {
  return {
    state: "disarmed",
    recordOperatorMutation: () => {},
    recordSession: () => {},
    flush: () => Promise.resolve({ flushed: 0, discarded: 0, durationMs: 0 }),
    status: () => ({
      state: "disarmed",
      enabled: config?.enabled ?? false,
      endpoint: null,
      transport: null,
      reason,
      queueDepth: 0,
      queueCapacity: config?.queue.capacity ?? 0,
      dropCount: 0,
      exportErrorCount: 0,
    }),
    dispose: () => {},
  }
}

/**
 * Resolve export header material at use-time. The public `SecretPort` deliberately
 * hides material (`resolveMaterial` yields a redacted marker), so an authenticated
 * collector requires the composition root's internal accessor. When it is absent (the
 * safe production default) headers are omitted — the local/unauthenticated profile
 * exports fine; an authenticated endpoint is a documented boundary (ADR-0019).
 */
async function resolveExportHeaders(config: TelemetryConfig, secret: SecretPort): Promise<Record<string, string>> {
  const internal = (secret as { resolveSecretMaterial?: (ref: { backend: string; name: string; version: number }) => Promise<string | null> })
    .resolveSecretMaterial
  const headers: Record<string, string> = {}
  if (typeof internal !== "function") return headers
  for (const [key, raw] of Object.entries(config.export.headers)) {
    const parsed = parseTelemetrySecretRef(raw)
    if (!parsed) continue
    try {
      const material = await internal({ backend: parsed.backend, name: parsed.name, version: 1 })
      if (typeof material === "string" && material.length > 0) headers[key] = material
    } catch {
      /* a header that cannot be resolved is omitted; export stays fail-open */
    }
  }
  return headers
}

/** Build the armed pipeline over an enabled config + a bound transport. */
function armPipeline(config: TelemetryConfig, transport: OtlpTransport, deps: TelemetryExportDeps): TelemetryExportPipeline {
  const now = deps.now ?? Date.now
  const adapter: OtlpAdapter = createOtlpAdapter({ config, secret: deps.secret, transport, now })

  const meter = { operatorMutations: 0, sessions: 0, flushes: 0 }
  let disposed = false

  /** Offer the content-free instrument snapshot as metrics signals (redaction still runs in `offer`). */
  function offerInstruments(): void {
    const stats = adapter.stats()
    const emit = (name: string, value: number): void => {
      adapter.offer({ kind: "metrics", name, attributes: { value }, timestamp: now() })
    }
    emit(METRIC_QUEUE_DEPTH, stats.queueDepth)
    emit(METRIC_QUEUE_CAPACITY, stats.queueCapacity)
    emit(METRIC_DROP_TOTAL, stats.dropCount)
    emit(METRIC_EXPORT_ERROR_TOTAL, stats.exportErrorCount)
    emit(METRIC_FLUSH_TOTAL, meter.flushes)
    emit(METRIC_OPERATOR_MUTATION_TOTAL, meter.operatorMutations)
    emit(METRIC_SESSION_COUNT, meter.sessions)
  }

  async function flush(): Promise<{ flushed: number; discarded: number; durationMs: number }> {
    if (disposed) return { flushed: 0, discarded: 0, durationMs: 0 }
    meter.flushes += 1
    offerInstruments()
    return adapter.flush()
  }

  const flushIntervalMs = deps.flushIntervalMs && deps.flushIntervalMs > 0 ? deps.flushIntervalMs : DEFAULT_FLUSH_INTERVAL_MS
  const scheduler = deps.scheduler ?? {
    setInterval: (fn: () => void, ms: number) => {
      const handle = setInterval(fn, ms)
      // Never pin the event loop / keep the process alive on the telemetry timer.
      ;(handle as { unref?: () => void }).unref?.()
      return handle
    },
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  }
  // Fire-and-forget periodic flush; a fault inside never escapes (fail-open).
  const timer = scheduler.setInterval(() => {
    void flush().catch(() => {})
  }, flushIntervalMs)

  return {
    state: "armed",
    recordOperatorMutation: () => {
      if (!disposed) meter.operatorMutations += 1
    },
    recordSession: () => {
      if (!disposed) meter.sessions += 1
    },
    flush,
    status: () => {
      const stats = adapter.stats()
      return {
        state: "armed",
        enabled: true,
        endpoint: config.export.endpoint,
        transport: config.export.transport,
        reason: null,
        queueDepth: stats.queueDepth,
        queueCapacity: stats.queueCapacity,
        dropCount: stats.dropCount,
        exportErrorCount: stats.exportErrorCount,
      }
    },
    dispose: () => {
      disposed = true
      scheduler.clearInterval(timer)
    },
  }
}

async function buildPipeline(deps: TelemetryExportDeps): Promise<TelemetryExportPipeline> {
  activeDeps = deps
  const config = await (deps.resolveConfig ?? (() => resolveEffectiveTelemetryConfig(deps.config)))()
  if (!config.enabled) return disarmed("telemetry disabled", config)
  if (config.export.transport === "grpc" && !deps.transport) {
    // No clean dependency-free gRPC client under Bun — honest typed boundary (ADR-0019).
    return disarmed("grpc transport not supported; configure http/protobuf", config)
  }
  const transport =
    deps.transport ??
    createHttpOtlpTransport({
      endpoint: config.export.endpoint,
      headers: await resolveExportHeaders(config, deps.secret),
      timeoutMs: config.queue.export_timeout_ms,
      retryBudget: config.queue.retry_budget,
      resource: deps.resource,
    })
  return armPipeline(config, transport, deps)
}

/**
 * Ensure the process-wide export pipeline is composed EXACTLY ONCE (idempotent,
 * fail-open). Server start calls it fire-and-forget; a disabled config yields a
 * disarmed pipeline (no fiber/network). A construction fault degrades to a disarmed
 * pipeline — the server still starts and telemetry stays silent.
 */
export function ensureTelemetryExport(deps?: TelemetryExportDeps): Promise<TelemetryExportPipeline> {
  if (singleton) return Promise.resolve(singleton)
  if (pending) return pending
  if (attempted && !deps) return Promise.resolve(disarmed("telemetry export previously failed to arm"))
  attempted = true
  const resolved = deps ? Promise.resolve(deps) : loadLiveDeps()
  pending = resolved
    .then(buildPipeline)
    .then((pipeline) => {
      singleton = pipeline
      pending = undefined
      return pipeline
    })
    .catch((cause) => {
      const fallback = disarmed(boundedReason(cause))
      singleton = fallback
      pending = undefined
      return fallback
    })
  return pending
}

/**
 * Re-resolve the effective config and re-arm/stop the pipeline (pull-based reactivity).
 * The operator dispatcher pokes this after a `telemetry.*` mutation commits: enabling
 * arms a real transport at the next tick, disabling disposes the timer and goes silent.
 * Reuses the deps from the first `ensure` (or the live deps in production).
 */
export function rearmTelemetryExport(deps?: TelemetryExportDeps): Promise<TelemetryExportPipeline> {
  singleton?.dispose()
  singleton = undefined
  pending = undefined
  attempted = false
  return ensureTelemetryExport(deps ?? activeDeps)
}

/** The current pipeline without composing one; `undefined` before the first ensure resolves. */
export function currentTelemetryExport(): TelemetryExportPipeline | undefined {
  return singleton
}

/** Count one committed operator mutation on the armed pipeline (no-op when disarmed/absent). */
export function recordOperatorMutation(): void {
  singleton?.recordOperatorMutation()
}

/** Count one session start on the armed pipeline (no-op when disarmed/absent). */
export function recordSession(): void {
  singleton?.recordSession()
}

/**
 * Lazily load the real production seams (a live ConfigPort + SecretPort). Kept a
 * function (never a static top-level import) so importing this module never
 * dereferences the Bun global or the AppRuntime — the pipeline core stays
 * importable under a non-Bun test runner that injects fakes. A throw here is
 * caught by `ensureTelemetryExport`.
 *
 * Feature 022 (ADR-0022): a DYNAMIC `await import(...)` — NOT a synchronous
 * `require(...)` — because `./telemetry-export-live` transitively imports
 * `@opencode-ai/core/global`, which contains a top-level `await`. `bun build
 * --compile` rejects a `require()` of a TLA-bearing module but permits a dynamic
 * import; the deferred-arming semantics are unchanged (this accessor was already
 * async), only the module-load mechanism differs.
 */
async function loadLiveDeps(): Promise<TelemetryExportDeps> {
  const live = await import("./telemetry-export-live")
  return live.TelemetryExportLive.createLiveTelemetryExportDeps()
}

/** TEST-ONLY: dispose + reset the process singleton so a fresh pipeline can be composed. */
export function __resetTelemetryExportForTests(): void {
  singleton?.dispose()
  singleton = undefined
  pending = undefined
  attempted = false
  activeDeps = undefined
}

export * as TelemetryExport from "./telemetry-export"
