/**
 * Feature 002 — Application lifecycle barrel (T033).
 *
 * Re-exports every `packages/opencode/src/lifecycle/*` application module under
 * its own namespace, mirroring the domain-engine barrel
 * (`packages/core/src/lifecycle/index.ts`, T024) and each module's own
 * `export * as X from "./x"` self-export. This file defines no logic of its own:
 * the eventv2 adapter (T025/T030/T032), observation service (T026),
 * authorization (T027), handoff (T028), and cancel (T029) are the composition
 * surface the operator/CLI/TUI layers wire against (C2, C3).
 */

export * as EventV2Adapter from "./eventv2-adapter"
export * as ObservationService from "./observation-service"
export * as Authorization from "./authorization"
export * as Handoff from "./handoff"
export * as Cancel from "./cancel"
