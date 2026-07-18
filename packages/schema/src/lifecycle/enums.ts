export * as Enums from "./enums"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/lifecycle/enums.cue (package lifecycle.enums) for
// the core Process Table and event-vocabulary closed enums (FR20, FR25, C4,
// C7, C20). CancelOutcome and AnomalyKind — also declared in enums.cue — are
// owned by ./enums-observation.ts instead, per the task split.

// ProcessState is the closed set of ten Process Table states (C7, FR25).
// handoff is an event, never a state.
export const ProcessState = Schema.Literals([
  "created",
  "queued",
  "waiting",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "zombie",
  "unknown",
]).annotate({ identifier: "LifecycleEnums.ProcessState" })
export type ProcessState = typeof ProcessState.Type

// LifecycleEventType is the closed 26-member event vocabulary (FR20),
// prefixed lifecycle.* on the bus. extend, promote, steer and handoff are
// kept as distinct members.
export const LifecycleEventType = Schema.Literals([
  "lifecycle.admitted",
  "lifecycle.parent_attached",
  "lifecycle.process_created",
  "lifecycle.queued",
  "lifecycle.waiting",
  "lifecycle.started",
  "lifecycle.promoted",
  "lifecycle.extended",
  "lifecycle.handoff",
  "lifecycle.steer_requested",
  "lifecycle.steer_accepted",
  "lifecycle.steer_rejected",
  "lifecycle.turn_started",
  "lifecycle.turn_ended",
  "lifecycle.turn_failed",
  "lifecycle.tool_called",
  "lifecycle.tool_settled",
  "lifecycle.cancel_requested",
  "lifecycle.cancelling",
  "lifecycle.completed",
  "lifecycle.failed",
  "lifecycle.cancelled",
  "lifecycle.owner_lost",
  "lifecycle.zombie_detected",
  "lifecycle.reconciled",
  "lifecycle.unknown",
]).annotate({ identifier: "LifecycleEnums.LifecycleEventType" })
export type LifecycleEventType = typeof LifecycleEventType.Type

// EventClass separates durable (replayable) from live (no sequence) events (C4).
export const EventClass = Schema.Literals(["durable", "live"]).annotate({
  identifier: "LifecycleEnums.EventClass",
})
export type EventClass = typeof EventClass.Type

// TerminalReason is recorded on terminal events and rows (FR23, FR27).
export const TerminalReason = Schema.Literals([
  "completed_ok",
  "error",
  "cancelled_by_operator",
  "cancelled_by_root",
  "zombie",
  "owner_lost",
  "reconciled_unknown",
]).annotate({ identifier: "LifecycleEnums.TerminalReason" })
export type TerminalReason = typeof TerminalReason.Type

// SettlementState is the terminal-versus-settlement sub-state; Feature 005
// owns settlement (C20).
export const SettlementState = Schema.Literals(["settled", "settling", "unknown", "corrupt"]).annotate({
  identifier: "LifecycleEnums.SettlementState",
})
export type SettlementState = typeof SettlementState.Type

// Visibility is the authorization scope enforced before delivery (FR11, C14).
export const Visibility = Schema.Literals(["session", "tree", "global_privileged"]).annotate({
  identifier: "LifecycleEnums.Visibility",
})
export type Visibility = typeof Visibility.Type

// AgentKind names the agent class that owns the process.
export const AgentKind = Schema.Literals(["architect", "manager", "worker", "subagent", "primary"]).annotate({
  identifier: "LifecycleEnums.AgentKind",
})
export type AgentKind = typeof AgentKind.Type

// ActorKind names who acted to produce the event.
export const ActorKind = Schema.Literals(["runtime", "operator", "executor"]).annotate({
  identifier: "LifecycleEnums.ActorKind",
})
export type ActorKind = typeof ActorKind.Type
