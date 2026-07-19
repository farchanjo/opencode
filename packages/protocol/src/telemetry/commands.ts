/**
 * Feature 013 — Telemetry operator-domain protocol payloads (T001).
 *
 * TypeScript mirror of the telemetry operator-surface ValueObjects specified in
 * doc/arch/schemas/operator-config-domains/{telemetry,probe,enums,persistence,shared}.cue
 * (FR1, FR2, FR6, FR7, FR8). The `telemetry.*` verbs read and mutate the effective
 * telemetry config over the SAME Config.Service authority
 * (`resolveEffectiveTelemetryConfig` / `store.config`) the routing stack already
 * binds; this module defines only the request/response payload shapes and the
 * typed error union the `TelemetryDomainPort` consumes. The port interface lives
 * in ./ports.
 *
 * Single-vocabulary discipline (mirrors protocol/src/langlock/commands.ts): the
 * closed telemetry enums whose authority is the reused effective-config schema
 * (`packages/schema/src/telemetry/config.ts`) — `Transport`, `SecretRef`,
 * `EndpointUrl` — are SOURCED from `@opencode-ai/schema/telemetry/config` rather
 * than re-declared, so the operator contract can never diverge from the persisted
 * config shape (NFR "Reuse the effective config"). The CamelCase protocol shapes
 * here are the operator-surface projection consumed by Feature 007 adapters,
 * distinct from the Feature 001 `TelemetryPort` request/response pairs in ./index.
 *
 * Feature 007 stays the sole command-registration authority: this module adds no
 * catalog id and bumps no catalog version (FR11). No payload carries a plaintext
 * secret or a free-form command id — `telemetry.configure` carries an export
 * header as a `SecretRef` only (FR6, Security).
 */

import type {
  EndpointUrl as SchemaEndpointUrl,
  SecretRef as SchemaSecretRef,
  Transport as SchemaTransport,
} from "@opencode-ai/schema/telemetry/config"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/operator-config-domains/shared.cue)
// =============================================================================

/** Opaque Config.Service CAS version token carried on the handled result; never parsed by the TUI (FR7, FR12). */
export type ConfigVersion = string

/** Feature 007 audit-correlation id returned by every mutation (FR7). */
export type AuditId = string

// =============================================================================
// Closed enums — SOURCED from @opencode-ai/schema/telemetry/config (single vocabulary, NFR reuse)
// =============================================================================

/** OTLP export transport the summary reports and the probe dials (FR2, FR6). */
export type Transport = SchemaTransport

/** Opaque Feature 007 SecretPort reference for an export header; never a plaintext value (FR6, Security). */
export type SecretRef = SchemaSecretRef

/** Configured OTLP export endpoint the probe targets; `http(s)://` only (FR6). */
export type EndpointUrl = SchemaEndpointUrl

/** Typed outcome of the `telemetry.test` OTLP reachability probe; test-signal only (FR6, FR10). */
export type ProbeOutcome = "reachable" | "unreachable" | "misconfigured"

// =============================================================================
// Read model (wire shape: doc/arch/schemas/operator-config-domains/telemetry.cue #TelemetrySummary)
// =============================================================================

/**
 * Redacted telemetry read model surfaced by `telemetry.status`/`telemetry.show`
 * (FR2, Security). Bounded and content-free: never an export header value, TLS
 * cert ref, raw config payload, or endpoint credential.
 */
export interface TelemetrySummary {
  readonly enabled: boolean
  readonly configured: boolean
  readonly available: boolean
  readonly transport: Transport
  readonly endpoint: EndpointUrl
  readonly updatedAt: string // ISO-8601
  readonly version: ConfigVersion
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principal permitted to mutate the telemetry config (FR7, FR11). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// TelemetryDomainPort payloads — resolve / on / off / configure / test (FR2, FR6, FR7)
// =============================================================================

/** Output of `resolve`, backing both `telemetry.status` and `telemetry.show` (FR2). */
export interface TelemetryResolveOutput {
  readonly summary: TelemetrySummary
}

/**
 * Input for `telemetry.on`/`telemetry.off`: a CAS-guarded toggle of the effective
 * export `enabled` flag under the operator principal (FR2, FR7).
 */
export interface TelemetryToggleInput {
  readonly expectedVersion: ConfigVersion
  readonly principal: OperatorPrincipal
}

/**
 * Input for `telemetry.configure`: a CAS-guarded export-target write. The header
 * secret is carried as a `SecretRef` only — never a plaintext credential (FR6,
 * Security). No plaintext-secret field exists on this payload.
 */
export interface TelemetryConfigureInput {
  readonly transport: Transport
  readonly endpoint: EndpointUrl
  readonly headerSecret?: SecretRef
  readonly expectedVersion: ConfigVersion
  readonly principal: OperatorPrincipal
}

/** Output of a `telemetry.on`/`off`/`configure` mutation: the settled summary + audit id (FR7). */
export interface TelemetryMutationOutput {
  readonly summary: TelemetrySummary
  readonly auditId: AuditId
}

// =============================================================================
// Probe (wire shape: doc/arch/schemas/operator-config-domains/probe.cue)
// =============================================================================

/** Endpoint + transport the probe dials, taken from the effective telemetry config (FR6). */
export interface ProbeTarget {
  readonly transport: Transport
  readonly endpoint: EndpointUrl
}

/**
 * Typed, content-free outcome of one `telemetry.test` run; carries a bounded,
 * secret-free reason on a non-reachable result (FR6, FR10). Sends no telemetry
 * signal content beyond the probe and mutates nothing.
 */
export interface ProbeResult {
  readonly outcome: ProbeOutcome
  readonly target: ProbeTarget
  readonly reason?: string
}

// =============================================================================
// TelemetryDomainError — closed union mirroring #MutationOutcome minus `success`
// (doc/arch/schemas/operator-config-domains/enums.cue #MutationOutcome, FR7, FR8)
// =============================================================================

/**
 * Every failure path degrades to one of these typed envelopes — never a
 * fabricated success or synthesized effective state (FR8). Each carries only a
 * bounded, secret-free reason: no stack trace, endpoint credential, secret value,
 * or raw config payload fragment is leaked (Security).
 */
export type TelemetryDomainError =
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "version_conflict"; readonly expectedVersion: ConfigVersion; readonly actualVersion: ConfigVersion }
  | { readonly type: "unavailable"; readonly reason: string }
