/**
 * Feature 003 — Jobs domain engine barrel (T020).
 *
 * Re-exports every framework-free `packages/core/src/jobs/*` domain module under
 * its own namespace, one line per module, mirroring
 * `packages/core/src/lifecycle/index.ts` and each module's own
 * `export * as X from "./x"` self-export. This file defines no domain logic of
 * its own.
 *
 * The `job.*` EventV2 bus and idempotent projector (`event-bus.ts`, T017) is the
 * EventV2-bound module that re-exports the schema-layer `job.*` Definitions and
 * classifies event records for idempotent projection; it is re-exported below
 * alongside the pure domain modules (T013–T016) and the telemetry instruments
 * (`jobs-instruments.ts`, T019).
 */

export * as Cron from "./cron"
export * as EventBus from "./event-bus"
export * as JobsInstruments from "./jobs-instruments"
export * as Misfire from "./misfire"
export * as OccurrenceStateMachine from "./occurrence-state-machine"
export * as Overlap from "./overlap"
export * as Reconciliation from "./reconciliation"
export * as SchedulerEngine from "./scheduler-engine"
