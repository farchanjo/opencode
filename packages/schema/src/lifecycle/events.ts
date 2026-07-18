export * as Events from "./events"

import { Schema } from "effect"
import { Enums } from "./enums"
import { EnumsObservation } from "./enums-observation"
import { Envelope } from "./envelope"
import { Ids } from "./ids"
import { Usage } from "./usage"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/events.cue, events-durable.cue,
// events-durable-terminal.cue, events-live.cue and events-live-control.cue
// (package lifecycle.events) one-to-one — the closed 26-member LifecycleEvent
// tagged union plus the cohesive detail sub-objects distinct members carry
// (FR20, FR21). extend, promote, steer and handoff stay distinct semantic
// events and are never collapsed into a generic status update (FR21).
//
// AUTHORITATIVE MODULE: every detail sub-object, all 26 member Structs, and the
// LifecycleEvent union are defined here. events-durable.ts and events-live.ts
// re-export the durable/live member subsets (with grouping arrays for the bus
// layer, T014). Defining members in the split files while the union stays here
// would force an ESM circular initialization — the union needs the members and
// the members need these details — so the details and members share this one
// module and the split files are cycle-free re-export views.
//
// Mirroring Feature 001, each member is registered as its own EventV2.define
// Definition on the EventV2Bridge (dataFields(Member.fields)); no raw tagged
// union is wired to the bus (C2). Durable members carry the EventV2
// durable {version, aggregate: "root_process_id"} annotation; live members omit
// it (C4).

// --- events.cue: detail sub-objects ---

// AdmissionDetail carries the admission scope, decision and fanout (C11).
export const AdmissionDetail = Schema.Struct({
  scope: EnumsObservation.AdmissionScope,
  decision: EnumsObservation.AdmissionDecision,
  fanout: Schema.Struct({ requested: Values.FanoutCount, granted: Values.FanoutCount }),
}).annotate({ identifier: "LifecycleEvent.AdmissionDetail" })
export type AdmissionDetail = Schema.Schema.Type<typeof AdmissionDetail>

// HandoffEndpoint locates one side of a handoff by session and process.
export const HandoffEndpoint = Schema.Struct({
  session_id: Ids.SessionId,
  process_id: Ids.ProcessId,
}).annotate({ identifier: "LifecycleEvent.HandoffEndpoint" })
export type HandoffEndpoint = Schema.Schema.Type<typeof HandoffEndpoint>

// HandoffDetail carries source, target, reason and generation (C16, FR22).
export const HandoffDetail = Schema.Struct({
  source: HandoffEndpoint,
  target: HandoffEndpoint,
  reason: Values.Reason,
  generation: Values.Generation,
}).annotate({ identifier: "LifecycleEvent.HandoffDetail" })
export type HandoffDetail = Schema.Schema.Type<typeof HandoffDetail>

// TerminalDetail carries terminal reason, settlement sub-state and final usage
// (FR23, C20).
export const TerminalDetail = Schema.Struct({
  reason: Enums.TerminalReason,
  settlement: Enums.SettlementState,
  final_usage: Usage.LiveUsage,
}).annotate({ identifier: "LifecycleEvent.TerminalDetail" })
export type TerminalDetail = Schema.Schema.Type<typeof TerminalDetail>

// WatchdogDetail carries owner-loss/zombie outcome without claiming a provider
// stopped (C12).
export const WatchdogDetail = Schema.Struct({
  outcome: EnumsObservation.WatchdogOutcome,
  lease_id: Schema.NullOr(Ids.LeaseId),
  reason: Values.Reason,
}).annotate({ identifier: "LifecycleEvent.WatchdogDetail" })
export type WatchdogDetail = Schema.Schema.Type<typeof WatchdogDetail>

// ToolActivityDetail carries an allowlisted activity and its rendered label
// (FR56).
export const ToolActivityDetail = Schema.Struct({
  activity: EnumsObservation.ActivityKind,
  label: Values.ActivityLabel,
}).annotate({ identifier: "LifecycleEvent.ToolActivityDetail" })
export type ToolActivityDetail = Schema.Schema.Type<typeof ToolActivityDetail>

// SteerDetail carries a control outcome and reason for steer/cancel-intent
// events (FR21).
export const SteerDetail = Schema.Struct({
  outcome: EnumsObservation.CancelOutcome,
  reason: Values.Reason,
}).annotate({ identifier: "LifecycleEvent.SteerDetail" })
export type SteerDetail = Schema.Schema.Type<typeof SteerDetail>

// ReconcileDetail carries the reconciliation outcome and prior schema version
// (C13).
export const ReconcileDetail = Schema.Struct({
  outcome: EnumsObservation.WatchdogOutcome,
  from_version: Values.SchemaVersion,
}).annotate({ identifier: "LifecycleEvent.ReconcileDetail" })
export type ReconcileDetail = Schema.Schema.Type<typeof ReconcileDetail>

// --- events-durable.cue: durable semantic-checkpoint members (C4) ---

// admitted — capacity granted/partial/queued/rejected under a scope (C11).
export const AdmittedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.admitted"),
  envelope: Envelope.LifecycleEnvelope,
  detail: AdmissionDetail,
}).annotate({ identifier: "LifecycleEvent.AdmittedEvent" })
export type AdmittedEvent = Schema.Schema.Type<typeof AdmittedEvent>

// parent_attached — the process was linked into its parent tree.
export const ParentAttachedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.parent_attached"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.ParentAttachedEvent" })
export type ParentAttachedEvent = Schema.Schema.Type<typeof ParentAttachedEvent>

// process_created — a new attempt/execution identity was created.
export const ProcessCreatedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.process_created"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.ProcessCreatedEvent" })
export type ProcessCreatedEvent = Schema.Schema.Type<typeof ProcessCreatedEvent>

// started — execution began for the process.
export const StartedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.started"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.StartedEvent" })
export type StartedEvent = Schema.Schema.Type<typeof StartedEvent>

// handoff — single durable ownership transfer projectable to both sessions (C16).
export const HandoffEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.handoff"),
  envelope: Envelope.LifecycleEnvelope,
  detail: HandoffDetail,
}).annotate({ identifier: "LifecycleEvent.HandoffEvent" })
export type HandoffEvent = Schema.Schema.Type<typeof HandoffEvent>

// reconciled — versioned reconciliation with durable Sessions; no auto-retry (C13).
export const ReconciledEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.reconciled"),
  envelope: Envelope.LifecycleEnvelope,
  detail: ReconcileDetail,
}).annotate({ identifier: "LifecycleEvent.ReconciledEvent" })
export type ReconciledEvent = Schema.Schema.Type<typeof ReconciledEvent>

// --- events-durable-terminal.cue: terminal and owner-loss members (C4, C5) ---

// completed — the process finished; settlement may still be pending (C20).
export const CompletedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.completed"),
  envelope: Envelope.LifecycleEnvelope,
  detail: TerminalDetail,
}).annotate({ identifier: "LifecycleEvent.CompletedEvent" })
export type CompletedEvent = Schema.Schema.Type<typeof CompletedEvent>

// failed — the process terminated with an error.
export const FailedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.failed"),
  envelope: Envelope.LifecycleEnvelope,
  detail: TerminalDetail,
}).annotate({ identifier: "LifecycleEvent.FailedEvent" })
export type FailedEvent = Schema.Schema.Type<typeof FailedEvent>

// cancelled — the process terminated via a cancel request.
export const CancelledEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.cancelled"),
  envelope: Envelope.LifecycleEnvelope,
  detail: TerminalDetail,
}).annotate({ identifier: "LifecycleEvent.CancelledEvent" })
export type CancelledEvent = Schema.Schema.Type<typeof CancelledEvent>

// zombie_detected — lease expiry with absent owner heartbeat (C12, AC11).
export const ZombieDetectedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.zombie_detected"),
  envelope: Envelope.LifecycleEnvelope,
  detail: WatchdogDetail,
}).annotate({ identifier: "LifecycleEvent.ZombieDetectedEvent" })
export type ZombieDetectedEvent = Schema.Schema.Type<typeof ZombieDetectedEvent>

// owner_lost — the owning runtime was lost; no provider-stop is claimed (C12).
export const OwnerLostEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.owner_lost"),
  envelope: Envelope.LifecycleEnvelope,
  detail: WatchdogDetail,
}).annotate({ identifier: "LifecycleEvent.OwnerLostEvent" })
export type OwnerLostEvent = Schema.Schema.Type<typeof OwnerLostEvent>

// --- events-live.cue: envelope-only live members (C4) ---

// queued — admitted work is waiting for a run slot.
export const QueuedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.queued"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.QueuedEvent" })
export type QueuedEvent = Schema.Schema.Type<typeof QueuedEvent>

// waiting — the process is blocked on input or a dependency.
export const WaitingEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.waiting"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.WaitingEvent" })
export type WaitingEvent = Schema.Schema.Type<typeof WaitingEvent>

// promoted — priority/fairness promotion; distinct from a status update (FR21).
export const PromotedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.promoted"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.PromotedEvent" })
export type PromotedEvent = Schema.Schema.Type<typeof PromotedEvent>

// extended — budget/turn extension; distinct from a status update (FR21).
export const ExtendedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.extended"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.ExtendedEvent" })
export type ExtendedEvent = Schema.Schema.Type<typeof ExtendedEvent>

// turn_started — a model/agent turn began.
export const TurnStartedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.turn_started"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.TurnStartedEvent" })
export type TurnStartedEvent = Schema.Schema.Type<typeof TurnStartedEvent>

// turn_ended — a model/agent turn completed.
export const TurnEndedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.turn_ended"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.TurnEndedEvent" })
export type TurnEndedEvent = Schema.Schema.Type<typeof TurnEndedEvent>

// turn_failed — a model/agent turn failed without terminating the process.
export const TurnFailedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.turn_failed"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.TurnFailedEvent" })
export type TurnFailedEvent = Schema.Schema.Type<typeof TurnFailedEvent>

// unknown — an observed but unclassified transition; never invents terminal
// state (C9).
export const UnknownEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.unknown"),
  envelope: Envelope.LifecycleEnvelope,
}).annotate({ identifier: "LifecycleEvent.UnknownEvent" })
export type UnknownEvent = Schema.Schema.Type<typeof UnknownEvent>

// --- events-live-control.cue: steer, cancel-intent and tool-boundary members ---

// steer_requested — a steer was requested through a native control API (FR16).
export const SteerRequestedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.steer_requested"),
  envelope: Envelope.LifecycleEnvelope,
  detail: SteerDetail,
}).annotate({ identifier: "LifecycleEvent.SteerRequestedEvent" })
export type SteerRequestedEvent = Schema.Schema.Type<typeof SteerRequestedEvent>

// steer_accepted — the steer request was accepted.
export const SteerAcceptedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.steer_accepted"),
  envelope: Envelope.LifecycleEnvelope,
  detail: SteerDetail,
}).annotate({ identifier: "LifecycleEvent.SteerAcceptedEvent" })
export type SteerAcceptedEvent = Schema.Schema.Type<typeof SteerAcceptedEvent>

// steer_rejected — the steer request was rejected.
export const SteerRejectedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.steer_rejected"),
  envelope: Envelope.LifecycleEnvelope,
  detail: SteerDetail,
}).annotate({ identifier: "LifecycleEvent.SteerRejectedEvent" })
export type SteerRejectedEvent = Schema.Schema.Type<typeof SteerRejectedEvent>

// cancel_requested — a cancel was requested; no remote kill is promised (C17).
export const CancelRequestedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.cancel_requested"),
  envelope: Envelope.LifecycleEnvelope,
  detail: SteerDetail,
}).annotate({ identifier: "LifecycleEvent.CancelRequestedEvent" })
export type CancelRequestedEvent = Schema.Schema.Type<typeof CancelRequestedEvent>

// cancelling — the process is transitioning toward a terminal cancel outcome.
export const CancellingEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.cancelling"),
  envelope: Envelope.LifecycleEnvelope,
  detail: SteerDetail,
}).annotate({ identifier: "LifecycleEvent.CancellingEvent" })
export type CancellingEvent = Schema.Schema.Type<typeof CancellingEvent>

// tool_called — a tool boundary opened; activity is allowlisted and redacted (FR56).
export const ToolCalledEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.tool_called"),
  envelope: Envelope.LifecycleEnvelope,
  detail: ToolActivityDetail,
}).annotate({ identifier: "LifecycleEvent.ToolCalledEvent" })
export type ToolCalledEvent = Schema.Schema.Type<typeof ToolCalledEvent>

// tool_settled — a tool boundary settled.
export const ToolSettledEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.tool_settled"),
  envelope: Envelope.LifecycleEnvelope,
  detail: ToolActivityDetail,
}).annotate({ identifier: "LifecycleEvent.ToolSettledEvent" })
export type ToolSettledEvent = Schema.Schema.Type<typeof ToolSettledEvent>

// --- events.cue: the closed tagged union of every FR20 vocabulary member ---

// LifecycleEvent is the closed 26-member tagged union discriminated on `type`.
export const LifecycleEvent = Schema.Union([
  AdmittedEvent,
  ParentAttachedEvent,
  ProcessCreatedEvent,
  StartedEvent,
  HandoffEvent,
  ReconciledEvent,
  CompletedEvent,
  FailedEvent,
  CancelledEvent,
  ZombieDetectedEvent,
  OwnerLostEvent,
  QueuedEvent,
  WaitingEvent,
  PromotedEvent,
  ExtendedEvent,
  TurnStartedEvent,
  TurnEndedEvent,
  TurnFailedEvent,
  UnknownEvent,
  SteerRequestedEvent,
  SteerAcceptedEvent,
  SteerRejectedEvent,
  CancelRequestedEvent,
  CancellingEvent,
  ToolCalledEvent,
  ToolSettledEvent,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "LifecycleEvent.LifecycleEvent" })
export type LifecycleEvent = Schema.Schema.Type<typeof LifecycleEvent>
