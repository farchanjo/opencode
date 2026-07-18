/**
 * Telemetry application service (Feature 001 — T012, T013).
 *
 * T012 — privacy redaction defaults: strip prompts, secrets, personal paths,
 * file content, and tool payloads from any telemetry attribute bag, gated per
 * signal and per redaction flag from TelemetryConfig.
 *
 * T013 — TelemetryPort implementation (status, enable, disable, show, configure,
 * test, flush). Config is read/written through the Feature 007 Config.Service
 * adapter (ConfigPort) and referenced secrets are validated through the
 * SecretPort. All reads (status/show) are offline-capable and zero-cost: they
 * touch only local config and the in-memory export sink — never a model, never
 * the network.
 *
 * The actual OTLP export mechanics (bounded queue + exporter) live behind the
 * TelemetrySink port implemented by the outbound OTLP adapter (T014).
 */

import { Effect, Exit, Schema } from "effect"
import { TelemetryConfig } from "@opencode-ai/schema/telemetry/config"
import type { EffectiveConfig, ConfigOrigin, ExportHealth } from "@opencode-ai/protocol/telemetry/index"
import { isSecretFieldName, isExactSecretRef } from "@opencode-ai/core/operator"
import type { SecretBackend } from "@opencode-ai/core/operator"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { SecretPort } from "@/operator/application/ports/secret-port"

// =============================================================================
// T012 — Privacy redaction
// =============================================================================

// Redacted attribute values collapse to this content-free sentinel.
export const REDACTED = "[redacted]" as const

// Personal home-directory path placeholder.
const REDACTED_PATH = "[redacted-path]" as const

// RedactionPolicy mirrors TelemetryConfig.redact, privacy-first (all on).
export interface RedactionPolicy {
  readonly prompts: boolean
  readonly secrets: boolean
  readonly filePaths: boolean
  readonly fileContent: boolean
  readonly toolPayloads: boolean
}

export const DEFAULT_REDACTION_POLICY: RedactionPolicy = {
  prompts: true,
  secrets: true,
  filePaths: true,
  fileContent: true,
  toolPayloads: true,
}

// Attribute keys carrying raw prompt / instruction / model-conversation text.
const PROMPT_KEYS = new Set(
  [
    "prompt",
    "prompts",
    "message",
    "messages",
    "system",
    "system_prompt",
    "instruction",
    "instructions",
    "input",
    "completion",
    "response",
    "reasoning",
    "thinking",
  ].map((k) => k.toLowerCase()),
)

// Attribute keys carrying file content (bodies, diffs, snippets), gated by the
// dedicated redact.file_content flag; when that flag is absent from a config,
// redactionPolicyFromConfig falls back to tool_payloads for compatibility.
const FILE_CONTENT_KEYS = new Set(
  ["content", "file_content", "filecontent", "source", "snippet", "diff", "patch", "body", "text"].map((k) =>
    k.toLowerCase(),
  ),
)

// Attribute keys carrying tool call arguments / results.
const TOOL_PAYLOAD_KEYS = new Set(
  [
    "arguments",
    "args",
    "tool_input",
    "toolinput",
    "tool_arguments",
    "parameters",
    "params",
    "payload",
    "result",
    "output",
    "tool_result",
    "toolresult",
    "tool_output",
    "tooloutput",
  ].map((k) => k.toLowerCase()),
)

const MAX_REDACT_DEPTH = 12

// redactionPolicyFromConfig maps the persisted redact flags onto the policy.
export function redactionPolicyFromConfig(config: TelemetryConfig): RedactionPolicy {
  return {
    prompts: config.redact.prompts,
    secrets: config.redact.secrets,
    filePaths: config.redact.file_paths,
    fileContent: config.redact.file_content ?? config.redact.tool_payloads,
    toolPayloads: config.redact.tool_payloads,
  }
}

// signalEnabled gates a signal on both master enablement and the per-signal flag.
export function signalEnabled(config: TelemetryConfig, signal: keyof TelemetryConfig["signals"]): boolean {
  return config.enabled && config.signals[signal]
}

// redactPersonalPaths rewrites absolute home-directory prefixes so no username
// or personal path segment leaves the process. Non-path strings pass through.
export function redactPersonalPaths(value: string): string {
  return value
    .replace(/(?:\/Users|\/home)\/[^/\s]+(?=\/|$)/g, REDACTED_PATH)
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+(?=\\|$)/g, REDACTED_PATH)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function redactKeyClass(key: string, policy: RedactionPolicy): boolean {
  const lower = key.toLowerCase()
  if (policy.secrets && isSecretFieldName(key)) return true
  if (policy.prompts && PROMPT_KEYS.has(lower)) return true
  if (policy.fileContent && FILE_CONTENT_KEYS.has(lower)) return true
  if (policy.toolPayloads && TOOL_PAYLOAD_KEYS.has(lower)) return true
  return false
}

function redactValue(value: unknown, policy: RedactionPolicy, depth: number): unknown {
  if (typeof value === "string") return policy.filePaths ? redactPersonalPaths(value) : value
  if (Array.isArray(value)) {
    if (depth >= MAX_REDACT_DEPTH) return REDACTED
    return value.map((item) => redactValue(item, policy, depth + 1))
  }
  if (isPlainObject(value)) {
    if (policy.secrets && isExactSecretRef(value)) return REDACTED
    if (depth >= MAX_REDACT_DEPTH) return REDACTED
    return redactRecord(value, policy, depth + 1)
  }
  return value
}

function redactRecord(record: Record<string, unknown>, policy: RedactionPolicy, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = redactKeyClass(key, policy) ? REDACTED : redactValue(value, policy, depth)
  }
  return out
}

// redactAttributes returns a privacy-safe copy of a telemetry attribute bag.
// Never mutates the input, never throws, bounded in depth.
export function redactAttributes(
  attributes: Record<string, unknown>,
  policy: RedactionPolicy = DEFAULT_REDACTION_POLICY,
): Record<string, unknown> {
  return redactRecord(attributes, policy, 0)
}

// =============================================================================
// T013 — TelemetryPort
// =============================================================================

// TelemetryError mirrors contracts/ports.ts TelemetryError.
export type TelemetryError =
  | { readonly type: "validation_failed"; readonly fields: Record<string, string> }
  | { readonly type: "connection_failed"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

export type TelemetryScope = "global" | "project"
export type TelemetryTestMode = "signal" | "connectivity"

export interface TelemetryStatusOutput {
  readonly enabled: boolean
  readonly config: EffectiveConfig
  readonly exportHealth: ExportHealth
  readonly queueDepth: number
  readonly queueCapacity: number
  readonly dropCount: number
  readonly exportErrorCount: number
  readonly offline: boolean
}

export interface TelemetryShowOutput {
  readonly config: EffectiveConfig
  readonly origin: ConfigOrigin
}

export interface TelemetryTestOutput {
  readonly mode: TelemetryTestMode
  readonly outcome: "ok" | "unavailable" | "error"
  readonly reason: string | null
  readonly testSignalEmitted: boolean
  readonly noUserContentExported: true
}

export interface TelemetryFlushOutput {
  readonly flushedRecords: number
  readonly discardedRecords: number
  readonly durationMs: number
}

export interface TelemetryPort {
  readonly status: () => Effect.Effect<TelemetryStatusOutput, TelemetryError>
  readonly enable: (scope: TelemetryScope) => Effect.Effect<TelemetryStatusOutput, TelemetryError>
  readonly disable: (scope: TelemetryScope) => Effect.Effect<TelemetryStatusOutput, TelemetryError>
  readonly show: () => Effect.Effect<TelemetryShowOutput, TelemetryError>
  readonly configure: (scope: TelemetryScope) => Effect.Effect<void, TelemetryError>
  readonly test: (mode: TelemetryTestMode) => Effect.Effect<TelemetryTestOutput, TelemetryError>
  readonly flush: () => Effect.Effect<TelemetryFlushOutput, TelemetryError>
}

// TelemetrySink is the outbound export boundary (implemented by the OTLP adapter,
// T014). status/show read only `stats()`, which is in-memory and offline-safe.
export interface TelemetrySinkStats {
  readonly queueDepth: number
  readonly queueCapacity: number
  readonly dropCount: number
  readonly exportErrorCount: number
  readonly health: ExportHealth
  readonly offline: boolean
}

export interface TelemetrySink {
  readonly stats: () => TelemetrySinkStats
  readonly emitTestSignal: () => Promise<{ readonly emitted: boolean; readonly reason: string | null }>
  readonly checkConnectivity: () => Promise<{ readonly ok: boolean; readonly reason: string | null }>
  readonly flush: () => Promise<{ readonly flushed: number; readonly discarded: number; readonly durationMs: number }>
}

export interface TelemetryServiceDeps {
  readonly config: ConfigPort
  readonly secret: SecretPort
  readonly sink?: TelemetrySink
  readonly now?: () => number
}

// Default, disabled, privacy-first telemetry configuration (origin = "default").
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  export: {
    endpoint: "http://localhost:4318",
    transport: "http/protobuf",
    headers: {},
    tls: { enabled: false, cert: "" },
  },
  signals: { metrics: true, logs: true, traces: true, profiling: false },
  queue: {
    capacity: 2048,
    batch_size: 512,
    enqueue_timeout_ms: 30_000,
    export_timeout_ms: 10_000,
    retry_budget: 3,
    drop_policy: "drop",
  },
  redact: { prompts: true, secrets: true, file_paths: true, file_content: true, tool_payloads: true },
  resource_attributes: {},
  shaping: { sampling: 1, cardinality_budget: 128 },
}

// Config.Service authority keys per scope. Global authorities are prefixed so
// the durable store routes them to the global document (isGlobalAuthority).
const AUTHORITY: Record<TelemetryScope, string> = {
  global: "global:telemetry",
  project: "telemetry",
}

const decodeConfig = Schema.decodeUnknownExit(TelemetryConfig)

function parseConfig(payload: unknown): TelemetryConfig | null {
  const exit = decodeConfig(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as TelemetryConfig) : null
}

function validationErrors(payload: unknown): Record<string, string> | null {
  const exit = decodeConfig(payload, { errors: "all" })
  if (Exit.isSuccess(exit)) return null
  return { config: "telemetry configuration failed schema validation" }
}

function toEffectiveConfig(config: TelemetryConfig): EffectiveConfig {
  return {
    endpoint: config.export.endpoint,
    transport: config.export.transport,
    signals: { ...config.signals },
    queue: {
      capacity: config.queue.capacity,
      batch_size: config.queue.batch_size,
      drop_policy: config.queue.drop_policy,
    },
    redact: {
      prompts: config.redact.prompts,
      secrets: config.redact.secrets,
      file_paths: config.redact.file_paths,
      tool_payloads: config.redact.tool_payloads,
    },
  }
}

// parseTelemetrySecretRef bridges the opaque string SecretRef stored in
// TelemetryConfig into a structured operator SecretRef locator. The canonical
// encoding is `backend:name` or `backend:name@vN` (the version suffix is
// stripped; the SecretPort resolves the current version). Legacy JSON
// `{backend,name,version}` is accepted for backward compatibility, and a bare
// value falls back to an env-ref name.
export function parseTelemetrySecretRef(raw: string): { backend: SecretBackend; name: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.name === "string" && (parsed.backend === "keychain" || parsed.backend === "env-ref")) {
        return { backend: parsed.backend, name: parsed.name }
      }
    } catch {
      /* fall through to canonical / bare parsing */
    }
  }
  const sep = trimmed.indexOf(":")
  if (sep > 0) {
    const backend = trimmed.slice(0, sep)
    let name = trimmed.slice(sep + 1)
    const at = name.lastIndexOf("@v")
    if (at > 0 && /^@v[1-9]\d*$/.test(name.slice(at))) name = name.slice(0, at)
    if ((backend === "keychain" || backend === "env-ref") && name) return { backend, name }
  }
  return { backend: "env-ref", name: trimmed }
}

export function createTelemetryService(deps: TelemetryServiceDeps): TelemetryPort {
  const now = deps.now ?? Date.now

  async function readScoped(scope: TelemetryScope): Promise<{ version: string | null; config: TelemetryConfig | null }> {
    const entry = await deps.config.get(AUTHORITY[scope])
    if (!entry) return { version: null, config: null }
    return { version: entry.version, config: parseConfig(entry.payload) }
  }

  async function resolveEffective(): Promise<{ config: TelemetryConfig; origin: ConfigOrigin }> {
    const project = await readScoped("project")
    if (project.config) return { config: project.config, origin: "project" }
    const global = await readScoped("global")
    if (global.config) return { config: global.config, origin: "global" }
    return { config: DEFAULT_TELEMETRY_CONFIG, origin: "default" }
  }

  function sinkStats(config: TelemetryConfig): TelemetrySinkStats {
    if (deps.sink) return deps.sink.stats()
    return {
      queueDepth: 0,
      queueCapacity: config.queue.capacity,
      dropCount: 0,
      exportErrorCount: 0,
      health: config.enabled ? "degraded" : "unavailable",
      offline: true,
    }
  }

  function statusOutputFrom(config: TelemetryConfig): TelemetryStatusOutput {
    const stats = sinkStats(config)
    return {
      enabled: config.enabled,
      config: toEffectiveConfig(config),
      exportHealth: config.enabled ? stats.health : "unavailable",
      queueDepth: stats.queueDepth,
      queueCapacity: stats.queueCapacity,
      dropCount: stats.dropCount,
      exportErrorCount: stats.exportErrorCount,
      offline: stats.offline,
    }
  }

  // Validate that every referenced secret resolves through the SecretPort.
  // Material is never surfaced — only presence is confirmed via getRef.
  async function missingSecrets(config: TelemetryConfig): Promise<string[]> {
    const refs: Array<{ label: string; raw: string }> = []
    for (const [name, raw] of Object.entries(config.export.headers)) refs.push({ label: `headers.${name}`, raw })
    if (config.export.tls.enabled && config.export.tls.cert) {
      refs.push({ label: "tls.cert", raw: config.export.tls.cert })
    }
    const missing: string[] = []
    for (const { label, raw } of refs) {
      const parsed = parseTelemetrySecretRef(raw)
      if (!parsed) {
        missing.push(label)
        continue
      }
      const result = await deps.secret.getRef({ backend: parsed.backend, name: parsed.name })
      if (!result.ok) missing.push(label)
    }
    return missing
  }

  function setEnabled(scope: TelemetryScope, enabled: boolean): Effect.Effect<TelemetryStatusOutput, TelemetryError> {
    return Effect.gen(function* () {
      const scoped = yield* Effect.promise(() => readScoped(scope))
      const base = scoped.config ?? (yield* Effect.promise(resolveEffective)).config
      const next: TelemetryConfig = { ...base, enabled }

      const fields = validationErrors(next)
      if (fields) return yield* Effect.fail<TelemetryError>({ type: "validation_failed", fields })

      if (enabled) {
        const missing = yield* Effect.promise(() => missingSecrets(next))
        if (missing.length > 0) {
          const fieldMap = Object.fromEntries(missing.map((f) => [f, "referenced secret is not resolvable"]))
          return yield* Effect.fail<TelemetryError>({ type: "validation_failed", fields: fieldMap })
        }
      }

      const cas = yield* Effect.promise(() =>
        deps.config.compareAndSet({
          authority: AUTHORITY[scope],
          expectedVersion: scoped.version,
          payload: next,
          nowMs: now(),
        }),
      )
      if (!cas.ok) {
        const reason = cas.code === "conflict" ? `config version conflict (current ${cas.currentVersion})` : cas.reason
        return yield* Effect.fail<TelemetryError>({ type: "unavailable", reason })
      }
      return statusOutputFrom(next)
    })
  }

  return {
    status: () =>
      Effect.gen(function* () {
        const { config } = yield* Effect.promise(resolveEffective)
        return statusOutputFrom(config)
      }),

    enable: (scope) => setEnabled(scope, true),

    disable: (scope) => setEnabled(scope, false),

    show: () =>
      Effect.gen(function* () {
        const { config, origin } = yield* Effect.promise(resolveEffective)
        return { config: toEffectiveConfig(config), origin }
      }),

    // Persistent Settings flow is owned by the CLI/TUI surfaces (T032/T034);
    // the service validates that the scope has a resolvable configuration.
    configure: (scope) =>
      Effect.gen(function* () {
        const scoped = yield* Effect.promise(() => readScoped(scope))
        if (scoped.config) {
          const fields = validationErrors(scoped.config)
          if (fields) return yield* Effect.fail<TelemetryError>({ type: "validation_failed", fields })
        }
        return undefined
      }),

    test: (mode) =>
      Effect.gen(function* () {
        const { config } = yield* Effect.promise(resolveEffective)
        if (!config.enabled) {
          return {
            mode,
            outcome: "unavailable" as const,
            reason: "telemetry is disabled",
            testSignalEmitted: false,
            noUserContentExported: true as const,
          }
        }
        const missing = yield* Effect.promise(() => missingSecrets(config))
        if (missing.length > 0) {
          return {
            mode,
            outcome: "error" as const,
            reason: `unresolved secrets: ${missing.join(", ")}`,
            testSignalEmitted: false,
            noUserContentExported: true as const,
          }
        }
        if (!deps.sink) {
          return {
            mode,
            outcome: "unavailable" as const,
            reason: "no export sink configured",
            testSignalEmitted: false,
            noUserContentExported: true as const,
          }
        }
        if (mode === "signal") {
          const result = yield* Effect.promise(() => deps.sink!.emitTestSignal())
          return {
            mode,
            outcome: result.emitted ? ("ok" as const) : ("error" as const),
            reason: result.reason,
            testSignalEmitted: result.emitted,
            noUserContentExported: true as const,
          }
        }
        const result = yield* Effect.promise(() => deps.sink!.checkConnectivity())
        return {
          mode,
          outcome: result.ok ? ("ok" as const) : ("unavailable" as const),
          reason: result.reason,
          testSignalEmitted: false,
          noUserContentExported: true as const,
        }
      }),

    flush: () =>
      Effect.gen(function* () {
        if (!deps.sink) return { flushedRecords: 0, discardedRecords: 0, durationMs: 0 }
        const result = yield* Effect.promise(() => deps.sink!.flush())
        return {
          flushedRecords: result.flushed,
          discardedRecords: result.discarded,
          durationMs: result.durationMs,
        }
      }),
  }
}

export * as TelemetryService from "./telemetry-service"
