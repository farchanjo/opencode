// DDD role: ValueObject
// Package: lifecycle.events
// Envelope-only live event members (C4). Live members omit the durable
// annotation — no sequence, no replay; they are sampling/coalescing targets
// while terminal events stay durable (C5, FR36).

package lifecycle.events

import "lifecycle/envelope"

// queued — admitted work is waiting for a run slot.
#LifecycleQueuedEvent: {
	type:     "lifecycle.queued"
	envelope: envelope.#LifecycleEnvelope
}

// waiting — the process is blocked on input or a dependency.
#LifecycleWaitingEvent: {
	type:     "lifecycle.waiting"
	envelope: envelope.#LifecycleEnvelope
}

// promoted — priority/fairness promotion; distinct from a status update (FR21).
#LifecyclePromotedEvent: {
	type:     "lifecycle.promoted"
	envelope: envelope.#LifecycleEnvelope
}

// extended — budget/turn extension; distinct from a status update (FR21).
#LifecycleExtendedEvent: {
	type:     "lifecycle.extended"
	envelope: envelope.#LifecycleEnvelope
}

// turn_started — a model/agent turn began.
#LifecycleTurnStartedEvent: {
	type:     "lifecycle.turn_started"
	envelope: envelope.#LifecycleEnvelope
}

// turn_ended — a model/agent turn completed.
#LifecycleTurnEndedEvent: {
	type:     "lifecycle.turn_ended"
	envelope: envelope.#LifecycleEnvelope
}

// turn_failed — a model/agent turn failed without terminating the process.
#LifecycleTurnFailedEvent: {
	type:     "lifecycle.turn_failed"
	envelope: envelope.#LifecycleEnvelope
}

// unknown — an observed but unclassified transition; never invents terminal state (C9).
#LifecycleUnknownEvent: {
	type:     "lifecycle.unknown"
	envelope: envelope.#LifecycleEnvelope
}
