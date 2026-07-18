/**
 * Feature 002 — Domain engine barrel (T024).
 *
 * Re-exports every `packages/core/src/lifecycle/*` module under its own
 * namespace, mirroring `packages/schema/src/lifecycle/index.ts` (T012) and
 * each module's own `export * as X from "./x"` self-export. This file
 * defines no domain logic of its own (C2, C3).
 *
 * T024 depends on T014–T023 landing first (tasks.md "Dependencies"). All of
 * `event-bus.ts` (T014), `projection.ts` (T016), `state-machine.ts` (T017),
 * `process-table.ts` (T018), `admission/**` (T019–T020), `watchdog.ts`
 * (T021), `reconciliation.ts` (T022), and `lifecycle-instruments.ts` (T023)
 * exist and are re-exported below.
 */

export * as AdmissionController from "./admission/admission-controller"
export * as Capacity from "./admission/capacity"
export * as EventBus from "./event-bus"
export * as LifecycleInstruments from "./lifecycle-instruments"
export * as ProcessTable from "./process-table"
export * as Projection from "./projection"
export * as Reconciliation from "./reconciliation"
export * as StateMachine from "./state-machine"
export * as TokenBucket from "./admission/token-bucket"
export * as Watchdog from "./watchdog"
