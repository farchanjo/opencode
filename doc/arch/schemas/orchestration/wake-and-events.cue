// DDD role: ValueObject
// Package: orchestration
// Feature 044 Leaf D (FR-D) — the event-driven, coalesced, max-wait-bounded
// wake-rule — and the DomainEvents the orchestration transitions record on the
// shared store (worker terminal, completion-blocked, worker timeout).

package orchestration

// WakeTrigger names the terminal signal that wakes the Manager (FR-D1): the
// background.wait resolution, corroborated by session Idle/Deleted/Error, or the
// bounded max-wait expiry that force-aborts a never-completing Worker (FR-D3).
// DDD role: ValueObject
#WakeTrigger: "child_completed" | "child_failed" | "child_aborted" | "session_idle" | "max_wait_expired"

// WakeCoalescing is whether repeat signals for a child collapse to one wake, as a
// constrained ValueObject rather than a bare boolean (Object Calisthenics,
// wrap-primitives). Coalesced = one wake per Worker terminal transition (FR-D2).
// DDD role: ValueObject
#WakeCoalescing: "coalesced" | "uncoalesced"

// WorkerWakeRule is the event-driven, coalesced, max-wait-bounded wake contract for
// one delegated Worker (FR-D1, FR-D2, FR-D3). Wakes coalesce per child session id
// and are idempotent; a hung Worker is bounded by max_wait_ms — never a poll loop.
// DDD role: ValueObject
#WorkerWakeRule: {
	child_session_id: #SessionId
	trigger:          #WakeTrigger
	max_wait_ms:      #MaxWaitMs
	coalescing:       #WakeCoalescing
}

// WorkerCompletedEvent — a delegated Worker reached a terminal state and its
// WorkerOutcome was updated in the Manager aggregate (FR-A2, FR-D1).
// DDD role: DomainEvent
#WorkerCompletedEvent: {
	type:               "worker.completed"
	manager_session_id: #SessionId
	child_session_id:   #SessionId
	lifecycle:          #WorkerLifecycle & ("done" | "failed" | "aborted")
	todo:               #TodoRollup
	reason?:            #FailureReason
}

// OrchestrationCompletionBlockedEvent — the Manager turn was held open because at
// least one delegated Worker is still pending (FR-B1, FR-B3).
// DDD role: DomainEvent
#OrchestrationCompletionBlockedEvent: {
	type:               "orchestration.completion_blocked"
	manager_session_id: #SessionId
	pending_workers:    #Count & >=1
}

// WorkerTimedOutEvent — a delegated Worker did not reach a terminal state within
// its max-wait and was force-aborted so the completion gate can settle (FR-D3).
// DDD role: DomainEvent
#WorkerTimedOutEvent: {
	type:               "worker.timed_out"
	manager_session_id: #SessionId
	child_session_id:   #SessionId
	max_wait_ms:        #MaxWaitMs
	reason:             #FailureReason
}

// OrchestrationEvent — the tagged union of Feature 044 orchestration events.
// DDD role: DomainEvent
#OrchestrationEvent: #WorkerCompletedEvent | #OrchestrationCompletionBlockedEvent | #WorkerTimedOutEvent
