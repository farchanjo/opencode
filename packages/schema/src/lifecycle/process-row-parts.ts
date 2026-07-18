export * as RowParts from "./process-row-parts"

import { Schema } from "effect"
import { CorrelationIds } from "./correlation-ids"
import { Enums } from "./enums"
import { EnumsObservation } from "./enums-observation"
import { Ids } from "./ids"
import { Usage } from "./usage"
import { UsageValues } from "./usage-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/process-row-lineage.cue and
// process-row-profile.cue — the cohesive sub-objects composed by the ProcessRow
// aggregate root (process-row.ts). Relations, ownership and the process graph
// carry bounded labels only; prompts, results, tool payloads, paths and secrets
// stay outside the row by default (FR28). High-cardinality identifiers live in
// traces/logs, never in a metric label (C18).

// --- process-row-lineage.cue ---

// RowRelations carries parent/root process and session relations.
export const RowRelations = Schema.Struct({
  parent_process_id: Schema.NullOr(Ids.ParentProcessId),
  root_process_id: Ids.RootProcessId,
  session_id: Ids.SessionId,
  parent_session_id: Schema.NullOr(Ids.ParentSessionId),
  root_session_id: Ids.RootSessionId,
}).annotate({ identifier: "LifecycleRow.RowRelations" })
export type RowRelations = Schema.Schema.Type<typeof RowRelations>

// RowOwnership carries the owning runtime, visibility scope and actor kind.
export const RowOwnership = Schema.Struct({
  runtime_instance_id: Ids.RuntimeInstanceId,
  scope: Enums.Visibility,
  actor_kind: Enums.ActorKind,
}).annotate({ identifier: "LifecycleRow.RowOwnership" })
export type RowOwnership = Schema.Schema.Type<typeof RowOwnership>

// RowGraph carries dependencies, children and pending inputs/steers as labels only.
export const RowGraph = Schema.Struct({
  dependencies: Schema.Array(Ids.ProcessId),
  children: Schema.Array(Ids.ProcessId),
  pending_inputs: Schema.Array(Values.Reason),
  pending_steers: Schema.Array(Values.Reason),
}).annotate({ identifier: "LifecycleRow.RowGraph" })
export type RowGraph = Schema.Schema.Type<typeof RowGraph>

// RowLineage composes relations, ownership and the process graph.
export const RowLineage = Schema.Struct({
  relations: RowRelations,
  ownership: RowOwnership,
  graph: RowGraph,
}).annotate({ identifier: "LifecycleRow.RowLineage" })
export type RowLineage = Schema.Schema.Type<typeof RowLineage>

// --- process-row-profile.cue ---

// RowClassification carries agent identity, task class, profile and effort.
// task_class/profile/effort mirror the Feature 001 vocabularies by value (C15).
export const RowClassification = Schema.Struct({
  agent_name: CorrelationIds.AgentName,
  agent_kind: Enums.AgentKind,
  task_class: Schema.String,
  profile: Schema.String,
  task_effort: Schema.String,
  reasoning_effort: Schema.String,
}).annotate({ identifier: "LifecycleRow.RowClassification" })
export type RowClassification = Schema.Schema.Type<typeof RowClassification>

// RowModel carries the provider, model and variant descriptors.
export const RowModel = Schema.Struct({
  provider: CorrelationIds.ProviderName,
  model: CorrelationIds.ModelId,
  variant: Schema.NullOr(CorrelationIds.VariantName),
}).annotate({ identifier: "LifecycleRow.RowModel" })
export type RowModel = Schema.Schema.Type<typeof RowModel>

// RowProfile composes agent/task classification and provider/model descriptors.
export const RowProfile = Schema.Struct({
  classification: RowClassification,
  model: RowModel,
}).annotate({ identifier: "LifecycleRow.RowProfile" })
export type RowProfile = Schema.Schema.Type<typeof RowProfile>

// RowUsage carries live usage plus TTFT/stream/total durations.
export const RowUsage = Schema.Struct({
  usage: Usage.LiveUsage,
  ttft_ms: Schema.NullOr(UsageValues.DurationMs),
  stream_ms: Schema.NullOr(UsageValues.DurationMs),
  total_ms: Schema.NullOr(UsageValues.DurationMs),
}).annotate({ identifier: "LifecycleRow.RowUsage" })
export type RowUsage = Schema.Schema.Type<typeof RowUsage>

// RowOutcome carries cancellation, exit and error reasons.
export const RowOutcome = Schema.Struct({
  cancel_outcome: Schema.NullOr(EnumsObservation.CancelOutcome),
  exit_reason: Schema.NullOr(Values.Reason),
  error_reason: Schema.NullOr(Values.Reason),
}).annotate({ identifier: "LifecycleRow.RowOutcome" })
export type RowOutcome = Schema.Schema.Type<typeof RowOutcome>

// RowTelemetry carries trace/span ids and a bounded output reference (C18, C20).
export const RowTelemetry = Schema.Struct({
  trace_id: Schema.NullOr(UsageValues.TraceId),
  span_id: Schema.NullOr(UsageValues.SpanId),
  output_ref: Schema.NullOr(UsageValues.OutputRef),
}).annotate({ identifier: "LifecycleRow.RowTelemetry" })
export type RowTelemetry = Schema.Schema.Type<typeof RowTelemetry>

// RowAccounting composes live usage, terminal outcome and trace correlation.
export const RowAccounting = Schema.Struct({
  usage: RowUsage,
  outcome: RowOutcome,
  telemetry: RowTelemetry,
}).annotate({ identifier: "LifecycleRow.RowAccounting" })
export type RowAccounting = Schema.Schema.Type<typeof RowAccounting>
