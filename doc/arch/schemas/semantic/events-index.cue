// DDD role: ValueObject
// Package: semantic.events
// Durable settlement event members (C22). Binding selection/cutover/rollback, index
// upsert/tombstone/reconcile and generation build/cutover/retire are durable and never
// coalesced or dropped; they replay through readAggregate (FR13, C12, C22). A cutover
// swaps all collection aliases together under one CAS (FR12, C12); a rollback reverses
// under policy (FR32). Content is never an event payload (FR17, FR42, C22).

package semantic.events

// binding_selected — an operator staged a candidate binding version (FR28, FR31, C12).
#SemanticBindingSelectedEvent: {
	type:     "semantic.binding_selected"
	envelope: #SemanticEnvelope
	detail:   #BindingSelectionDetail
}

// binding_cutover — an atomic CAS alias swap activated a binding generation (FR12, C12, AC31).
#SemanticBindingCutoverEvent: {
	type:     "semantic.binding_cutover"
	envelope: #SemanticEnvelope
	detail:   #CutoverDetail
}

// binding_rolled_back — a cutover was reversed under policy (FR32, C12).
#SemanticBindingRolledBackEvent: {
	type:     "semantic.binding_rolled_back"
	envelope: #SemanticEnvelope
	detail:   #CutoverDetail
}

// index_upserted — a content-hash incremental upsert reflected core state (FR13, AC10).
#SemanticIndexUpsertedEvent: {
	type:     "semantic.index_upserted"
	envelope: #SemanticEnvelope
	detail:   #IndexMutationDetail
}

// index_tombstoned — a removed document was tombstoned to reflect core state (FR13, AC10).
#SemanticIndexTombstonedEvent: {
	type:     "semantic.index_tombstoned"
	envelope: #SemanticEnvelope
	detail:   #IndexMutationDetail
}

// index_reconciled — a scheduled reconcile aligned the projection with core (FR13, AC13).
#SemanticIndexReconciledEvent: {
	type:     "semantic.index_reconciled"
	envelope: #SemanticEnvelope
	detail:   #ReconcileDetail
}

// generation_built — a blue/green generation finished building (FR12, C12).
#SemanticGenerationBuiltEvent: {
	type:     "semantic.generation_built"
	envelope: #SemanticEnvelope
	detail:   #GenerationDetail
}

// generation_cutover — a generation became live via an atomic alias swap (FR12, C12, AC31).
#SemanticGenerationCutoverEvent: {
	type:     "semantic.generation_cutover"
	envelope: #SemanticEnvelope
	detail:   #GenerationDetail
}

// generation_retired — a superseded generation retired after the dual-write window (FR12, C12).
#SemanticGenerationRetiredEvent: {
	type:     "semantic.generation_retired"
	envelope: #SemanticEnvelope
	detail:   #GenerationDetail
}
