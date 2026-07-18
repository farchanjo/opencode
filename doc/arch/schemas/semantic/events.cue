// DDD role: ValueObject
// Package: semantic.events
// SemanticEvent — the closed tagged union of the semantic.* event members (C22), plus
// the cohesive detail sub-objects distinct members carry. Mirroring Feature 002/003/
// 004/005, each member is registered as its own EventV2.define Definition on the
// EventV2Bridge; no raw union is wired to the bus (C22). Durable index/binding/cutover
// members carry the EventV2 durable {version, aggregate} annotation and replay; live
// degradation/probe/state members omit it and may be dropped under load (C22). Members
// live in events-index.cue and events-live.cue.

package semantic.events

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// BindingSelectionDetail carries the pinned slot and version staged by an operator (FR28, FR31, C12).
#BindingSelectionDetail: {
	slot:    enums.#Slot
	version: values.#BindingVersion
}

// CutoverDetail carries the generation and the CAS outcome of an alias swap or rollback (FR12, C12, AC31).
#CutoverDetail: {
	generation_id: ids.#GenerationId
	outcome:       enums.#CutoverOutcome
}

// IndexMutationDetail carries the collection and content hash of an upsert/tombstone (FR13, AC10).
#IndexMutationDetail: {
	collection:   enums.#Collection
	content_hash: ids.#ContentHash
}

// ReconcileDetail carries the collection and the reconcile outcome (FR13, AC10, AC13).
#ReconcileDetail: {
	collection: enums.#Collection
	outcome:    enums.#CutoverOutcome
}

// GenerationDetail carries the generation and its lifecycle state (FR12, C12).
#GenerationDetail: {
	generation_id: ids.#GenerationId
	state:         enums.#GenerationState
}

// DegradationDetail carries the typed capability gap and the ladder mode (FR24, C20, AC29).
#DegradationDetail: {
	gap:  enums.#DegradationGap
	mode: enums.#RetrievalMode
}

// ProbeDetail carries the probed slot and its validation status (FR30, C16, AC22).
#ProbeDetail: {
	slot:   enums.#Slot
	status: enums.#ValidationStatus
}

// StateChangeDetail carries the slot and its new binding state (FR31, C20).
#StateChangeDetail: {
	slot:  enums.#Slot
	state: enums.#BindingState
}

// SemanticEvent is the closed tagged union of every semantic.* event member (C22).
#SemanticEvent: (
	#SemanticBindingSelectedEvent |
	#SemanticBindingCutoverEvent |
	#SemanticBindingRolledBackEvent |
	#SemanticIndexUpsertedEvent |
	#SemanticIndexTombstonedEvent |
	#SemanticIndexReconciledEvent |
	#SemanticGenerationBuiltEvent |
	#SemanticGenerationCutoverEvent |
	#SemanticGenerationRetiredEvent |
	#SemanticRetrievalDegradedEvent |
	#SemanticProviderProbedEvent |
	#SemanticBindingStateChangedEvent
)
