// DDD role: ValueObject
// Package: lifecycle.admission
// Per-scope token-bucket admission over measured capacity with hard ceilings and
// no unbounded queue (C11, FR30, FR34). The projection and observers never call
// admission; these are the admission service's own state and projected outcome.

package lifecycle.admission

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// CapacitySignals hold measured saturation in [0.0, 1.0] per capacity source (FR2).
#CapacitySignals: {
	cpu_saturation:         ids.#Confidence
	mem_saturation:         ids.#Confidence
	provider_saturation:    ids.#Confidence
	sqlite_saturation:      ids.#Confidence
	event_queue_saturation: ids.#Confidence
	otel_queue_saturation:  ids.#Confidence
}

// TokenBucketState holds the hard ceiling and current fill; never relaxed by a model (FR34).
#TokenBucketState: {
	capacity:          uint & >0
	available:         uint & >=0
	refill_per_second: uint & >0
}

// Fenced flags a scope quarantined after a root cancel request (C17, AC30).
#Fenced: bool

// AdmissionBucket is one scope's token bucket and fence state.
#AdmissionBucket: {
	scope:  enums.#AdmissionScope
	bucket: #TokenBucketState
	fenced: #Fenced
}

// AdmissionResult projects a granted/partial/queued/rejected outcome with fanout (C11, FR31).
#AdmissionResult: {
	scope:    enums.#AdmissionScope
	decision: enums.#AdmissionDecision
	fanout:   ids.#Fanout
	reason:   ids.#Reason
}
