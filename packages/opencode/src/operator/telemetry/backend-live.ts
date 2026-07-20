/**
 * Feature 013 / T005 — live `TelemetryBackend` composition for the operator stack.
 *
 * Turns the reused effective telemetry config into the un-audited
 * `TelemetryBackend` seam the `telemetry` command adapter consumes. It reads the
 * SAME Config.Service authority the routing/telemetry runtime already binds — reads
 * project the redacted effective config resolved via `resolveEffectiveTelemetryConfig`
 * (reused, not re-authored, FR2); `planOn`/`planOff`/`planConfigure` VALIDATE the
 * mutation and return an `OperatorMutationPlan` (authority + pure transform) so the
 * Feature 007 `mutateAuthority` pipeline owns the single committed CAS write under
 * the operator's `expectedVersion` and emits the audit correlation (FR7) — the
 * backend never self-commits, so a rejected mutation leaves no persisted write.
 * `planConfigure` persists the export header as a `SecretRef` only, validated against
 * its canonical pattern — never a plaintext credential (FR6, Security).
 *
 * Honest degradation, never a fabricated success (FR8): every config read is
 * guarded with `Effect.tryPromise` and mapped onto the typed `TelemetryDomainError`
 * (`unavailable` | `invalid_argument` | `version_conflict`). `test` resolves the
 * `misconfigured` (absent/malformed endpoint) case itself with NO network I/O and
 * delegates a valid target to the injected `TelemetryProbe` reachability dial
 * (finalized in T012); it mutates nothing and never blocks the loop (FR6, FR10).
 */
export * as TelemetryBackendLive from "./backend-live"

import { Effect, Exit, Schema } from "effect"
import { TelemetryConfig } from "@opencode-ai/schema/telemetry/config"
import { DEFAULT_TELEMETRY_CONFIG, resolveEffectiveTelemetryConfig } from "@/routing/application/telemetry-service"
import { INITIAL_CONFIG_VERSION, type ConfigEntry, type ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  ConfigVersion,
  ProbeResult,
  ProbeTarget,
  SecretRef,
  TelemetryConfigureInput,
  TelemetryDomainError,
  TelemetrySummary,
  TelemetryToggleInput,
} from "@opencode-ai/protocol/telemetry/commands"
import type { TelemetryBackend, TelemetryProbe } from "./telemetry-port"

/**
 * The Config.Service authority the operator telemetry domain manages. Global scope
 * is prefixed so the durable store routes it to the global document; effective
 * reads still shadow project → global → default via `resolveEffectiveTelemetryConfig`.
 */
export const AUTHORITY = "global:telemetry" as const

/** The canonical export-header key a `SecretRef` is persisted under (never a plaintext value). */
const EXPORT_HEADER_KEY = "authorization" as const

/** The `SecretRef` canonical encoding: `backend:name[@vN]`, or empty for "unset" (Security, FR6). */
const SECRET_REF_PATTERN = /^(?:[A-Za-z0-9._-]+:[^@]+(?:@v[1-9]\d*)?)?$/

/** OTLP-compatible endpoint the probe may dial; anything else resolves `misconfigured` with no I/O (FR6). */
const ENDPOINT_PATTERN = /^https?:\/\//

const decodeConfig = Schema.decodeUnknownExit(TelemetryConfig)

const unavailable = (reason: string): TelemetryDomainError => ({ type: "unavailable", reason })

/** Decode a persisted payload into a `TelemetryConfig`; null when it fails schema validation. */
function parseConfig(payload: unknown): TelemetryConfig | null {
  const exit = decodeConfig(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as TelemetryConfig) : null
}

export interface LiveTelemetryBackendDeps {
  readonly config: ConfigPort
  /** The outbound OTLP reachability dial; defaults to an honest "not configured" gap until T012. */
  readonly probe?: TelemetryProbe
  readonly now?: () => number
}

/** Fail-honest default: no reachability dial is bound, so a valid-target probe degrades to `unavailable` (FR8). */
const DEFAULT_PROBE: TelemetryProbe = {
  dial: () => Effect.fail<TelemetryDomainError>(unavailable("telemetry reachability probe is not configured")),
}

/** Project a resolved telemetry config onto the redacted operator summary (FR2, Security). */
function toSummary(
  config: TelemetryConfig,
  version: ConfigVersion,
  updatedAtMs: number,
  configured: boolean,
): TelemetrySummary {
  return {
    enabled: config.enabled,
    configured,
    available: true,
    transport: config.export.transport,
    endpoint: config.export.endpoint,
    updatedAt: new Date(updatedAtMs).toISOString(),
    version,
  }
}

export function createLiveTelemetryBackend(deps: LiveTelemetryBackendDeps): TelemetryBackend {
  const config = deps.config
  const probe = deps.probe ?? DEFAULT_PROBE
  const now = deps.now ?? Date.now

  /** Read the managed authority entry; a Config.Service failure degrades to `unavailable` (FR8). */
  const readEntry = (): Effect.Effect<ConfigEntry | null, TelemetryDomainError> =>
    Effect.tryPromise({
      try: () => config.get(AUTHORITY),
      catch: () => unavailable("telemetry config authority is unreachable"),
    })

  /** Resolve the effective telemetry config (reused, offline-safe); a failure degrades to `unavailable`. */
  const readEffective = (): Effect.Effect<TelemetryConfig, TelemetryDomainError> =>
    Effect.tryPromise({
      try: () => resolveEffectiveTelemetryConfig(config),
      catch: () => unavailable("effective telemetry config is unreachable"),
    })

  const resolve = (): Effect.Effect<TelemetrySummary, TelemetryDomainError> =>
    Effect.gen(function* () {
      const effective = yield* readEffective()
      const entry = yield* readEntry()
      const version = entry?.version ?? INITIAL_CONFIG_VERSION
      return toSummary(effective, version, entry?.updatedAtMs ?? now(), entry !== null)
    })

  /**
   * Validate a transformed config at plan time and hand the dispatcher an
   * `OperatorMutationPlan` — the CAS write + audit are executed once by
   * `mutateAuthority`, never here (no self-commit). CAS ordering guarantees the
   * committed `current` equals the plan-time base, so the pure `apply` closes over
   * the pre-validated payload (`current` is redundant but re-decoded defensively).
   */
  const planMutate = (
    transform: (base: TelemetryConfig) => TelemetryConfig,
  ): Effect.Effect<OperatorMutationPlan, TelemetryDomainError> =>
    Effect.gen(function* () {
      const entry = yield* readEntry()
      const base = (entry ? parseConfig(entry.payload) : null) ?? (yield* readEffective())
      const next = decodeConfig(transform(base), { errors: "all" })
      if (Exit.isFailure(next)) {
        return yield* Effect.fail<TelemetryDomainError>({ type: "invalid_argument", field: "config", reason: "telemetry configuration failed schema validation" })
      }
      const payload = next.value as TelemetryConfig
      const apply = (current: unknown): TelemetryConfig => {
        const currentBase = parseConfig(current) ?? base
        const decoded = decodeConfig(transform(currentBase), { errors: "all" })
        return Exit.isSuccess(decoded) ? (decoded.value as TelemetryConfig) : payload
      }
      return { authority: AUTHORITY, apply }
    })

  const planOn = (_input: TelemetryToggleInput): Effect.Effect<OperatorMutationPlan, TelemetryDomainError> =>
    planMutate((base) => ({ ...base, enabled: true }))

  const planOff = (_input: TelemetryToggleInput): Effect.Effect<OperatorMutationPlan, TelemetryDomainError> =>
    planMutate((base) => ({ ...base, enabled: false }))

  const planConfigure = (input: TelemetryConfigureInput): Effect.Effect<OperatorMutationPlan, TelemetryDomainError> =>
    Effect.gen(function* () {
      const secretError = validateSecretRef(input.headerSecret)
      if (secretError) return yield* Effect.fail(secretError)
      return yield* planMutate((base) => configureExport(base, input))
    })

  const test = (): Effect.Effect<ProbeResult, TelemetryDomainError> =>
    Effect.gen(function* () {
      const effective = yield* readEffective()
      const target: ProbeTarget = { transport: effective.export.transport, endpoint: effective.export.endpoint }
      if (!ENDPOINT_PATTERN.test(effective.export.endpoint)) {
        return { outcome: "misconfigured", target, reason: "no valid OTLP export endpoint is configured" }
      }
      const reach = yield* probe.dial(target)
      return { outcome: reach.reachable ? "reachable" : "unreachable", target, reason: reach.reason }
    })

  return { resolve, planOn, planOff, planConfigure, test }
}

/** Reject a plaintext-looking header secret; only the canonical `SecretRef` pattern is accepted (FR6, Security). */
function validateSecretRef(headerSecret: SecretRef | undefined): TelemetryDomainError | null {
  if (headerSecret === undefined) return null
  if (SECRET_REF_PATTERN.test(headerSecret)) return null
  return { type: "invalid_argument", field: "headerSecret", reason: "export header must be a SecretRef, never a plaintext secret" }
}

/** Apply a `configure` mutation onto the export target; the header is persisted as a `SecretRef` only. */
function configureExport(base: TelemetryConfig, input: TelemetryConfigureInput): TelemetryConfig {
  const headers =
    input.headerSecret === undefined
      ? base.export.headers
      : { ...base.export.headers, [EXPORT_HEADER_KEY]: input.headerSecret }
  return { ...base, export: { ...base.export, transport: input.transport, endpoint: input.endpoint, headers } }
}

/** Exposed for tests and the composition root — the safe disabled default used to seed an absent authority. */
export const DEFAULT_CONFIG = DEFAULT_TELEMETRY_CONFIG
