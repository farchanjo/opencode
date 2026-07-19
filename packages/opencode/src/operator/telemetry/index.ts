/**
 * Feature 013 / T005 — operator telemetry domain barrel.
 *
 * Re-exports the typed `telemetry.*` domain implementation (`telemetry-port.ts`),
 * the Feature 007 `DomainInvoke` command adapter (`telemetry-command-port.ts`), the
 * live composition wiring (`stack-wiring.ts`), the live `TelemetryBackend`
 * composition over the reused effective telemetry config + Config.Service
 * persistence (`backend-live.ts`), and the bounded OTLP reachability probe backing
 * `telemetry.test` (`probe-live.ts`). Feature 013 supplies only these typed domain
 * query/command implementations and their audit events; Feature 007 remains the
 * sole command-registration authority. The reserved
 * `telemetry.status|show|on|off|configure|test` ids already live in the catalog —
 * no catalog bump is performed (FR11).
 */

export * as TelemetryOperatorPort from "./telemetry-port"
export * as TelemetryCommandPort from "./telemetry-command-port"
export * as TelemetryBackendLive from "./backend-live"
export * as TelemetryProbeLive from "./probe-live"
export * as TelemetryStackWiring from "./stack-wiring"
