/**
 * Feature 008 / T036 (S24) — MCP `notifications/message` → native logging bridge.
 *
 * Integrates MCP server log notifications into native logging under REDACTION
 * (secrets, tokens, and path-shaped fields stripped) and RATE LIMITS, following the
 * native logging retention policy (no separate MCP store). The operator
 * `logging/setLevel` is reached ONLY through the Feature 007 `mcp.logging.level.set`
 * command (audited) — never from the model or the data plane (FR28, C23). Pure over
 * an injected clock; the actual `Effect.log*` emission is performed by the host.
 */
export * as McpLoggingBridge from "./logging-bridge"

/** An incoming MCP log notification (already parsed by the SDK schema). */
export interface McpLogNotification {
  readonly server: string
  readonly level: "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"
  readonly logger?: string
  readonly data?: unknown
}

/** A redacted, rate-limit-decided log record ready for native logging (content-free of secrets/paths). */
export type LogDecision =
  | { readonly emit: true; readonly severity: "debug" | "info" | "warning" | "error"; readonly fields: Record<string, unknown> }
  | { readonly emit: false; readonly reason: "rate_limited" }

const SECRET_KEY = /(secret|token|password|authorization|api[_-]?key|bearer)/i
const PATH_SHAPED = /^(\/|[a-zA-Z]:\\|file:\/\/|~\/)/

/** Redact a value: drop secret-shaped keys, mask path-shaped strings; recursive and bounded (C23, C26). */
export function redact(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]"
  if (typeof value === "string") return PATH_SHAPED.test(value) ? "[path]" : value
  if (Array.isArray(value)) return value.map((v) => redact(v))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k)
    return out
  }
  return value
}

/** Map an MCP syslog-style level to a native logging severity (C23). */
export function severityFor(level: McpLogNotification["level"]): "debug" | "info" | "warning" | "error" {
  switch (level) {
    case "debug": return "debug"
    case "info":
    case "notice": return "info"
    case "warning": return "warning"
    default: return "error"
  }
}

export interface LoggingBridgeDeps {
  readonly nowMillis: () => number
  /** Max notifications admitted per server per window (rate limit); the rest are dropped (C23). */
  readonly maxPerWindow: number
  readonly windowMs: number
}

export interface LoggingBridge {
  readonly ingest: (notification: McpLogNotification) => LogDecision
}

interface Window {
  count: number
  startedAt: number
}

/**
 * Build the logging bridge. Each notification is redacted and rate-limited per
 * server; an over-rate notification is dropped rather than emitted, and no MCP log
 * is retained outside native logging (C23). Pure decision over the injected clock.
 */
export const createLoggingBridge = (deps: LoggingBridgeDeps): LoggingBridge => {
  const windows = new Map<string, Window>()
  return {
    ingest: (notification) => {
      const now = deps.nowMillis()
      const w = windows.get(notification.server)
      if (!w || now - w.startedAt >= deps.windowMs) {
        windows.set(notification.server, { count: 1, startedAt: now })
      } else if (w.count >= deps.maxPerWindow) {
        return { emit: false, reason: "rate_limited" }
      } else {
        w.count += 1
      }
      const fields = { server: notification.server, logger: notification.logger, data: redact(notification.data) }
      return { emit: true, severity: severityFor(notification.level), fields }
    },
  }
}
