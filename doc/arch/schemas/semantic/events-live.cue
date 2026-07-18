// DDD role: ValueObject
// Package: semantic.events
// Live signal event members (C22). Retrieval degradation, provider probe and binding
// state-change signals use the bounded live channel and MAY be dropped under load
// without affecting durable index/cutover replay (C22). They carry no sequence and
// never gate work. A degradation signal never auto-substitutes a model (FR24, C20); a
// probe signal reflects the untrusted-until-validated trust state (FR30, C16, AC22).

package semantic.events

// retrieval_degraded — retrieval dropped to a lower ladder rung with a typed gap (FR24, C20, AC29).
#SemanticRetrievalDegradedEvent: {
	type:     "semantic.retrieval_degraded"
	envelope: #SemanticEnvelope
	detail:   #DegradationDetail
}

// provider_probed — a native probe/eval updated a model's validation status (FR30, C16, AC22).
#SemanticProviderProbedEvent: {
	type:     "semantic.provider_probed"
	envelope: #SemanticEnvelope
	detail:   #ProbeDetail
}

// binding_state_changed — a pinned slot moved between active/degraded/unavailable (FR31, C20).
#SemanticBindingStateChangedEvent: {
	type:     "semantic.binding_state_changed"
	envelope: #SemanticEnvelope
	detail:   #StateChangeDetail
}
