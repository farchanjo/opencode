// DDD role: ValueObject
// Package: lifecycle.enums
// Core bounded enums for the Feature 002 lifecycle engine.

package lifecycle.enums

// ProcessState is the closed set of ten Process Table states (C7, FR25).
// handoff is an event, never a state.
#ProcessState: "created" | "queued" | "waiting" | "running" | "cancelling" | "completed" | "failed" | "cancelled" | "zombie" | "unknown"

// LifecycleEventType is the closed 26-member event vocabulary (FR20).
#LifecycleEventType: "lifecycle.admitted" | "lifecycle.parent_attached" | "lifecycle.process_created" | "lifecycle.queued" | "lifecycle.waiting" | "lifecycle.started" | "lifecycle.promoted" | "lifecycle.extended" | "lifecycle.handoff" | "lifecycle.steer_requested" | "lifecycle.steer_accepted" | "lifecycle.steer_rejected" | "lifecycle.turn_started" | "lifecycle.turn_ended" | "lifecycle.turn_failed" | "lifecycle.tool_called" | "lifecycle.tool_settled" | "lifecycle.cancel_requested" | "lifecycle.cancelling" | "lifecycle.completed" | "lifecycle.failed" | "lifecycle.cancelled" | "lifecycle.owner_lost" | "lifecycle.zombie_detected" | "lifecycle.reconciled" | "lifecycle.unknown"

// EventClass separates durable (replayable) from live (no sequence) events (C4).
#EventClass: "durable" | "live"

// TerminalReason is recorded on terminal events and rows (FR23, FR27).
#TerminalReason: "completed_ok" | "error" | "cancelled_by_operator" | "cancelled_by_root" | "zombie" | "owner_lost" | "reconciled_unknown"

// SettlementState is the terminal-versus-settlement sub-state; Feature 005 owns settlement (C20).
#SettlementState: "settled" | "settling" | "unknown" | "corrupt"

// Visibility is the authorization scope enforced before delivery (FR11, C14).
#Visibility: "session" | "tree" | "global_privileged"

// AgentKind names the agent class that owns the process.
#AgentKind: "architect" | "manager" | "worker" | "subagent" | "primary"

// ActorKind names who acted to produce the event.
#ActorKind: "runtime" | "operator" | "executor"

// CancelOutcome enumerates control outcomes; no remote kill is promised (C17, FR41).
#CancelOutcome: "requested" | "accepted" | "rejected" | "unknown" | "unconfirmed"

// AnomalyKind classifies a projection anomaly without inventing terminal state (C9).
#AnomalyKind: "duplicate" | "out_of_order" | "unknown_event" | "unreconciled"
