export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/lifecycle/ids.cue (package lifecycle.shared) one-to-one.
//
// task_id identifies the logical Task across all of its attempts; process_id
// identifies one observable attempt/execution — process_id is NEVER an OS PID
// and implies no kill semantics (FR7, C8).
//
// Name parity with routing.shared (SessionId, ParentSessionId, RootSessionId,
// ModelId, ProviderName, VariantName in ./correlation-ids) is intentional —
// this feature does not cross-import Feature 001's routing schema modules, so
// the identifier concepts are re-declared locally per C15.
//
// ANNOTATION ORDER: every exported schema is annotated with its root
// identifier BEFORE any `.check(...)` is applied, and branded (where the CUE
// definition is identifier-shaped) only after the check. Annotating an
// already-checked schema drops the root identifier from `.ast.annotations`
// in favor of annotating the last check instead, so base-then-check-then-brand
// is load-bearing for contract hygiene (see test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// TaskId identifies the logical Task across all of its attempts.
export const TaskId = Schema.String.annotate({ identifier: "LifecycleIds.TaskId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.TaskId"))
export type TaskId = typeof TaskId.Type

// ProcessId identifies one observable attempt/execution — never an OS PID (FR7).
export const ProcessId = Schema.String.annotate({ identifier: "LifecycleIds.ProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.ProcessId"))
export type ProcessId = typeof ProcessId.Type

// ParentProcessId references the parent attempt in the process tree.
export const ParentProcessId = Schema.String.annotate({ identifier: "LifecycleIds.ParentProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.ParentProcessId"))
export type ParentProcessId = typeof ParentProcessId.Type

// RootProcessId references the root attempt of the authorized tree.
export const RootProcessId = Schema.String.annotate({ identifier: "LifecycleIds.RootProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.RootProcessId"))
export type RootProcessId = typeof RootProcessId.Type

// SessionId identifies a Session; parity with routing.shared.#SessionId.
export const SessionId = Schema.String.annotate({ identifier: "LifecycleIds.SessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.SessionId"))
export type SessionId = typeof SessionId.Type

// ParentSessionId references the direct parent Session.
export const ParentSessionId = Schema.String.annotate({ identifier: "LifecycleIds.ParentSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.ParentSessionId"))
export type ParentSessionId = typeof ParentSessionId.Type

// RootSessionId references the authorized root-session tree.
export const RootSessionId = Schema.String.annotate({ identifier: "LifecycleIds.RootSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.RootSessionId"))
export type RootSessionId = typeof RootSessionId.Type

// RuntimeInstanceId identifies the runtime that owns a process.
export const RuntimeInstanceId = Schema.String.annotate({ identifier: "LifecycleIds.RuntimeInstanceId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.RuntimeInstanceId"))
export type RuntimeInstanceId = typeof RuntimeInstanceId.Type

// LeaseId identifies an in-memory watchdog lease (never PID, never SQLite-per-beat).
export const LeaseId = Schema.String.annotate({ identifier: "LifecycleIds.LeaseId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.LeaseId"))
export type LeaseId = typeof LeaseId.Type

// EventId is the EventV2 evt_ identifier assigned per published event.
export const EventId = Schema.String.annotate({ identifier: "LifecycleIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("Lifecycle.EventId"))
export type EventId = typeof EventId.Type
