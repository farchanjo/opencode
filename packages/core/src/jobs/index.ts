/**
 * Feature 003 — Jobs domain engine barrel (T020).
 *
 * Re-exports every framework-free `packages/core/src/jobs/*` domain module under
 * its own namespace, one line per module, mirroring
 * `packages/core/src/lifecycle/index.ts` and each module's own
 * `export * as X from "./x"` self-export. This file defines no domain logic of
 * its own.
 *
 * Scope note: the `job.*` EventV2 bus (`event-bus.ts`, T017) is an
 * Effect/EventV2-bound module owned by the wave-3 event worker; when it lands it
 * adds its own `export * as EventBus from "./event-bus"` line here. The pure
 * domain modules (T013–T016) and the already-landed telemetry instruments
 * (`jobs-instruments.ts`, T019) are re-exported below.
 */

export * as Cron from "./cron"
export * as JobsInstruments from "./jobs-instruments"
export * as Misfire from "./misfire"
export * as OccurrenceStateMachine from "./occurrence-state-machine"
export * as Overlap from "./overlap"
export * as Reconciliation from "./reconciliation"
export * as SchedulerEngine from "./scheduler-engine"
