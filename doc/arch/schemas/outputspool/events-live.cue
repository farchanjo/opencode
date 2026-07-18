// DDD role: ValueObject
// Package: outputspool.events
// Live signal event members (C20). Append, backpressure and admission-degrade
// signals use the bounded live channel and MAY be dropped under allBounded load
// without affecting durable seal/read (C20). They carry no sequence and never gate
// work (FR8, C4). The unknown member is envelope-only and never gates work.

package outputspool.events

import "outputspool/envelope"

// chunk_appended — a bounded-queue chunk was committed; droppable live progress (FR8, AC2).
#OutputChunkAppendedEvent: {
	type:     "output.chunk_appended"
	envelope: envelope.#OutputEnvelope
}

// backpressure_signalled — the writer queue hit its bound; producer backpressured (FR8, C3, AC5).
#OutputBackpressureSignalledEvent: {
	type:     "output.backpressure_signalled"
	envelope: envelope.#OutputEnvelope
	detail:   #AdmissionEventDetail
}

// admission_degraded — an observable admission fault degraded the channel (FR10, C4, AC6, AC7).
#OutputAdmissionDegradedEvent: {
	type:     "output.admission_degraded"
	envelope: envelope.#OutputEnvelope
	detail:   #AdmissionEventDetail
}

// unknown — an envelope-only fallback member; never gates work (C20).
#OutputUnknownEvent: {
	type:     "output.unknown"
	envelope: envelope.#OutputEnvelope
}
