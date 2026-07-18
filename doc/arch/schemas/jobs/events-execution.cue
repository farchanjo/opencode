// DDD role: ValueObject
// Package: jobs.events
// Execution-terminal and reconciliation event members (C6, C8). Terminal events
// are durable and never coalesced or dropped; the durable aggregate preserves them
// across bounded-queue overflow and restart (FR11, FR12, C8). Reconciliation never
// replays an ambiguous mutation (FR14, AC19).

package jobs.events

import "jobs/envelope"

// execution_started — the Feature 002 executor began the occurrence process (FR8, C16).
#JobExecutionStartedEvent: {
	type:     "job.execution_started"
	envelope: envelope.#JobEnvelope
}

// execution_completed — the occurrence process completed; Feature 002 owns terminal (FR8a, C15).
#JobExecutionCompletedEvent: {
	type:     "job.execution_completed"
	envelope: envelope.#JobEnvelope
	detail:   #ExecutionDetail
}

// execution_failed — the occurrence process failed with a bounded reason (FR11).
#JobExecutionFailedEvent: {
	type:     "job.execution_failed"
	envelope: envelope.#JobEnvelope
	detail:   #ExecutionDetail
}

// execution_cancelled — the occurrence was cancelled without touching the definition (FR16, AC27).
#JobExecutionCancelledEvent: {
	type:     "job.execution_cancelled"
	envelope: envelope.#JobEnvelope
	detail:   #ExecutionDetail
}

// execution_timed_out — the occurrence exceeded its deadline/timeout (FR11, C11).
#JobExecutionTimedOutEvent: {
	type:     "job.execution_timed_out"
	envelope: envelope.#JobEnvelope
	detail:   #ExecutionDetail
}

// retry_scheduled — a retry was scheduled only under an explicit mutation-safe policy (FR14, C11).
#JobRetryScheduledEvent: {
	type:     "job.retry_scheduled"
	envelope: envelope.#JobEnvelope
	detail:   #RetryDetail
}

// reconciled — a versioned reconciliation settled a pending/unknown occurrence (FR14, C5).
#JobReconciledEvent: {
	type:     "job.reconciled"
	envelope: envelope.#JobEnvelope
	detail:   #ReconcileDetail
}

// unknown — an occurrence entered the unknown state pending reconciliation (FR14, C7).
#JobUnknownEvent: {
	type:     "job.unknown"
	envelope: envelope.#JobEnvelope
}
