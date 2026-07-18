export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/ids.cue (package jobs.shared) one-to-one.
//
// Name parity with lifecycle.shared / routing.shared (SessionId,
// ParentSessionId, RootSessionId, ProcessId, RootProcessId, EventId) is
// intentional — Feature 003 does not cross-import Feature 001/002 schema
// modules, so the identifier concepts are re-declared locally (C1, C6, C16).
//
// process_id is the Feature 002 Task Process id, NEVER an OS PID and implies no
// kill semantics (FR1, C16).
//
// ANNOTATION ORDER: every exported schema is annotated with its root identifier
// BEFORE any `.check(...)`, and branded only after the check. Annotating an
// already-checked schema drops the root identifier from `.ast.annotations` in
// favor of annotating the last check, so base-then-check-then-brand is
// load-bearing for contract hygiene (see test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/
const notificationIdPattern = /^ntf_[A-Za-z0-9_-]{1,120}$/

// JobDefinitionId identifies a durable Job Definition aggregate (FR1, FR2).
export const JobDefinitionId = Schema.String.annotate({ identifier: "JobsIds.JobDefinitionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.JobDefinitionId"))
export type JobDefinitionId = typeof JobDefinitionId.Type

// ScheduleId identifies one schedule bound to a Job Definition (FR1).
export const ScheduleId = Schema.String.annotate({ identifier: "JobsIds.ScheduleId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.ScheduleId"))
export type ScheduleId = typeof ScheduleId.Type

// OccurrenceId identifies one logical trigger occurrence (FR1, FR10).
export const OccurrenceId = Schema.String.annotate({ identifier: "JobsIds.OccurrenceId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.OccurrenceId"))
export type OccurrenceId = typeof OccurrenceId.Type

// ProcessId is the Feature 002 Task Process id — never an OS PID (FR1, C16).
export const ProcessId = Schema.String.annotate({ identifier: "JobsIds.ProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.ProcessId"))
export type ProcessId = typeof ProcessId.Type

// RootProcessId references the root attempt of the authorized tree.
export const RootProcessId = Schema.String.annotate({ identifier: "JobsIds.RootProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.RootProcessId"))
export type RootProcessId = typeof RootProcessId.Type

// SessionId identifies the occurrence Session; parity with lifecycle.shared.
export const SessionId = Schema.String.annotate({ identifier: "JobsIds.SessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.SessionId"))
export type SessionId = typeof SessionId.Type

// ParentSessionId references the direct parent Session.
export const ParentSessionId = Schema.String.annotate({ identifier: "JobsIds.ParentSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.ParentSessionId"))
export type ParentSessionId = typeof ParentSessionId.Type

// RootSessionId references the authorized root-session tree (FR1, FR21).
export const RootSessionId = Schema.String.annotate({ identifier: "JobsIds.RootSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.RootSessionId"))
export type RootSessionId = typeof RootSessionId.Type

// NotificationId identifies one notification envelope (FR22).
export const NotificationId = Schema.String.annotate({ identifier: "JobsIds.NotificationId" })
  .check(Schema.isPattern(notificationIdPattern))
  .pipe(Schema.brand("Jobs.NotificationId"))
export type NotificationId = typeof NotificationId.Type

// EventId is the EventV2 evt_ id assigned per published job.* event (C8).
export const EventId = Schema.String.annotate({ identifier: "JobsIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("Jobs.EventId"))
export type EventId = typeof EventId.Type
