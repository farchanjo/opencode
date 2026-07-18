export * as Enums from "./enums"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/enums.cue (package jobs.enums) for the core
// scheduling closed enums — registration, occurrence lifecycle, misfire/overlap
// policy, action, scope and capability (FR6, FR11, FR15, FR16, C5, C6). Event
// source/actor/visibility enums live in ./enums-event; notification enums live
// in ./enums-notification; the closed job.* vocabulary lives in ./event-types.

// RegistrationState models the boundary between the durable authority and the
// external Bun/OS registration effect; no cross-system atomic commit (FR6, C5).
export const RegistrationState = Schema.Literals([
  "pending",
  "registered",
  "unregistered",
  "unknown",
  "reconciled",
]).annotate({ identifier: "JobsEnums.RegistrationState" })
export type RegistrationState = typeof RegistrationState.Type

// RegistrationIntent is the durable intent that precedes the external effect (C5).
export const RegistrationIntent = Schema.Literals(["register", "unregister"]).annotate({
  identifier: "JobsEnums.RegistrationIntent",
})
export type RegistrationIntent = typeof RegistrationIntent.Type

// OccurrenceState is the closed occurrence state machine due -> claimed ->
// admitted -> executing -> terminal, plus branch outcomes (FR11, C6).
export const OccurrenceState = Schema.Literals([
  "due",
  "claimed",
  "admitted",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "skipped",
  "coalesced",
  "misfired",
  "overlap_rejected",
  "overlap_replaced",
  "reconciled",
  "unknown",
]).annotate({ identifier: "JobsEnums.OccurrenceState" })
export type OccurrenceState = typeof OccurrenceState.Type

// MisfirePolicy is configurable and never allows infinite catch-up (FR15, C19).
export const MisfirePolicy = Schema.Literals(["skip", "fire_once", "bounded_catch_up", "coalesce"]).annotate({
  identifier: "JobsEnums.MisfirePolicy",
})
export type MisfirePolicy = typeof MisfirePolicy.Type

// OverlapPolicy defaults to forbid; non-default values are capability-gated (FR16, C3).
export const OverlapPolicy = Schema.Literals(["allow", "forbid", "queue", "replace"]).annotate({
  identifier: "JobsEnums.OverlapPolicy",
})
export type OverlapPolicy = typeof OverlapPolicy.Type

// ActionType categorizes the target/action of a definition (FR28).
export const ActionType = Schema.Literals([
  "native_maintenance",
  "operator_notification",
  "main_context_wake",
  "smart_routing_dispatch",
  "approved_workflow",
]).annotate({ identifier: "JobsEnums.ActionType" })
export type ActionType = typeof ActionType.Type

// Scope bounds ownership/visibility of a definition; default is project (C12).
export const Scope = Schema.Literals(["global", "project", "root", "session"]).annotate({
  identifier: "JobsEnums.Scope",
})
export type Scope = typeof Scope.Type

// CapabilitySurface distinguishes the in-process form from the deferred OS-level form (C1, C2).
export const CapabilitySurface = Schema.Literals(["in_process", "os_level"]).annotate({
  identifier: "JobsEnums.CapabilitySurface",
})
export type CapabilitySurface = typeof CapabilitySurface.Type

// ReconcileOutcome records reconciliation without claiming past execution (FR14, C5).
export const ReconcileOutcome = Schema.Literals(["reconciled", "unknown"]).annotate({
  identifier: "JobsEnums.ReconcileOutcome",
})
export type ReconcileOutcome = typeof ReconcileOutcome.Type

// EventClass separates durable (replayable) from live (no sequence) job.* events (C8).
export const EventClass = Schema.Literals(["durable", "live"]).annotate({
  identifier: "JobsEnums.EventClass",
})
export type EventClass = typeof EventClass.Type
