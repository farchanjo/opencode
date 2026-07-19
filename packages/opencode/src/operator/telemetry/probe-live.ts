/**
 * Feature 013 / T012 — the real, bounded `telemetry.test` OTLP reachability probe.
 *
 * The outbound `TelemetryProbe` seam `backend-live.ts` delegates to once the
 * effective telemetry config yields a valid target (the backend resolves the
 * `misconfigured` — absent/malformed endpoint — case itself with NO network I/O,
 * so this probe only ever sees a well-formed `https?://` endpoint). The dial is a
 * real, environment-agnostic connectivity check bounded by an explicit timeout
 * (FR6, FR10; lifecycle `doc/arch/statecharts/telemetry-probe.md`):
 *
 *   - `http/protobuf` → a minimal, empty POST to `<endpoint>/v1/metrics`; ANY HTTP
 *     response means the endpoint accepted the probe → `reachable`. A refused
 *     connection, TLS failure, DNS failure, or timeout → `unreachable`.
 *   - `grpc` → a bare TCP dial to the endpoint host:port; a completed handshake →
 *     `reachable`, a refused/timed-out dial → `unreachable`.
 *
 * It is TEST-SIGNAL ONLY (Feature 007 FR30): it sends no telemetry signal content
 * beyond the empty reachability probe, carries none of the configured export
 * headers (no secret ever leaves this seam), mutates nothing, and NEVER blocks the
 * operator loop — a timeout resolves `unreachable` rather than hanging. The dial
 * always resolves to a `ProbeReachability`; it never throws or fails the Effect.
 */
export * as TelemetryProbeLive from "./probe-live"

import net from "node:net"
import { Effect } from "effect"
import type { ProbeTarget, TelemetryDomainError } from "@opencode-ai/protocol/telemetry/commands"
import type { ProbeReachability, TelemetryProbe } from "./telemetry-port"

/** The bounded default dial timeout (ms); the probe never blocks the loop beyond this. */
const DEFAULT_TIMEOUT_MS = 3000

export interface LiveTelemetryProbeDeps {
  /** Explicit dial timeout in ms; a slow endpoint resolves `unreachable` at this bound (FR6, FR10). */
  readonly timeoutMs?: number
  /** Injected fetch for the http transport (tests); defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch
  /** Injected TCP connector for the grpc transport (tests); defaults to `node:net`. */
  readonly connect?: (opts: { readonly host: string; readonly port: number }) => net.Socket
}

/** Append the OTLP metrics path once; a target endpoint carries no path in practice. */
function metricsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "")
  return trimmed.endsWith("/v1/metrics") ? trimmed : `${trimmed}/v1/metrics`
}

/** Resolve the host:port a grpc dial targets from the `https?://host:port` endpoint. */
function parseHostPort(endpoint: string): { readonly host: string; readonly port: number } | null {
  try {
    const url = new URL(endpoint)
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80
    if (url.hostname.length === 0 || !Number.isInteger(port)) return null
    return { host: url.hostname, port }
  } catch {
    return null
  }
}

/** A minimal, empty POST to `<endpoint>/v1/metrics`; any HTTP response is a reachable endpoint. */
async function dialHttp(endpoint: string, timeoutMs: number, doFetch: typeof globalThis.fetch): Promise<ProbeReachability> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await doFetch(metricsUrl(endpoint), { method: "POST", body: "", signal: controller.signal })
    return { reachable: true }
  } catch {
    return { reachable: false, reason: controller.signal.aborted ? `probe timed out after ${timeoutMs}ms` : "endpoint refused or unreachable" }
  } finally {
    clearTimeout(timer)
  }
}

/** A bare, bounded TCP dial to the grpc endpoint host:port; a completed handshake is reachable. */
function dialTcp(
  endpoint: string,
  timeoutMs: number,
  connect: (opts: { readonly host: string; readonly port: number }) => net.Socket,
): Promise<ProbeReachability> {
  const parsed = parseHostPort(endpoint)
  if (parsed === null) return Promise.resolve({ reachable: false, reason: "endpoint is not a valid host:port target" })
  return new Promise<ProbeReachability>((resolve) => {
    const socket = connect({ host: parsed.host, port: parsed.port })
    let settled = false
    const done = (result: ProbeReachability): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done({ reachable: true }))
    socket.once("timeout", () => done({ reachable: false, reason: `probe timed out after ${timeoutMs}ms` }))
    socket.once("error", () => done({ reachable: false, reason: "endpoint refused or unreachable" }))
  })
}

/**
 * Build the live OTLP reachability probe. The returned `dial` always resolves to a
 * bounded `ProbeReachability` — it never fails the Effect or blocks the loop (FR6,
 * FR10). Inject `fetch`/`connect`/`timeoutMs` in tests; production uses the global
 * `fetch` and `node:net` with the default timeout.
 */
export function createLiveTelemetryProbe(deps: LiveTelemetryProbeDeps = {}): TelemetryProbe {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = deps.fetch ?? globalThis.fetch
  const connect = deps.connect ?? ((opts) => net.createConnection(opts))

  const dial = (target: ProbeTarget): Effect.Effect<ProbeReachability, TelemetryDomainError> =>
    Effect.promise(() =>
      target.transport === "grpc" ? dialTcp(target.endpoint, timeoutMs, connect) : dialHttp(target.endpoint, timeoutMs, doFetch),
    )

  return { dial }
}
