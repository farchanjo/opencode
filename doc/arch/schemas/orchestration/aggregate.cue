// DDD role: ValueObject
// Package: orchestration
// Feature 044 Leaf A (FR-A) — the Manager's roll-up of every delegated Worker,
// recorded on the shared RoutingSessionState keyed by child session id and released
// with the session. A failed/aborted Worker is first-class, never dropped; the
// counters always sum to the delegated total.

package orchestration

// WorkerLifecycle is the terminal-or-pending state of one delegated Worker
// (FR-A2). Terminal = done | failed | aborted; pending = still running/queued.
// DDD role: ValueObject
#WorkerLifecycle: "pending" | "done" | "failed" | "aborted"

// TodoStatusCounts is the bounded per-status count of a child's Todo items — the
// roll-up carries counts only, never full item content (FR-A1, Security).
// DDD role: ValueObject
#TodoStatusCounts: {
	pending:     #Count
	in_progress: #Count
	completed:   #Count
	cancelled:   #Count
}

// TodoRollup is the bounded, read-only projection of a child's Todo aggregate the
// Manager folds into its roll-up (mirrors todo-authority.ts summarize; FR-A1, FR-A4).
// DDD role: ValueObject
#TodoRollup: {
	ref:           #TodoRef
	version:       #TodoVersion
	item_count:    #Count
	status_counts: #TodoStatusCounts
}

// WorkerOutcome is one delegated Worker's entry in the Manager aggregate: an
// immutable recorded snapshot of its lifecycle, its Todo roll-up, and (for a
// terminal failure/abort) a bounded reason (FR-A1, FR-A2, FR-A3). It references a
// Worker by session id but holds no mutable identity of its own.
// DDD role: ValueObject
#WorkerOutcome: {
	child_session_id: #SessionId
	lifecycle:        #WorkerLifecycle
	todo:             #TodoRollup
	// Present only for a failed or aborted Worker (FR-A3).
	reason?: #FailureReason
}

// WorkerRollupCounters is the aggregate's invariant summary: the counts always sum
// to the delegated Worker total (FR-A3) so "all done" is distinguishable from "all
// terminal, some failed".
// DDD role: ValueObject
#WorkerRollupCounters: {
	total:   #Count
	pending: #Count
	done:    #Count
	failed:  #Count
	aborted: #Count
}

// WorkerRoster is the first-class collection of delegated Worker outcomes — a
// collection-only ValueObject so the aggregate root never mixes a raw list with
// its scalar fields (Object Calisthenics, first-class collection).
// DDD role: ValueObject
#WorkerRoster: {
	entries: [...#WorkerOutcome]
}

// ManagerWorkerAggregate is the Manager's roll-up of every delegated Worker — the
// aggregate root recorded on the shared RoutingSessionState keyed by the Manager
// session id (FR-A1, FR-E3). Released with the session (tool/task.ts store.clear).
// DDD role: Entity
#ManagerWorkerAggregate: {
	manager_session_id: #SessionId
	roster:             #WorkerRoster
	counters:           #WorkerRollupCounters
}
