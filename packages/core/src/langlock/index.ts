/**
 * Feature 004 — Lang Lock domain engine barrel (T024).
 *
 * Re-exports every framework-free `packages/core/src/langlock/*` domain module under
 * its own namespace, one line per module, mirroring `packages/core/src/jobs/index.ts`
 * and `packages/core/src/lifecycle/index.ts` and each module's own
 * `export * as X from "./x"` self-export. This file defines no domain logic of its
 * own.
 *
 * The `langlock.*` EventV2 bus and idempotent projector (`event-bus.ts`, T021) is the
 * EventV2-bound module that re-exports the schema-layer `langlock.*` Definitions and
 * classifies event records for idempotent projection; it is re-exported below
 * alongside the pure domain modules (T016–T020) and the telemetry instruments
 * (`langlock-instruments.ts`, T023).
 */

export * as AdvisoryDetector from "./advisory-detector"
export * as EventBus from "./event-bus"
export * as ExceptionMatcher from "./exception-matcher"
export * as LangLockInstruments from "./langlock-instruments"
export * as PathKind from "./path-kind"
export * as PolicyResolution from "./policy-resolution"
export * as TagValidation from "./tag-validation"
