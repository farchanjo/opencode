export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/ids.cue (package outputspool.shared)
// one-to-one for the Feature 005 OutputSpool content plane (FR11, FR12, FR14,
// FR15, FR17, FR48, C1, C18, C21).
//
// Name parity with lifecycle.shared / jobs.shared / langlock.shared is
// intentional — this feature does not cross-import those modules, so the
// identifier concepts are re-declared locally (C1, C18, C21).
//
// ANNOTATION ORDER: every exported schema is annotated with its root identifier
// BEFORE any `.check(...)` is applied, and branded only after the check.
// Annotating an already-checked schema drops the root identifier from
// `.ast.annotations` in favor of annotating the last check instead, so
// base-then-check-then-brand is load-bearing for contract hygiene (see
// test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// GroupId identifies one OutputGroup aggregate — one generation subtree (FR14, C1, C18).
export const GroupId = Schema.String.annotate({ identifier: "OutputSpoolIds.GroupId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.GroupId"))
export type GroupId = typeof GroupId.Type

// OutputRef is a bounded opaque channel/artifact handle — never a path, never a saved
// permission resource (FR12, FR17, FR48, C18).
export const OutputRef = Schema.String.annotate({ identifier: "OutputSpoolIds.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.OutputRef"))
export type OutputRef = typeof OutputRef.Type

// ChannelId identifies one typed channel within a group (FR15).
export const ChannelId = Schema.String.annotate({ identifier: "OutputSpoolIds.ChannelId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.ChannelId"))
export type ChannelId = typeof ChannelId.Type

// ProcessId references the Feature 002 Task Process that owns the group — never an OS PID (FR14, C21).
export const ProcessId = Schema.String.annotate({ identifier: "OutputSpoolIds.ProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.ProcessId"))
export type ProcessId = typeof ProcessId.Type

// RootSessionId references the authorized root-session tree the group is keyed under (FR11, C1).
export const RootSessionId = Schema.String.annotate({ identifier: "OutputSpoolIds.RootSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.RootSessionId"))
export type RootSessionId = typeof RootSessionId.Type

// SessionId identifies the producing Session; parity with lifecycle.shared.SessionId (C1).
export const SessionId = Schema.String.annotate({ identifier: "OutputSpoolIds.SessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.SessionId"))
export type SessionId = typeof SessionId.Type

// ProjectId references the project scope the spool tree is keyed under (FR11, C1).
export const ProjectId = Schema.String.annotate({ identifier: "OutputSpoolIds.ProjectId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.ProjectId"))
export type ProjectId = typeof ProjectId.Type

// EventId is the EventV2 evt_ id assigned per published output.* event (C20).
export const EventId = Schema.String.annotate({ identifier: "OutputSpoolIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("OutputSpool.EventId"))
export type EventId = typeof EventId.Type

// LeaseId identifies one retention lease held against a group (FR28, C5).
export const LeaseId = Schema.String.annotate({ identifier: "OutputSpoolIds.LeaseId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.LeaseId"))
export type LeaseId = typeof LeaseId.Type

// HolderRef is an opaque holder handle for a lease or reference edge (FR28, C5).
export const HolderRef = Schema.String.annotate({ identifier: "OutputSpoolIds.HolderRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.HolderRef"))
export type HolderRef = typeof HolderRef.Type
