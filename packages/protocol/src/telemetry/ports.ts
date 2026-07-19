/**
 * Feature 013 — Telemetry operator-domain application port (T001).
 *
 * TypeScript mirror of the `TelemetryDomainPort` inbound-port interface for the
 * telemetry operator surface, mirroring protocol/src/langlock/ports.ts. It is
 * implemented by the telemetry domain stack
 * (`packages/opencode/src/operator/telemetry/**`) over the reused effective
 * telemetry config, and is consumed by the Feature 007 operator control-plane
 * command adapter (ADR-0003). Feature 013 registers no parallel command registry,
 * config store, or dispatch path (FR11) — Feature 007 stays the sole registration
 * authority.
 *
 * Request/response payloads and the typed error union live in ./commands — this
 * file defines only the port method signatures.
 */

import type { Effect } from "effect"
import type {
  ProbeResult,
  TelemetryConfigureInput,
  TelemetryDomainError,
  TelemetryMutationOutput,
  TelemetryResolveOutput,
  TelemetryToggleInput,
} from "./commands"

/**
 * Backs the reserved `telemetry.status|show|on|off|configure|test` operator
 * command surface (registered via Feature 007; Feature 013 supplies only this
 * typed domain implementation, ADR-0003). Reads project the redacted effective
 * telemetry config; `on`/`off`/`configure` are optimistic CAS writes over the
 * SAME Config.Service seam langlock uses; `test` is a bounded, test-signal-only
 * OTLP reachability probe that mutates nothing and never blocks the loop (FR2,
 * FR6, FR7, FR8). Session, user, LLM, agent, plugin, and MCP mutation is
 * prohibited — this port has no unauthenticated or LLM-reachable entry point.
 */
export interface TelemetryDomainPort {
  /** Backs `telemetry.status` and `telemetry.show`; redacted, content-free (FR2). */
  readonly resolve: () => Effect.Effect<TelemetryResolveOutput, TelemetryDomainError>

  /** Backs `telemetry.on`; CAS-guarded enable of the effective export (FR2, FR7). */
  readonly on: (input: TelemetryToggleInput) => Effect.Effect<TelemetryMutationOutput, TelemetryDomainError>

  /** Backs `telemetry.off`; CAS-guarded disable of the effective export (FR2, FR7). */
  readonly off: (input: TelemetryToggleInput) => Effect.Effect<TelemetryMutationOutput, TelemetryDomainError>

  /** Backs `telemetry.configure`; CAS write persisting the export header as a `SecretRef` only (FR6, Security). */
  readonly configure: (input: TelemetryConfigureInput) => Effect.Effect<TelemetryMutationOutput, TelemetryDomainError>

  /** Backs `telemetry.test`; a real bounded OTLP reachability probe, test-signal only (FR6, FR10). */
  readonly test: () => Effect.Effect<ProbeResult, TelemetryDomainError>
}
