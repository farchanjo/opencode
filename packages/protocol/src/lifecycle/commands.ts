/**
 * Feature 002 — Lifecycle protocol payloads (T013).
 *
 * Mirrors the `process.*`/`task.*` command and query request/response
 * payloads plus the `LifecyclePort`/`ProcessPort`/`ObservationPort` typed
 * error unions from
 * doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/contracts/ports.ts
 * (FR14, C19). One request/response pair per operation, composed from the
 * domain schemas under @opencode-ai/schema/lifecycle/* wherever the port
 * contract reuses a domain shape (ProcessRow, LifecycleEnvelope reused
 * verbatim, including their own nested field casing — see process-row.ts,
 * envelope.ts), plus locally-scoped protocol-only wrapper fields (limits,
 * cursors, filters, principals) built from the same domain leaf value
 * objects (Ids, Enums, Values) where the port contract's flat/camelCase
 * shape diverges from the persisted domain record.
 *
 * Wire-shape source of truth for the reused domain shapes remains
 * doc/arch/schemas/lifecycle/*.cue; this file never redefines event payload
 * schemas owned by packages/schema/src/lifecycle/* (C2, C3).
 */

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "@opencode-ai/schema/schema"
import { CorrelationIds } from "@opencode-ai/schema/lifecycle/correlation-ids"
import { Enums } from "@opencode-ai/schema/lifecycle/enums"
import { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import { Envelope } from "@opencode-ai/schema/lifecycle/envelope"
import { Ids } from "@opencode-ai/schema/lifecycle/ids"
import { Row } from "@opencode-ai/schema/lifecycle/process-row"
import { UsageValues } from "@opencode-ai/schema/lifecycle/usage-values"
import { Values } from "@opencode-ai/schema/lifecycle/values"

// =============================================================================
// Bounded output reference (Feature 005 owns the content-plane contract)
// =============================================================================

export interface BoundedOutputRef extends Schema.Schema.Type<typeof BoundedOutputRef> {}
export const BoundedOutputRef = Schema.Struct({
  ref: UsageValues.OutputRef,
  cursor: Schema.NullOr(UsageValues.Cursor),
}).annotate({ identifier: "LifecycleProtocol.BoundedOutputRef" })

// =============================================================================
// Principals
// =============================================================================

export interface OperatorPrincipal extends Schema.Schema.Type<typeof OperatorPrincipal> {}
export const OperatorPrincipal = Schema.Struct({
  kind: Schema.Literals(["operator", "manager-view"]),
  id: Schema.String,
}).annotate({ identifier: "LifecycleProtocol.OperatorPrincipal" })

export const ObserverPrincipal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("main-context"), rootSessionId: Ids.RootSessionId }),
  Schema.Struct({ kind: Schema.Literal("agent"), sessionId: Ids.SessionId }),
  Schema.Struct({ kind: Schema.Literal("subagent"), sessionId: Ids.SessionId }),
  OperatorPrincipal,
]).annotate({ identifier: "LifecycleProtocol.ObserverPrincipal" })
export type ObserverPrincipal = typeof ObserverPrincipal.Type

// =============================================================================
// Observation payload (wire shape: doc/arch/schemas/lifecycle/observation.cue)
// =============================================================================

// ObservationScope selects the authorized observation surface; reuses the
// domain ObservationKind literal set verbatim (session/process/tree/global).
export const ObservationScope = EnumsObservation.ObservationKind.annotate({
  identifier: "LifecycleProtocol.ObservationScope",
})
export type ObservationScope = typeof ObservationScope.Type

// A projection anomaly surfaced without inventing lifecycle state (FR29, C9).
export const ProjectionAnomaly = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("duplicate"), eventId: Ids.EventId }),
  Schema.Struct({
    kind: Schema.Literal("out_of_order"),
    aggregateID: Schema.String,
    expectedSeq: Values.Sequence,
    actualSeq: Values.Sequence,
  }),
  Schema.Struct({ kind: Schema.Literal("unknown_process"), processId: Ids.ProcessId }),
  Schema.Struct({ kind: Schema.Literal("unreconciled"), processId: Ids.ProcessId }),
]).annotate({ identifier: "LifecycleProtocol.ProjectionAnomaly" })
export type ProjectionAnomaly = typeof ProjectionAnomaly.Type

// One delivered lifecycle observation (FR14). Redacted before delivery
// (FR13, FR28). envelope reuses the domain LifecycleEnvelope verbatim.
export interface LifecycleObservation extends Schema.Schema.Type<typeof LifecycleObservation> {}
export const LifecycleObservation = Schema.Struct({
  envelope: Envelope.LifecycleEnvelope,
  data: Schema.Record(Schema.String, Schema.Unknown),
  anomaly: Schema.NullOr(ProjectionAnomaly),
}).annotate({ identifier: "LifecycleProtocol.LifecycleObservation" })

// =============================================================================
// LifecyclePort — emit / project / replay
// =============================================================================

// EmitOrdering is LifecycleEnvelope.Ordering with `sequence` omitted; EventV2
// assigns the sequence on publish (C8).
const EmitOrdering = Schema.Struct({
  correlation_id: CorrelationIds.CorrelationId,
  causation_id: Schema.NullOr(CorrelationIds.CausationId),
  attempt: Values.Attempt,
  generation: Values.Generation,
}).annotate({ identifier: "LifecycleProtocol.EmitOrdering" })

// EmitDelivery is LifecycleEnvelope.Delivery with `timestamp` omitted; EventV2
// assigns the timestamp on publish.
const EmitDelivery = Schema.Struct({
  visibility: Enums.Visibility,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "LifecycleProtocol.EmitDelivery" })

// EmitEnvelope is LifecycleEnvelope with `event_id`, `ordering.sequence` and
// `delivery.timestamp` omitted — the caller-supplied portion of an envelope
// before EventV2 assigns the rest (mirrors contracts' `LifecycleEmitInput.envelope:
// Omit<LifecycleEnvelope, "eventId" | "timestamp" | "sequence">`).
export interface EmitEnvelope extends Schema.Schema.Type<typeof EmitEnvelope> {}
export const EmitEnvelope = Schema.Struct({
  kind: Envelope.EventKind,
  tree: Envelope.TreeIdentity,
  process: Envelope.ProcessIdentity,
  ordering: EmitOrdering,
  delivery: EmitDelivery,
  hierarchy: Schema.NullOr(Envelope.HierarchyContext),
}).annotate({ identifier: "LifecycleProtocol.EmitEnvelope" })

export interface LifecycleEmitInput extends Schema.Schema.Type<typeof LifecycleEmitInput> {}
export const LifecycleEmitInput = Schema.Struct({
  envelope: EmitEnvelope,
  eventType: Enums.LifecycleEventType,
  data: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "LifecycleProtocol.LifecycleEmitInput" })

export interface LifecycleEmitOutput extends Schema.Schema.Type<typeof LifecycleEmitOutput> {}
export const LifecycleEmitOutput = Schema.Struct({
  eventId: Ids.EventId,
  durable: Schema.NullOr(
    Schema.Struct({
      aggregateID: Schema.String,
      seq: Values.Sequence,
      version: Values.SchemaVersion,
    }),
  ),
}).annotate({ identifier: "LifecycleProtocol.LifecycleEmitOutput" })

export interface LifecycleProjectInput extends Schema.Schema.Type<typeof LifecycleProjectInput> {}
export const LifecycleProjectInput = Schema.Struct({
  eventId: Ids.EventId,
  eventType: Enums.LifecycleEventType,
  envelope: Envelope.LifecycleEnvelope,
  data: Schema.Record(Schema.String, Schema.Unknown),
  durable: Schema.NullOr(Schema.Struct({ aggregateID: Schema.String, seq: Values.Sequence })),
}).annotate({ identifier: "LifecycleProtocol.LifecycleProjectInput" })

export interface LifecycleProjectOutput extends Schema.Schema.Type<typeof LifecycleProjectOutput> {}
export const LifecycleProjectOutput = Schema.Struct({
  applied: Schema.Boolean,
  anomaly: Schema.NullOr(ProjectionAnomaly),
  row: Schema.NullOr(Row.ProcessRow),
}).annotate({ identifier: "LifecycleProtocol.LifecycleProjectOutput" })

export interface LifecycleReplayInput extends Schema.Schema.Type<typeof LifecycleReplayInput> {}
export const LifecycleReplayInput = Schema.Struct({
  scope: Schema.Literals(["root", "session"]),
  scopeId: Schema.String,
  after: Schema.optional(NonNegativeInt),
  limit: PositiveInt,
}).annotate({ identifier: "LifecycleProtocol.LifecycleReplayInput" })

export interface LifecycleReplayOutput extends Schema.Schema.Type<typeof LifecycleReplayOutput> {}
export const LifecycleReplayOutput = Schema.Struct({
  rows: Schema.Array(Row.ProcessRow),
  hasMore: Schema.Boolean,
  cursor: Schema.NullOr(NonNegativeInt),
  reconciledCount: NonNegativeInt,
  unreconciledCount: NonNegativeInt,
}).annotate({ identifier: "LifecycleProtocol.LifecycleReplayOutput" })

export const LifecycleError = Schema.Union([
  Schema.Struct({ type: Schema.Literal("unknown_event_type"), eventType: Schema.String }),
  Schema.Struct({ type: Schema.Literal("validation_failed"), fields: Schema.Record(Schema.String, Schema.String) }),
  Schema.Struct({ type: Schema.Literal("second_authority_rejected"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("not_implemented") }),
]).annotate({ identifier: "LifecycleProtocol.LifecycleError" })
export type LifecycleError = typeof LifecycleError.Type

// =============================================================================
// ProcessPort — list / show / tree / observe / cancel / reconcile
// =============================================================================

export interface ProcessListInput extends Schema.Schema.Type<typeof ProcessListInput> {}
export const ProcessListInput = Schema.Struct({
  scope: ObservationScope,
  scopeId: Schema.String,
  states: Schema.optional(Schema.Array(Enums.ProcessState)),
  limit: PositiveInt,
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "LifecycleProtocol.ProcessListInput" })

export interface ProcessListOutput extends Schema.Schema.Type<typeof ProcessListOutput> {}
export const ProcessListOutput = Schema.Struct({
  rows: Schema.Array(Row.ProcessRow),
  cursor: Schema.NullOr(Schema.String),
}).annotate({ identifier: "LifecycleProtocol.ProcessListOutput" })

export interface ProcessShowInput extends Schema.Schema.Type<typeof ProcessShowInput> {}
export const ProcessShowInput = Schema.Struct({
  processId: Ids.ProcessId,
}).annotate({ identifier: "LifecycleProtocol.ProcessShowInput" })

export interface ProcessShowOutput extends Schema.Schema.Type<typeof ProcessShowOutput> {}
export const ProcessShowOutput = Schema.Struct({
  row: Row.ProcessRow,
}).annotate({ identifier: "LifecycleProtocol.ProcessShowOutput" })

export interface ProcessTreeInput extends Schema.Schema.Type<typeof ProcessTreeInput> {}
export const ProcessTreeInput = Schema.Struct({
  rootProcessId: Ids.RootProcessId,
  sessionId: Schema.optional(Ids.SessionId),
}).annotate({ identifier: "LifecycleProtocol.ProcessTreeInput" })

export interface ProcessTreeNode extends Schema.Schema.Type<typeof ProcessTreeNode> {}
export const ProcessTreeNode = Schema.Struct({
  row: Row.ProcessRow,
  childProcessIds: Schema.Array(Ids.ProcessId),
}).annotate({ identifier: "LifecycleProtocol.ProcessTreeNode" })

export interface ProcessTreeOutput extends Schema.Schema.Type<typeof ProcessTreeOutput> {}
export const ProcessTreeOutput = Schema.Struct({
  nodes: Schema.Array(ProcessTreeNode),
}).annotate({ identifier: "LifecycleProtocol.ProcessTreeOutput" })

export interface ProcessObserveInput extends Schema.Schema.Type<typeof ProcessObserveInput> {}
export const ProcessObserveInput = Schema.Struct({
  processId: Ids.ProcessId,
  principal: ObserverPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ProcessObserveInput" })

export interface ProcessCancelInput extends Schema.Schema.Type<typeof ProcessCancelInput> {}
export const ProcessCancelInput = Schema.Struct({
  processId: Ids.ProcessId,
  reason: Schema.NullOr(Values.Reason),
  principal: OperatorPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ProcessCancelInput" })

export interface ProcessCancelOutput extends Schema.Schema.Type<typeof ProcessCancelOutput> {}
export const ProcessCancelOutput = Schema.Struct({
  outcome: EnumsObservation.CancelOutcome,
  auditId: Schema.String,
}).annotate({ identifier: "LifecycleProtocol.ProcessCancelOutput" })

export interface ProcessReconcileInput extends Schema.Schema.Type<typeof ProcessReconcileInput> {}
export const ProcessReconcileInput = Schema.Struct({
  scope: Schema.Literals(["root", "session"]),
  scopeId: Schema.String,
  principal: OperatorPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ProcessReconcileInput" })

export interface ProcessReconcileOutput extends Schema.Schema.Type<typeof ProcessReconcileOutput> {}
export const ProcessReconcileOutput = Schema.Struct({
  reconciledCount: NonNegativeInt,
  unreconciledCount: NonNegativeInt,
}).annotate({ identifier: "LifecycleProtocol.ProcessReconcileOutput" })

export const ProcessError = Schema.Union([
  Schema.Struct({ type: Schema.Literal("not_found"), processId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unauthorized"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("cancel_rejected"), processId: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("invalid_argument"), field: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("not_implemented") }),
]).annotate({ identifier: "LifecycleProtocol.ProcessError" })
export type ProcessError = typeof ProcessError.Type

// =============================================================================
// ObservationPort — observeSession / observeProcess / observeTree / observeGlobal (C14)
// =============================================================================

export interface ObserveSessionInput extends Schema.Schema.Type<typeof ObserveSessionInput> {}
export const ObserveSessionInput = Schema.Struct({
  sessionId: Ids.SessionId,
  principal: ObserverPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ObserveSessionInput" })

export interface ObserveProcessInput extends Schema.Schema.Type<typeof ObserveProcessInput> {}
export const ObserveProcessInput = Schema.Struct({
  processId: Ids.ProcessId,
  principal: ObserverPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ObserveProcessInput" })

export interface ObserveTreeInput extends Schema.Schema.Type<typeof ObserveTreeInput> {}
export const ObserveTreeInput = Schema.Struct({
  rootSessionId: Ids.RootSessionId,
  principal: ObserverPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ObserveTreeInput" })

export interface GlobalObservationFilter extends Schema.Schema.Type<typeof GlobalObservationFilter> {}
export const GlobalObservationFilter = Schema.Struct({
  states: Schema.optional(Schema.Array(Enums.ProcessState)),
  hierarchyRoles: Schema.optional(Schema.Array(EnumsObservation.HierarchyRole)),
  agentKinds: Schema.optional(Schema.Array(Enums.AgentKind)),
  limit: PositiveInt,
}).annotate({ identifier: "LifecycleProtocol.GlobalObservationFilter" })

export interface ObserveGlobalInput extends Schema.Schema.Type<typeof ObserveGlobalInput> {}
export const ObserveGlobalInput = Schema.Struct({
  filter: GlobalObservationFilter,
  principal: OperatorPrincipal,
}).annotate({ identifier: "LifecycleProtocol.ObserveGlobalInput" })

export const ObservationError = Schema.Union([
  Schema.Struct({ type: Schema.Literal("unauthorized"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sibling_leak_rejected"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("invalid_filter"), field: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("not_implemented") }),
]).annotate({ identifier: "LifecycleProtocol.ObservationError" })
export type ObservationError = typeof ObservationError.Type
