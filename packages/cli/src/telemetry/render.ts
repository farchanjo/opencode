import { fallback, isRecord, onOff, yesNo } from "../operator/output"

/**
 * Feature 001 / T032 — human renderers for the telemetry command surface.
 * Pure string builders over the redacted TelemetryPort response views; never
 * touch process streams so they stay unit-testable.
 */

function signalsLine(signals: unknown): string | undefined {
  if (!isRecord(signals)) return undefined
  const parts = ["metrics", "logs", "traces", "profiling"].map((name) => `${name}=${onOff(signals[name])}`)
  return `signals: ${parts.join(" ")}`
}

function redactLine(redact: unknown): string | undefined {
  if (!isRecord(redact)) return undefined
  const parts = ["prompts", "secrets", "file_paths", "tool_payloads"].map((name) => `${name}=${onOff(redact[name])}`)
  return `redact: ${parts.join(" ")}`
}

function configLines(config: unknown): string[] {
  if (!isRecord(config)) return []
  const lines: string[] = []
  if (config.endpoint) lines.push(`endpoint: ${String(config.endpoint)}`)
  if (config.transport) lines.push(`transport: ${String(config.transport)}`)
  const signals = signalsLine(config.signals)
  if (signals) lines.push(signals)
  const redact = redactLine(config.redact)
  if (redact) lines.push(redact)
  return lines
}

export function renderStatus(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`telemetry: ${effective.enabled === true ? "enabled" : "disabled"}`]
  lines.push(...configLines(effective.config))
  if (effective.exportHealth !== undefined) {
    const depth = effective.queueDepth ?? 0
    const capacity = effective.queueCapacity ?? 0
    lines.push(
      `export: ${String(effective.exportHealth)} (queue ${depth}/${capacity}, drops ${effective.dropCount ?? 0}, errors ${effective.exportErrorCount ?? 0})`,
    )
  }
  if (effective.offline !== undefined) lines.push(`offline: ${yesNo(effective.offline)}`)
  return lines.join("\n")
}

export function renderShow(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines: string[] = []
  if (effective.origin !== undefined) lines.push(`origin: ${String(effective.origin)}`)
  lines.push(...configLines(effective.config))
  return lines.length ? lines.join("\n") : fallback(effective)
}

export function renderTest(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`test (${String(effective.mode ?? "signal")}): ${String(effective.outcome ?? "unknown")}`]
  lines.push(`signal emitted: ${yesNo(effective.testSignalEmitted)}`)
  lines.push(`no user content exported: ${yesNo(effective.noUserContentExported)}`)
  if (effective.reason) lines.push(`reason: ${String(effective.reason)}`)
  return lines.join("\n")
}

export function renderConfigure(): string {
  return "telemetry configuration flow opened; no raw secrets accepted on the command line"
}

export * as TelemetryRender from "./render"
