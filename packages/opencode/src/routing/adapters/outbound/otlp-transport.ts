/**
 * Real OTLP/HTTP transport (Feature 019 — T014, FR12).
 *
 * The Feature 001 `OtlpTransport` boundary had only `createUnavailableTransport`
 * (an offline no-op). This is the first REAL egress: a `http/protobuf`-style
 * exporter that encodes a drained `TelemetrySignal` batch as spec-valid OTLP/JSON
 * (content-type `application/json`, accepted by the OTLP/HTTP spec) and POSTs it to
 * `<endpoint>/v1/{metrics,logs,traces}` with `fetch`. No new dependency is added —
 * the encoding is a small, self-contained OTLP/JSON writer.
 *
 * Defensive posture (FR12, Security):
 *   - Every request is bounded by an `AbortController` (`export_timeout_ms`); a slow
 *     collector resolves `{ ok:false }`, it NEVER blocks the caller.
 *   - `retry_budget` is honored: a transient failure (network error, 5xx, 429) is
 *     retried up to the budget with bounded backoff; a permanent 4xx is not retried.
 *   - `send`/`probe` NEVER throw into the caller — a fault surfaces as
 *     `{ ok:false, reason }` with a bounded, secret-free reason.
 *   - The redaction defaults run BEFORE this seam (the OTLP adapter's `offer`), so
 *     no prompt/secret/path/content/payload is ever encoded here. Header material is
 *     resolved by the composition root and passed pre-resolved; it is written only
 *     into the request headers, never logged.
 *
 * The `grpc` transport stays a typed boundary — no clean, dependency-free gRPC
 * client exists under Bun, so a `grpc` config degrades to `createUnavailableTransport`
 * at the composition root (documented in ADR-0019 decision 8).
 */

import type { OtlpTransport, TelemetrySignal, TelemetrySignalKind } from "./otlp-adapter"

/** The OTLP resource descriptor attached to every exported envelope (content-free). */
export interface OtlpResource {
  readonly serviceName: string
  readonly serviceVersion: string
  readonly attributes: Record<string, string>
}

export interface HttpOtlpTransportOptions {
  /** OTLP/HTTP base endpoint (e.g. `http://collector:4318`); signal paths are appended. */
  readonly endpoint: string
  /** Pre-resolved request headers (auth material resolved at the composition root only). */
  readonly headers?: Record<string, string>
  /** Per-request timeout in ms; a slower collector resolves `unreachable` (never blocks). */
  readonly timeoutMs?: number
  /** Max additional attempts after the first on a transient failure (`queue.retry_budget`). */
  readonly retryBudget?: number
  /** The content-free OTLP resource; defaults to a minimal `opencode` resource. */
  readonly resource?: OtlpResource
  /** Injected fetch (tests); defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch
  /** Injected sleep for bounded backoff (tests); defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RESOURCE: OtlpResource = { serviceName: "opencode", serviceVersion: "0.0.0", attributes: {} }
const SIGNAL_PATH: Record<TelemetrySignalKind, string> = {
  metrics: "/v1/metrics",
  logs: "/v1/logs",
  traces: "/v1/traces",
}

// =============================================================================
// OTLP/JSON encoding (spec-valid, dependency-free)
// =============================================================================

type OtlpAnyValue =
  | { readonly stringValue: string }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly boolValue: boolean }

interface OtlpKeyValue {
  readonly key: string
  readonly value: OtlpAnyValue
}

function toAnyValue(value: unknown): OtlpAnyValue {
  if (typeof value === "boolean") return { boolValue: value }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === "string") return { stringValue: value }
  try {
    return { stringValue: JSON.stringify(value) ?? "" }
  } catch {
    return { stringValue: "" }
  }
}

function toKeyValues(attributes: Record<string, unknown>): OtlpKeyValue[] {
  const out: OtlpKeyValue[] = []
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue
    out.push({ key, value: toAnyValue(value) })
  }
  return out
}

function resourceEnvelope(resource: OtlpResource) {
  const attributes: Record<string, unknown> = {
    "service.name": resource.serviceName,
    "service.version": resource.serviceVersion,
    ...resource.attributes,
  }
  return { attributes: toKeyValues(attributes) }
}

/** Wall-clock nanoseconds as a decimal string (OTLP requires string-encoded fixed64). */
function nanoString(timestampMs: number | undefined, now: number): string {
  const ms = typeof timestampMs === "number" && Number.isFinite(timestampMs) ? timestampMs : now
  return `${Math.max(0, Math.trunc(ms))}000000`
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  let out = ""
  for (const b of buf) out += b.toString(16).padStart(2, "0")
  return out
}

/** A metrics signal → a single-point OTLP Gauge (`value` attr is the point; the rest are labels). */
function encodeMetrics(batch: ReadonlyArray<TelemetrySignal>, resource: OtlpResource, now: number): unknown {
  const metrics = batch.map((signal) => {
    const { value, ...rest } = signal.attributes
    const asDouble = typeof value === "number" && Number.isFinite(value) ? value : 1
    return {
      name: signal.name,
      unit: "1",
      gauge: {
        dataPoints: [
          {
            asDouble,
            timeUnixNano: nanoString(signal.timestamp, now),
            attributes: toKeyValues(rest),
          },
        ],
      },
    }
  })
  return {
    resourceMetrics: [{ resource: resourceEnvelope(resource), scopeMetrics: [{ scope: { name: "opencode" }, metrics }] }],
  }
}

function encodeLogs(batch: ReadonlyArray<TelemetrySignal>, resource: OtlpResource, now: number): unknown {
  const logRecords = batch.map((signal) => {
    const ts = nanoString(signal.timestamp, now)
    return {
      timeUnixNano: ts,
      observedTimeUnixNano: ts,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: signal.name },
      attributes: toKeyValues(signal.attributes),
    }
  })
  return { resourceLogs: [{ resource: resourceEnvelope(resource), scopeLogs: [{ scope: { name: "opencode" }, logRecords }] }] }
}

function encodeTraces(batch: ReadonlyArray<TelemetrySignal>, resource: OtlpResource, now: number): unknown {
  const spans = batch.map((signal) => {
    const ts = nanoString(signal.timestamp, now)
    return {
      traceId: randomHex(16),
      spanId: randomHex(8),
      name: signal.name,
      kind: 1,
      startTimeUnixNano: ts,
      endTimeUnixNano: ts,
      attributes: toKeyValues(signal.attributes),
    }
  })
  return { resourceSpans: [{ resource: resourceEnvelope(resource), scopeSpans: [{ scope: { name: "opencode" }, spans }] }] }
}

/** Public for the live-validation test: encode one kind's batch as an OTLP/JSON body. */
export function encodeOtlpJson(
  kind: TelemetrySignalKind,
  batch: ReadonlyArray<TelemetrySignal>,
  resource: OtlpResource = DEFAULT_RESOURCE,
  now: number = Date.now(),
): unknown {
  if (kind === "logs") return encodeLogs(batch, resource, now)
  if (kind === "traces") return encodeTraces(batch, resource, now)
  return encodeMetrics(batch, resource, now)
}

// =============================================================================
// HTTP transport
// =============================================================================

function boundedReason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.length > 200 ? `${message.slice(0, 197)}...` : message
}

/** A transient status is worth a retry; a permanent 4xx (except 429) is not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function groupByKind(batch: ReadonlyArray<TelemetrySignal>): Map<TelemetrySignalKind, TelemetrySignal[]> {
  const groups = new Map<TelemetrySignalKind, TelemetrySignal[]>()
  for (const signal of batch) {
    const bucket = groups.get(signal.kind) ?? []
    bucket.push(signal)
    groups.set(signal.kind, bucket)
  }
  return groups
}

export function createHttpOtlpTransport(options: HttpOtlpTransportOptions): OtlpTransport {
  const base = options.endpoint.replace(/\/+$/, "")
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const retryBudget = Math.max(0, options.retryBudget ?? 0)
  const resource = options.resource ?? DEFAULT_RESOURCE
  const doFetch = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const baseHeaders = { "content-type": "application/json", ...(options.headers ?? {}) }

  /** One bounded POST; returns a typed classification the retry loop consumes. */
  async function postOnce(url: string, body: string): Promise<{ ok: boolean; retryable: boolean; reason: string | null }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await doFetch(url, { method: "POST", headers: baseHeaders, body, signal: controller.signal })
      if (response.ok) return { ok: true, retryable: false, reason: null }
      return { ok: false, retryable: isRetryableStatus(response.status), reason: `status ${response.status}` }
    } catch (cause) {
      const timedOut = controller.signal.aborted
      return { ok: false, retryable: true, reason: timedOut ? `export timed out after ${timeoutMs}ms` : boundedReason(cause) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** POST one kind's batch, retrying transient failures within the budget. */
  async function sendKind(kind: TelemetrySignalKind, signals: TelemetrySignal[]): Promise<{ ok: boolean; reason: string | null }> {
    const url = `${base}${SIGNAL_PATH[kind]}`
    const body = JSON.stringify(encodeOtlpJson(kind, signals, resource, Date.now()))
    let attempt = 0
    let last: { ok: boolean; retryable: boolean; reason: string | null } = { ok: false, retryable: false, reason: "not attempted" }
    while (attempt <= retryBudget) {
      last = await postOnce(url, body)
      if (last.ok) return { ok: true, reason: null }
      if (!last.retryable) return { ok: false, reason: last.reason }
      attempt += 1
      if (attempt <= retryBudget) await sleep(Math.min(1000, 50 * attempt))
    }
    return { ok: false, reason: last.reason }
  }

  return {
    async send(batch) {
      if (batch.length === 0) return { ok: true, reason: null }
      const groups = groupByKind(batch)
      for (const [kind, signals] of groups) {
        const result = await sendKind(kind, signals)
        if (!result.ok) return { ok: false, reason: result.reason }
      }
      return { ok: true, reason: null }
    },
    async probe() {
      // An empty metrics envelope; ANY HTTP response means the endpoint is reachable.
      const url = `${base}${SIGNAL_PATH.metrics}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        await doFetch(url, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ resourceMetrics: [] }),
          signal: controller.signal,
        })
        return { ok: true, reason: null }
      } catch (cause) {
        const timedOut = controller.signal.aborted
        return { ok: false, reason: timedOut ? `probe timed out after ${timeoutMs}ms` : boundedReason(cause) }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export * as OtlpTransport from "./otlp-transport"
