// DDD role: ValueObject
// Package: outputspool.events
// OutputEvent — the closed tagged union of the output.* event members (C20), plus
// the cohesive detail sub-objects distinct members carry. Mirroring Feature 002/003/
// 004, each member is registered as its own EventV2.define Definition on the
// EventV2Bridge via publishOutputEvent; no raw union is wired to the bus (C20).
// Durable settlement members carry the EventV2 durable {version, aggregate}
// annotation and replay through readAggregate; live signals omit it and may be
// dropped under allBounded load (C20). Members live in events-settlement.cue and
// events-live.cue.

package outputspool.events

import (
	"outputspool/ids"
	"outputspool/values"
	"outputspool/enums"
)

// SealDetail carries the finalized committed length and its integrity tag (FR24, C2, C20).
#SealDetail: {
	committed_bytes: values.#CommittedBytes
	integrity_tag:   ids.#IntegrityTag
}

// AbortDetail carries the preserved committed length and a bounded reason (FR24, C4, C20).
#AbortDetail: {
	committed_bytes: values.#CommittedBytes
	outcome:         enums.#SettlementOutcome
}

// SettlementDetail carries the content-plane settlement outcome and committed length (FR23, C13).
#SettlementDetail: {
	outcome:         enums.#SettlementOutcome
	committed_bytes: values.#CommittedBytes
}

// ReconcileDetail carries the crash-reconciliation outcome and committed length (FR25, C12, AC8).
#ReconcileDetail: {
	outcome:         enums.#SettlementOutcome
	committed_bytes: values.#CommittedBytes
}

// FenceDetail carries the fencing generation that rejected a superseded writer (FR27, C18, AC11).
#FenceDetail: {
	generation: values.#Generation
	outcome:    enums.#SettlementOutcome
}

// RetentionEventDetail carries the reference-edge kind for a release/reclaim event (FR28-FR30, C5).
#RetentionEventDetail: {
	edge_kind: enums.#RetentionEdgeKind
	scope:     enums.#QuotaScope
}

// AdmissionEventDetail carries the observable admission fault and its scope (FR10, C4, AC7).
#AdmissionEventDetail: {
	fault: enums.#AdmissionFault
	scope: enums.#QuotaScope
}

// OutputEvent is the closed tagged union of every output.* event member (C20).
#OutputEvent: (
	#OutputChannelSealedEvent |
	#OutputChannelAbortedEvent |
	#OutputSettlementRecordedEvent |
	#OutputReconciledEvent |
	#OutputGenerationFencedEvent |
	#OutputGroupReleasedEvent |
	#OutputGroupReclaimedEvent |
	#OutputChunkAppendedEvent |
	#OutputBackpressureSignalledEvent |
	#OutputAdmissionDegradedEvent |
	#OutputUnknownEvent
)
