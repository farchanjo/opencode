// DDD role: ValueObject
// Package: jobs.events
// Occurrence-lifecycle event members (C6, C8). trigger_due is a live observation;
// occurrence_claimed / triggered / admitted are durable checkpoints; misfire,
// skip, coalesce, overlap outcomes are explicit and never hidden retries (FR19, C19).

package jobs.events

import "jobs/envelope"

// trigger_due — the in-process Bun.cron callback fired; no polling (FR8, AC1).
#JobTriggerDueEvent: {
	type:     "job.trigger_due"
	envelope: envelope.#JobEnvelope
	detail:   #TriggerDetail
}

// occurrence_claimed — the idempotency tuple was claimed for a single execution (FR10, C6).
#JobOccurrenceClaimedEvent: {
	type:     "job.occurrence_claimed"
	envelope: envelope.#JobEnvelope
}

// triggered — an occurrence was created before admission (FR8, C16).
#JobTriggeredEvent: {
	type:     "job.triggered"
	envelope: envelope.#JobEnvelope
}

// misfired — a missed trigger resolved to an explicit misfire outcome (FR15, FR19, AC3).
#JobMisfiredEvent: {
	type:     "job.misfired"
	envelope: envelope.#JobEnvelope
	detail:   #MisfireDetail
}

// skipped — a missed trigger was skipped per the misfire policy (FR15, AC3).
#JobSkippedEvent: {
	type:     "job.skipped"
	envelope: envelope.#JobEnvelope
	detail:   #MisfireDetail
}

// coalesced — missed triggers coalesced into one occurrence (FR15, C19).
#JobCoalescedEvent: {
	type:     "job.coalesced"
	envelope: envelope.#JobEnvelope
	detail:   #MisfireDetail
}

// queued — the occurrence was queued under Feature 002 admission backpressure (FR17, FR18).
#JobQueuedEvent: {
	type:     "job.queued"
	envelope: envelope.#JobEnvelope
}

// admitted — Feature 002 admission granted capacity for the occurrence (FR17, C16).
#JobAdmittedEvent: {
	type:     "job.admitted"
	envelope: envelope.#JobEnvelope
}

// overlap_rejected — a new trigger was rejected under the forbid overlap policy (FR16, C3).
#JobOverlapRejectedEvent: {
	type:     "job.overlap_rejected"
	envelope: envelope.#JobEnvelope
	detail:   #OverlapDetail
}

// overlap_replaced — a prior occurrence was replaced without a silent mutating kill (FR16, AC25).
#JobOverlapReplacedEvent: {
	type:     "job.overlap_replaced"
	envelope: envelope.#JobEnvelope
	detail:   #OverlapDetail
}
