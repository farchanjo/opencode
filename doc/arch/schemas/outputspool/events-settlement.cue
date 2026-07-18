// DDD role: ValueObject
// Package: outputspool.events
// Durable settlement event members (C20). Seal, abort, settlement, reconciliation,
// generation-fencing and retention release/reclaim are durable and never coalesced
// or dropped; they replay through readAggregate (FR4, C20). Seal commits finality
// of committed bytes; abort preserves committed bytes; seal is never reported as
// success when bytes were lost (FR24, FR25, C4, C12, AC6, AC8). Content is never an
// event payload (FR4, FR5, C22).

package outputspool.events

import "outputspool/envelope"

// channel_sealed — committed bytes were finalized for a generation (FR24, C2, AC8).
#OutputChannelSealedEvent: {
	type:     "output.channel_sealed"
	envelope: envelope.#OutputEnvelope
	detail:   #SealDetail
}

// channel_aborted — append stopped while committed bytes are preserved (FR24, C4, AC10).
#OutputChannelAbortedEvent: {
	type:     "output.channel_aborted"
	envelope: envelope.#OutputEnvelope
	detail:   #AbortDetail
}

// settlement_recorded — the content-plane settlement outcome preceding terminal status (FR23, C13, AC9).
#OutputSettlementRecordedEvent: {
	type:     "output.settlement_recorded"
	envelope: envelope.#OutputEnvelope
	detail:   #SettlementDetail
}

// reconciled — crash recovery reconciled the group into a settlement outcome (FR25, C12, AC8).
#OutputReconciledEvent: {
	type:     "output.reconciled"
	envelope: envelope.#OutputEnvelope
	detail:   #ReconcileDetail
}

// generation_fenced — a superseded writer's append/seal was rejected by fencing (FR27, C18, AC11).
#OutputGenerationFencedEvent: {
	type:     "output.generation_fenced"
	envelope: envelope.#OutputEnvelope
	detail:   #FenceDetail
}

// group_released — one holder reference edge was dropped (FR30, C5).
#OutputGroupReleasedEvent: {
	type:     "output.group_released"
	envelope: envelope.#OutputEnvelope
	detail:   #RetentionEventDetail
}

// group_reclaimed — a fully unreferenced expired group was reclaimed in a bounded batch (FR29, FR30, C5, AC17).
#OutputGroupReclaimedEvent: {
	type:     "output.group_reclaimed"
	envelope: envelope.#OutputEnvelope
	detail:   #RetentionEventDetail
}
