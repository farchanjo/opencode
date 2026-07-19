/**
 * Feature 013 / T005 — the typed `telemetry.*` domain implementation backing the
 * Feature 007 operator control plane (FR2, FR6, FR7, FR8, FR11).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, the
 * reserved-name guard, AND the single committed mutation (`mutateAuthority`);
 * Feature 013 supplies ONLY the typed `TelemetryBackend` seam over the reused
 * effective telemetry config plus its bounded audit events. This module registers
 * NO command ids and adds no catalog version (the reserved
 * `telemetry.status|show|on|off|configure|test` ids already live in the catalog):
 * `resolve` projects the redacted, content-free `TelemetrySummary`; `planOn`/
 * `planOff`/`planConfigure` VALIDATE the mutation and hand the dispatcher an
 * `OperatorMutationPlan` (authority + pure transform) so `mutateAuthority` owns the
 * one CAS write under the operator's `expectedVersion` and emits the Feature 007
 * audit correlation — the backend never self-commits (that is what previously made
 * a `mutates` verb persist a write while the dispatcher reported failure). `test`
 * passes through the backend's bounded, test-signal-only OTLP reachability probe.
 *
 * The backend seam (`TelemetryBackend`) is the un-audited domain surface over the
 * reused `resolveEffectiveTelemetryConfig` / `store.config` Config.Service seam; the
 * composition root injects the real implementation. The probe seam
 * (`TelemetryProbe`) is the outbound reachability dial. This module never carries a
 * secret, endpoint credential, or raw config payload in a read view (Security); the
 * bounded, secret-free operator access audit is emitted at the command-port seam,
 * which holds the Feature 007 principal for every command.
 */
export * as TelemetryOperatorPort from "./telemetry-port"

import { Effect } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  ProbeResult,
  ProbeTarget,
  TelemetryConfigureInput,
  TelemetryDomainError,
  TelemetrySummary,
  TelemetryToggleInput,
} from "@opencode-ai/protocol/telemetry/commands"

// =============================================================================
// Audit sink — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a header value/endpoint credential/payload). */
export interface TelemetryAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "invalid"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface TelemetryAuditSink {
  readonly record: (event: TelemetryAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Probe seam — the outbound OTLP reachability dial (finalized in T012)
// =============================================================================

/** Bounded outcome of one reachability dial; carries a secret-free reason (FR6, FR8). */
export interface ProbeReachability {
  readonly reachable: boolean
  readonly reason?: string
}

/**
 * The outbound reachability seam `telemetry.test` delegates to once the effective
 * config yields a valid target. The real, timeout-bounded OTLP dial is finalized in
 * T012 (Phase 5); the backend resolves the `misconfigured` (no-target) case itself
 * without any network I/O and only calls this seam for a valid endpoint (FR6, FR10).
 */
export interface TelemetryProbe {
  readonly dial: (target: ProbeTarget) => Effect.Effect<ProbeReachability, TelemetryDomainError>
}

// =============================================================================
// Backend seam — the un-audited domain surface over the effective telemetry config
// =============================================================================

/**
 * The narrow domain seam the live composition provides over
 * `resolveEffectiveTelemetryConfig` + `store.config`. `resolve` returns the bounded
 * redacted summary (`telemetry.status`/`telemetry.show`); `planOn`/`planOff`/
 * `planConfigure` VALIDATE and return an `OperatorMutationPlan` (authority + pure
 * transform) the dispatcher commits via `mutateAuthority` — the backend never
 * self-commits; `test` returns the typed probe result (test-signal only, mutates
 * nothing).
 */
export interface TelemetryBackend {
  readonly resolve: () => Effect.Effect<TelemetrySummary, TelemetryDomainError>
  readonly planOn: (input: TelemetryToggleInput) => Effect.Effect<OperatorMutationPlan, TelemetryDomainError>
  readonly planOff: (input: TelemetryToggleInput) => Effect.Effect<OperatorMutationPlan, TelemetryDomainError>
  readonly planConfigure: (input: TelemetryConfigureInput) => Effect.Effect<OperatorMutationPlan, TelemetryDomainError>
  readonly test: () => Effect.Effect<ProbeResult, TelemetryDomainError>
}
