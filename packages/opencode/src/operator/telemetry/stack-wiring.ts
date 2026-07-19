/**
 * Feature 013 / T005 — live runtime composition for the telemetry domain port.
 *
 * The composition-root wiring that turns the reused effective telemetry config
 * seam into the typed `telemetry` operator `DomainInvoke` override the Feature 007
 * dispatcher consumes (FR2, FR9). It mirrors how langlock is wired in
 * `operator/langlock/stack-wiring.ts`, adding NO command ids (Feature 007 stays the
 * sole registration authority; the reserved `telemetry.*` ids already live in the
 * catalog).
 *
 * The backend is injected because the real domain effects live behind the
 * Config.Service outbound seam (`store.config`) resolved against the same
 * `AppRuntime` services the rest of the live stack uses. The bounded, secret-free
 * operator access-audit sink defaults to a debug log; the composition root may
 * replace it with the Feature 007 operator audit projector feed. No async
 * resolution happens here — the port and command adapter are assembled synchronously
 * over the injected backend.
 */
export * as TelemetryStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { TelemetryCommandPort } from "./telemetry-command-port"
import type { TelemetryAuditSink, TelemetryBackend } from "./telemetry-port"

export interface TelemetryDomainWiringDeps {
  /** The un-audited domain surface over the effective telemetry config + `store.config`. */
  readonly backend: TelemetryBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: TelemetryAuditSink
}

export interface TelemetryDomainWiring {
  readonly ports: TelemetryCommandPort.TelemetryDomainPorts
  /** The un-audited telemetry backend seam (reads + validated mutation plans). */
  readonly port: TelemetryBackend
  /** Symmetry with the langlock wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a header value/endpoint credential/payload). */
const defaultAuditSink: TelemetryAuditSink = {
  record: (event) => Effect.logDebug("telemetry.operator.audit", event),
}

/**
 * Compose the live telemetry domain port over the injected backend. Returns the
 * `telemetry` `DomainInvoke` override plus the typed port for direct CLI/TUI use.
 */
export function createTelemetryDomainWiring(deps: TelemetryDomainWiringDeps): TelemetryDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const ports = TelemetryCommandPort.createTelemetryDomainPorts({ backend: deps.backend, audit })
  return {
    ports,
    port: deps.backend,
    dispose: () => {},
  }
}
