export * as Row from "./process-row"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Enums } from "./enums"
import { EnumsObservation } from "./enums-observation"
import { Ids } from "./ids"
import { RowParts } from "./process-row-parts"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/process-row.cue and process-row-parts.cue —
// ProcessRow is the read-only aggregate root of the Process Table projection
// (FR26). It is rebuilt by replaying the durable aggregate (C6) and never
// executes, schedules, or authorizes work (FR4). id is process_id: never an OS
// PID and never implying kill semantics (FR7, C8). Prompts, results, tool
// payloads, paths and secrets stay outside the row by default (FR28). Cohesive
// lineage/profile/accounting sub-objects live in ./process-row-parts.

// RowIdentity carries the logical Task, attempt, generation and current lease.
export const RowIdentity = Schema.Struct({
  task_id: Ids.TaskId,
  attempt: Values.Attempt,
  generation: Values.Generation,
  lease_id: Schema.NullOr(Ids.LeaseId),
}).annotate({ identifier: "LifecycleRow.RowIdentity" })
export type RowIdentity = Schema.Schema.Type<typeof RowIdentity>

// RowStatus carries the current state, terminal reason, settlement and timestamps.
// settlement stays terminal-not-settled until Feature 005 reports it (C20).
export const RowStatus = Schema.Struct({
  state: Enums.ProcessState,
  reason: Schema.NullOr(Enums.TerminalReason),
  settlement: Schema.NullOr(Enums.SettlementState),
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  terminal_at: Schema.NullOr(DateTimeUtcFromMillis),
}).annotate({ identifier: "LifecycleRow.RowStatus" })
export type RowStatus = Schema.Schema.Type<typeof RowStatus>

// RowHierarchy projects the hierarchy node without high-cardinality labels (C15).
export const RowHierarchy = Schema.Struct({
  role: EnumsObservation.HierarchyRole,
  delegation_depth: Values.DelegationDepth,
  route_path: Schema.Array(Ids.SessionId),
  fanout: Schema.Struct({ requested: Values.FanoutCount, granted: Values.FanoutCount }),
  validation_outcome: Schema.NullOr(EnumsObservation.ValidationOutcome),
}).annotate({ identifier: "LifecycleRow.RowHierarchy" })
export type RowHierarchy = Schema.Schema.Type<typeof RowHierarchy>

// ProcessRow is the aggregate root of the Process Table projection.
export const ProcessRow = Schema.Struct({
  id: Ids.ProcessId,
  identity: RowIdentity,
  lineage: RowParts.RowLineage,
  status: RowStatus,
  profile: RowParts.RowProfile,
  accounting: RowParts.RowAccounting,
  hierarchy: Schema.NullOr(RowHierarchy),
}).annotate({ identifier: "LifecycleRow.ProcessRow" })
export type ProcessRow = Schema.Schema.Type<typeof ProcessRow>
