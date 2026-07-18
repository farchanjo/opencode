// DDD role: ValueObject
// Package: jobs.enums
// Core bounded enums for the Feature 003 scheduled-jobs engine — registration,
// occurrence lifecycle, misfire/overlap policy, scope and capability (FR6, FR11,
// FR15, FR16, C5, C6). Notification and event/envelope enums live in
// enums-notification.cue and enums-event.cue.

package jobs.enums

// RegistrationState models the boundary between the durable authority and the
// external Bun/OS registration effect; no cross-system atomic commit (FR6, C5).
#RegistrationState: "pending" | "registered" | "unregistered" | "unknown" | "reconciled"

// RegistrationIntent is the durable intent that precedes the external effect (C5).
#RegistrationIntent: "register" | "unregister"

// OccurrenceState is the closed occurrence state machine due -> claimed -> admitted
// -> executing -> terminal, plus branch outcomes (FR11, C6).
#OccurrenceState: "due" | "claimed" | "admitted" | "executing" | "completed" | "failed" | "cancelled" | "timed_out" | "skipped" | "coalesced" | "misfired" | "overlap_rejected" | "overlap_replaced" | "reconciled" | "unknown"

// MisfirePolicy is configurable and never allows infinite catch-up (FR15, C19).
#MisfirePolicy: "skip" | "fire_once" | "bounded_catch_up" | "coalesce"

// OverlapPolicy defaults to forbid; non-default values are capability-gated (FR16, C3).
#OverlapPolicy: "allow" | "forbid" | "queue" | "replace"

// ActionType categorizes the target/action of a definition (FR28).
#ActionType: "native_maintenance" | "operator_notification" | "main_context_wake" | "smart_routing_dispatch" | "approved_workflow"

// Scope bounds ownership/visibility of a definition; default is project (C12).
#Scope: "global" | "project" | "root" | "session"

// CapabilitySurface distinguishes the in-process form from the deferred OS-level form (C1, C2).
#CapabilitySurface: "in_process" | "os_level"

// ReconcileOutcome records reconciliation without claiming past execution (FR14, C5).
#ReconcileOutcome: "reconciled" | "unknown"

// EventClass separates durable (replayable) from live (no sequence) job.* events (C8).
#EventClass: "durable" | "live"
