export * as EnumsObservation from "./enums-observation"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/lifecycle/enums-observation.cue (package
// lifecycle.enums) one-to-one, plus CancelOutcome and AnomalyKind — the CUE
// groups those two into enums.cue, but tasks.md T003/T004 and data-model.md
// place them in this observation module; both CUE files share the same
// lifecycle.enums package, so the field vocabulary is identical and only the
// TypeScript file boundary differs (C9, C11, C12, C14, C15, C17, C21).
//
// Every enum is a closed Schema.Literals set annotated with its root
// identifier; Schema.Literals carries no `.check(...)`, so the annotation is
// applied directly (see test/contract-hygiene.test.ts).

// UsageProvenance marks whether usage is estimated or provider-reported (C21).
export const UsageProvenance = Schema.Literals(["estimated", "reported"]).annotate({
  identifier: "LifecycleEnums.UsageProvenance",
})
export type UsageProvenance = typeof UsageProvenance.Type

// UsageSource names the origin of a usage measurement (C21).
export const UsageSource = Schema.Literals(["provider", "runtime", "local_estimate"]).annotate({
  identifier: "LifecycleEnums.UsageSource",
})
export type UsageSource = typeof UsageSource.Type

// ActivityKind is the allowlisted card-activity vocabulary; no raw paths reach
// the renderer (FR56).
export const ActivityKind = Schema.Literals([
  "read",
  "edit",
  "run_command",
  "search",
  "waiting",
  "generating",
  "settling",
]).annotate({ identifier: "LifecycleEnums.ActivityKind" })
export type ActivityKind = typeof ActivityKind.Type

// HierarchyRole is reused verbatim from Feature 001 (C15).
export const HierarchyRole = Schema.Literals(["architect", "manager", "worker"]).annotate({
  identifier: "LifecycleEnums.HierarchyRole",
})
export type HierarchyRole = typeof HierarchyRole.Type

// ValidationOutcome is reused verbatim from Feature 001 (C15).
export const ValidationOutcome = Schema.Literals(["passed", "failed", "low_confidence", "escalated"]).annotate({
  identifier: "LifecycleEnums.ValidationOutcome",
})
export type ValidationOutcome = typeof ValidationOutcome.Type

// AnomalyKind classifies a projection anomaly without inventing terminal state
// (C9, FR29).
export const AnomalyKind = Schema.Literals(["duplicate", "out_of_order", "unknown_event", "unreconciled"]).annotate({
  identifier: "LifecycleEnums.AnomalyKind",
})
export type AnomalyKind = typeof AnomalyKind.Type

// CancelOutcome enumerates control outcomes; no remote kill is promised
// (C17, FR41).
export const CancelOutcome = Schema.Literals([
  "requested",
  "accepted",
  "rejected",
  "unknown",
  "unconfirmed",
]).annotate({ identifier: "LifecycleEnums.CancelOutcome" })
export type CancelOutcome = typeof CancelOutcome.Type

// WatchdogOutcome names lease/reconciliation results without claiming a provider
// stopped (C12).
export const WatchdogOutcome = Schema.Literals([
  "owner_lost",
  "zombie_detected",
  "unknown",
  "reconciled",
]).annotate({ identifier: "LifecycleEnums.WatchdogOutcome" })
export type WatchdogOutcome = typeof WatchdogOutcome.Type

// AdmissionScope is the per-scope token-bucket budget dimension (C11, FR31).
export const AdmissionScope = Schema.Literals([
  "global",
  "root",
  "session",
  "child",
  "provider",
  "agent",
  "tool",
  "event_queue",
  "otel_queue",
  "sqlite",
  "token",
  "cost",
]).annotate({ identifier: "LifecycleEnums.AdmissionScope" })
export type AdmissionScope = typeof AdmissionScope.Type

// AdmissionDecision is the projected admission outcome (C11).
export const AdmissionDecision = Schema.Literals(["granted", "partial", "queued", "rejected"]).annotate({
  identifier: "LifecycleEnums.AdmissionDecision",
})
export type AdmissionDecision = typeof AdmissionDecision.Type

// ObservationKind selects the observation API surface (C14).
export const ObservationKind = Schema.Literals(["session", "process", "tree", "global"]).annotate({
  identifier: "LifecycleEnums.ObservationKind",
})
export type ObservationKind = typeof ObservationKind.Type
