// DDD role: AggregateRoot
// Package: jobs.occurrence
// JobOccurrence — one logical trigger occurrence that executes as a canonical
// Feature 002 Task Process (FR8, FR10, C6, C16). It carries idempotency identity
// and correlation/causation to its definition, schedule, session/root tree and
// resulting process; sequence/attempt/generation authority is the Feature 002
// executor, never the scheduler (C6). Cohesive parts live in occurrence-parts.cue.

package jobs.occurrence

import "jobs/ids"

// JobOccurrence is the aggregate root of a trigger occurrence; id is occurrence_id (FR1, FR10).
#JobOccurrence: {
	id: ids.#OccurrenceId

	// The (definition, schedule, nominal_due_time, generation) idempotency tuple (C6).
	idempotency: #IdempotencyKey

	// Correlation/causation and session/root/process lineage (FR10, FR12).
	lineage: #OccurrenceLineage

	// Attempt, generation, sequence and occurrence-owned Todo/OutputGroup refs (FR8, FR8a).
	execution: #OccurrenceExecution

	// State-machine state, reason, lag, duplicate resolution and timestamps (C6).
	status: #OccurrenceStatus
}
