// DDD role: ValueObject
// Package: lifecycle.events
// Terminal and owner-loss durable event members (C4, C5). Terminal events are
// never coalesced or dropped; the durable aggregate preserves them across
// bounded-queue overflow and restart (FR36, AC8).

package lifecycle.events

import "lifecycle/envelope"

// completed — the process finished; settlement may still be pending (C20).
#LifecycleCompletedEvent: {
	type:     "lifecycle.completed"
	envelope: envelope.#LifecycleEnvelope
	detail:   #TerminalDetail
}

// failed — the process terminated with an error.
#LifecycleFailedEvent: {
	type:     "lifecycle.failed"
	envelope: envelope.#LifecycleEnvelope
	detail:   #TerminalDetail
}

// cancelled — the process terminated via a cancel request.
#LifecycleCancelledEvent: {
	type:     "lifecycle.cancelled"
	envelope: envelope.#LifecycleEnvelope
	detail:   #TerminalDetail
}

// zombie_detected — lease expiry with absent owner heartbeat (C12, AC11).
#LifecycleZombieDetectedEvent: {
	type:     "lifecycle.zombie_detected"
	envelope: envelope.#LifecycleEnvelope
	detail:   #WatchdogDetail
}

// owner_lost — the owning runtime was lost; no provider-stop is claimed (C12).
#LifecycleOwnerLostEvent: {
	type:     "lifecycle.owner_lost"
	envelope: envelope.#LifecycleEnvelope
	detail:   #WatchdogDetail
}
