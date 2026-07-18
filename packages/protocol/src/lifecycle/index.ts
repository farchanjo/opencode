/**
 * Feature 002 — Lifecycle protocol barrel (T013).
 *
 * Re-exports the request/response payloads and typed error unions from
 * ./commands and the LifecyclePort/ProcessPort/ObservationPort interfaces
 * from ./ports, mirroring
 * doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/contracts/ports.ts.
 */

export * from "./commands"
export type { LifecyclePort, ObservationPort, ProcessPort } from "./ports"
