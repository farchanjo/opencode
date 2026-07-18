// DDD role: ValueObject
// Package: lifecycle.events
// LifecycleEvent — the closed tagged union of all 26 Feature 002 event members,
// plus the cohesive detail sub-objects distinct members carry (FR20, FR21).
// Mirroring Feature 001, each member is registered as its own EventV2.define
// Definition on the EventV2Bridge; no raw union is wired to the bus (C2).

package lifecycle.events

import (
	"lifecycle/ids"
	"lifecycle/enums"
	"lifecycle/usage"
)

// AdmissionDetail carries the admission scope, decision and fanout (C11).
#AdmissionDetail: {
	scope:    enums.#AdmissionScope
	decision: enums.#AdmissionDecision
	fanout:   ids.#Fanout
}

// HandoffEndpoint locates one side of a handoff by session and process.
#HandoffEndpoint: {
	session_id: ids.#SessionId
	process_id: ids.#ProcessId
}

// HandoffDetail carries source, target, reason and generation (C16, FR22).
#HandoffDetail: {
	source:     #HandoffEndpoint
	target:     #HandoffEndpoint
	reason:     ids.#Reason
	generation: ids.#Generation
}

// TerminalDetail carries terminal reason, settlement sub-state and final usage (FR23, C20).
#TerminalDetail: {
	reason:      enums.#TerminalReason
	settlement:  enums.#SettlementState
	final_usage: usage.#LiveUsage
}

// WatchdogDetail carries owner-loss/zombie outcome without claiming a provider stopped (C12).
#WatchdogDetail: {
	outcome:  enums.#WatchdogOutcome
	lease_id: ids.#LeaseId | null
	reason:   ids.#Reason
}

// ToolActivityDetail carries an allowlisted activity and its rendered label (FR56).
#ToolActivityDetail: {
	activity: enums.#ActivityKind
	label:    ids.#ActivityLabel
}

// SteerDetail carries a control outcome and reason for steer/cancel-intent events (FR21).
#SteerDetail: {
	outcome: enums.#CancelOutcome
	reason:  ids.#Reason
}

// ReconcileDetail carries the reconciliation outcome and prior schema version (C13).
#ReconcileDetail: {
	outcome:      enums.#WatchdogOutcome
	from_version: ids.#SchemaVersion
}

// LifecycleEvent is the closed tagged union of every FR20 vocabulary member.
#LifecycleEvent: (
	#LifecycleAdmittedEvent |
	#LifecycleParentAttachedEvent |
	#LifecycleProcessCreatedEvent |
	#LifecycleStartedEvent |
	#LifecycleHandoffEvent |
	#LifecycleReconciledEvent |
	#LifecycleCompletedEvent |
	#LifecycleFailedEvent |
	#LifecycleCancelledEvent |
	#LifecycleZombieDetectedEvent |
	#LifecycleOwnerLostEvent |
	#LifecycleQueuedEvent |
	#LifecycleWaitingEvent |
	#LifecyclePromotedEvent |
	#LifecycleExtendedEvent |
	#LifecycleTurnStartedEvent |
	#LifecycleTurnEndedEvent |
	#LifecycleTurnFailedEvent |
	#LifecycleUnknownEvent |
	#LifecycleSteerRequestedEvent |
	#LifecycleSteerAcceptedEvent |
	#LifecycleSteerRejectedEvent |
	#LifecycleCancelRequestedEvent |
	#LifecycleCancellingEvent |
	#LifecycleToolCalledEvent |
	#LifecycleToolSettledEvent
)
